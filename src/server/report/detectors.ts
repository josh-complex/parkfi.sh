/**
 * SQL detectors for the data-driven blog pipeline (docs/plans/blog-data-reports.md).
 *
 * Each detector scans a trailing window of our own telemetry and returns
 * normalized `report_event` inputs — one row per newsworthy fact, with every
 * number the eventual post will cite precomputed into `payload`. Detectors are
 * deterministic and idempotent: they re-scan overlapping windows every run and
 * rely on the (kind, entity_kind, entity_id, window_start) unique key to make
 * re-detections no-ops, so cadence and lookback can overlap freely.
 *
 * Thresholds here are the noise gate: nothing below them ever leaves SQL, so
 * the composer only weighs genuinely reportable events.
 */
import { sql } from "drizzle-orm";

import { db } from "../../db/index.ts";
import { reportEvent } from "../../db/schema.ts";
import { AttractionStatus, Product } from "../parks/codes.ts";

export type ReportEventKind = "downtime_episode" | "menu_change_rollup" | "price_change";

export interface ReportEventInput {
  kind: ReportEventKind;
  resortSlug: string;
  parkId: number | null;
  entityKind: "attraction" | "facility" | "product" | "sku";
  entityId: string;
  windowStart: Date;
  windowEnd: Date;
  score: number;
  payload: Record<string, unknown>;
}

/** All venues we track are Orlando; per-day rollups bucket on park-local days. */
const PARK_TZ = "America/New_York";

/** Human name for a `product_price_obs.product_id` in a post payload. */
const PRODUCT_NAMES: Record<number, string> = {
  [Product.LIGHTNING_LANE_MULTI]: "Lightning Lane Multi Pass",
  [Product.LIGHTNING_LANE_SINGLE]: "Lightning Lane Single Pass",
  [Product.DISNEY_VIRTUAL_QUEUE]: "Virtual Queue",
  [Product.UNIVERSAL_EXPRESS]: "Universal Express Pass",
  [Product.UNIVERSAL_VIRTUAL_LINE]: "Virtual Line",
  [Product.DISNEY_TICKET]: "Date-Based Park Ticket",
  [Product.UNIVERSAL_TICKET]: "Park Ticket",
};

const STATUS_NAMES: Record<number, string> = {
  [AttractionStatus.UNKNOWN]: "UNKNOWN",
  [AttractionStatus.OPERATING]: "OPERATING",
  [AttractionStatus.DOWN]: "DOWN",
  [AttractionStatus.CLOSED]: "CLOSED",
  [AttractionStatus.REFURBISHMENT]: "REFURBISHMENT",
};

/**
 * Completed unplanned-downtime episodes from the `attraction_status_obs`
 * change-log: consecutive DOWN spells collapsed into (start, end) with the
 * status the ride came back to (OPERATING = mid-day recovery; CLOSED = never
 * reopened before park close — the worse story). Only episodes that ENDED
 * inside the lookback are emitted, so an episode's window is stable by the time
 * it becomes an event (in-progress downtime is left for the run that sees it
 * resolve).
 *
 * The scan reaches `lookbackHours + 48h` back so a spell that started well
 * before the reporting window still finds its true start; a DOWN spell longer
 * than that margin would report a truncated start (rare — multi-day outages
 * flip to REFURBISHMENT/CLOSED upstream).
 *
 * Score = minutes down × a prominence factor from the ride's 14-day average
 * standby wait (a headliner going down outranks a C-ticket), clamped so a
 * wait-less show can still register.
 */
export async function detectDowntimeEpisodes(opts: {
  lookbackHours: number;
  minMinutes: number;
}): Promise<ReportEventInput[]> {
  const scanHours = opts.lookbackHours + 48;
  const result = await db.execute<{
    attraction_id: string;
    attraction_name: string;
    park_id: string;
    park_name: string;
    park_slug: string;
    resort_slug: string;
    down_start: string;
    down_end: string;
    end_status: number;
    minutes: string;
    avg_wait_14d: string | null;
  }>(sql`
    WITH obs AS (
      SELECT attraction_id, observed_at, status,
             lag(status) OVER w AS prev_status
      FROM attraction_status_obs
      WHERE observed_at >= now() - make_interval(hours => ${scanHours})
      WINDOW w AS (PARTITION BY attraction_id ORDER BY observed_at)
    ), marked AS (
      -- Same spell-collapse as parks.llDrops: a running count of status
      -- transitions groups consecutive same-status rows (heartbeat re-asserts
      -- included) into one spell.
      SELECT *, sum(CASE WHEN status IS DISTINCT FROM prev_status THEN 1 ELSE 0 END)
                  OVER (PARTITION BY attraction_id ORDER BY observed_at) AS grp
      FROM obs
    ), spells AS (
      SELECT attraction_id, grp, min(status) AS status, min(observed_at) AS start_at
      FROM marked
      GROUP BY attraction_id, grp
    ), episodes AS (
      -- A DOWN spell's end is the start of the attraction's next spell.
      SELECT d.attraction_id, d.start_at AS down_start,
             n.start_at AS down_end, n.status AS end_status
      FROM spells d
      JOIN spells n ON n.attraction_id = d.attraction_id AND n.grp = d.grp + 1
      WHERE d.status = ${AttractionStatus.DOWN}
        AND n.start_at >= now() - make_interval(hours => ${opts.lookbackHours})
        AND n.start_at - d.start_at >= make_interval(mins => ${opts.minMinutes})
    )
    SELECT e.attraction_id, a.name AS attraction_name,
           p.id AS park_id, p.name AS park_name, p.slug AS park_slug,
           r.slug AS resort_slug,
           e.down_start, e.down_end, e.end_status,
           round(extract(epoch FROM (e.down_end - e.down_start)) / 60.0)::int AS minutes,
           w.avg_wait_14d
    FROM episodes e
    JOIN attractions a ON a.id = e.attraction_id
    JOIN parks p ON p.id = a.park_id
    JOIN resorts r ON r.id = p.resort_id
    LEFT JOIN LATERAL (
      SELECT avg(avg_wait)::real AS avg_wait_14d
      FROM queue_15min q
      WHERE q.attraction_id = e.attraction_id AND q.queue_type = 1
        AND q.bucket >= now() - INTERVAL '14 days'
    ) w ON true
    -- Un-enriched ghost duplicate rows carry a null category; skip them like
    -- the live board does.
    WHERE a.active = true AND a.category IS NOT NULL
    ORDER BY e.down_start
  `);

  return result.rows.map((row) => {
    const minutes = Number(row.minutes);
    const avgWait = row.avg_wait_14d == null ? null : Math.round(Number(row.avg_wait_14d));
    // Prominence: a 30-minute-average ride is the 1.0 baseline; clamp so shows
    // with no standby data still register and headliners don't dominate 10x.
    const prominence = Math.min(3, Math.max(0.5, (avgWait ?? 15) / 30));
    return {
      kind: "downtime_episode" as const,
      resortSlug: row.resort_slug,
      parkId: Number(row.park_id),
      entityKind: "attraction" as const,
      entityId: row.attraction_id,
      windowStart: new Date(row.down_start),
      windowEnd: new Date(row.down_end),
      score: Math.round(minutes * prominence),
      payload: {
        attraction: row.attraction_name,
        park: row.park_name,
        parkSlug: row.park_slug,
        downStart: row.down_start,
        downEnd: row.down_end,
        minutes,
        // OPERATING = recovered mid-day; CLOSED = stayed down through park close.
        endStatus: STATUS_NAMES[row.end_status] ?? String(row.end_status),
        avgWait14d: avgWait,
      },
    };
  });
}

/**
 * Per-venue menu churn, rolled up per park-local calendar day — the same
 * UNION-dedup over `dining_menu_event` + `dining_menu_price_change` the
 * `dining.recentlyUpdated` shelf uses, bucketed by day so the event identity is
 * stable. Only fully-elapsed local days are rolled up: a day still in progress
 * would freeze its partial counts into the identity key and silently drop the
 * evening's changes.
 */
export async function detectMenuChangeRollups(opts: {
  lookbackDays: number;
  minChanges: number;
}): Promise<ReportEventInput[]> {
  const result = await db.execute<{
    facility_id: string;
    name: string;
    park_resort: string | null;
    day: string;
    added_count: string;
    removed_count: string;
    price_count: string;
    sample_titles: string[] | null;
    added_titles: string[] | null;
    price_moves: Array<{ title: string; old: number | null; new: number | null }> | null;
  }>(sql`
    WITH activity AS (
      -- UNION (not ALL) collapses per-menu-group duplicates, mirroring
      -- dining.recentlyUpdated's dedup key.
      SELECT facility_id, title, changed_at, 'price' AS kind, meal_period,
             old_price, new_price
      FROM dining_menu_price_change
      WHERE changed_at >= now() - make_interval(days => ${opts.lookbackDays})
      UNION
      SELECT facility_id, title, changed_at, change_type AS kind, meal_period,
             NULL, NULL
      FROM dining_menu_event
      WHERE changed_at >= now() - make_interval(days => ${opts.lookbackDays})
    )
    SELECT a.facility_id, r.name, r.park_resort,
           (a.changed_at AT TIME ZONE ${PARK_TZ})::date::text AS day,
           count(*) FILTER (WHERE a.kind = 'added') AS added_count,
           count(*) FILTER (WHERE a.kind = 'removed') AS removed_count,
           count(*) FILTER (WHERE a.kind = 'price') AS price_count,
           (array_agg(DISTINCT a.title))[1:8] AS sample_titles,
           (array_agg(DISTINCT a.title) FILTER (WHERE a.kind = 'added'))[1:6] AS added_titles,
           COALESCE(jsonb_path_query_array(
             jsonb_agg(jsonb_build_object('title', a.title, 'old', a.old_price, 'new', a.new_price))
               FILTER (WHERE a.kind = 'price'),
             '$[0 to 5]'
           ), '[]'::jsonb) AS price_moves
    FROM activity a
    JOIN restaurant_dim r ON r.facility_id = a.facility_id
    WHERE r.active = true
      -- Completed local days only (see docblock).
      AND (a.changed_at AT TIME ZONE ${PARK_TZ})::date
            < (now() AT TIME ZONE ${PARK_TZ})::date
    GROUP BY a.facility_id, r.name, r.park_resort, day
    HAVING count(*) >= ${opts.minChanges}
    ORDER BY day, a.facility_id
  `);

  return result.rows.map((row) => {
    const added = Number(row.added_count);
    const removed = Number(row.removed_count);
    const priced = Number(row.price_count);
    // Local midnight of the rollup day, expressed as an absolute instant.
    const windowStart = localDayStart(row.day);
    return {
      kind: "menu_change_rollup" as const,
      // UOR facility ids are the operator's `uor.*` place ids; everything else
      // in restaurant_dim is WDW.
      resortSlug: row.facility_id.startsWith("uor.") ? "universal-orlando" : "walt-disney-world",
      parkId: null,
      entityKind: "facility" as const,
      entityId: row.facility_id,
      windowStart,
      windowEnd: new Date(windowStart.getTime() + 86_400_000),
      // Adds read as news, removals as changes, price moves as footnotes.
      score: Math.round(added * 2 + removed * 1.5 + priced),
      payload: {
        facility: row.name,
        parkResort: row.park_resort,
        day: row.day,
        added,
        removed,
        priceMoves: priced,
        addedTitles: row.added_titles ?? [],
        sampleTitles: row.sample_titles ?? [],
        priceMoveSamples: row.price_moves ?? [],
      },
    };
  });
}

/**
 * Price moves in the two change-only price ledgers, rolled up per product per
 * park-local observation day:
 *
 *  - `product_price_obs` (park-keyed: Lightning Lane, Express, Disney/Universal
 *    date-based tickets from the TP.wiki schedule feed) — change-only per
 *    (park, product, service_date, tier), so a lag() over each key isolates the
 *    real price transitions.
 *  - `sku_price_obs` (SKU-keyed: Universal + Disney web-store tickets, Express,
 *    annual passes) — delta-only since 2026-06-07, but a delta row can also be
 *    an availability flip, so the price-changed filter is explicit.
 *
 * One event per (product|sku, day) with the moved service dates sampled into
 * the payload. Only fully-elapsed local days roll up (same identity-stability
 * reasoning as the menu detector). The scan reaches 120 days back so lag() can
 * see the previous observation across these sparse change-only tables.
 */
export async function detectPriceChanges(opts: {
  lookbackDays: number;
  minPctMove: number;
}): Promise<ReportEventInput[]> {
  const parkKeyed = await db.execute<{
    park_id: string;
    park_name: string;
    park_slug: string;
    resort_slug: string;
    product_id: number;
    tier: string;
    day: string;
    dates_moved: string;
    avg_old_cents: string;
    avg_new_cents: string;
    max_abs_pct: string;
    currency: string | null;
    samples: Array<{ serviceDate: string; oldCents: number; newCents: number }>;
  }>(sql`
    WITH moves AS (
      SELECT park_id, product_id, tier, service_date, observed_at,
             price_cents, currency,
             lag(price_cents) OVER w AS prev_price
      FROM product_price_obs
      WHERE observed_at >= now() - INTERVAL '120 days'
      WINDOW w AS (PARTITION BY park_id, product_id, service_date, tier
                   ORDER BY observed_at)
    ), changed AS (
      SELECT *, (observed_at AT TIME ZONE ${PARK_TZ})::date AS obs_day,
             abs(price_cents - prev_price) * 100.0 / prev_price AS abs_pct
      FROM moves
      WHERE observed_at >= now() - make_interval(days => ${opts.lookbackDays})
        AND prev_price IS NOT NULL AND prev_price > 0
        AND price_cents IS NOT NULL
        AND price_cents IS DISTINCT FROM prev_price
    )
    SELECT c.park_id, p.name AS park_name, p.slug AS park_slug, r.slug AS resort_slug,
           c.product_id, c.tier, c.obs_day::text AS day,
           count(*) AS dates_moved,
           round(avg(c.prev_price))::int AS avg_old_cents,
           round(avg(c.price_cents))::int AS avg_new_cents,
           round(max(c.abs_pct), 1) AS max_abs_pct,
           min(c.currency) AS currency,
           jsonb_path_query_array(
             jsonb_agg(jsonb_build_object(
               'serviceDate', c.service_date::text,
               'oldCents', c.prev_price, 'newCents', c.price_cents
             ) ORDER BY c.service_date),
             '$[0 to 9]'
           ) AS samples
    FROM changed c
    JOIN parks p ON p.id = c.park_id
    JOIN resorts r ON r.id = p.resort_id
    WHERE c.obs_day < (now() AT TIME ZONE ${PARK_TZ})::date
    GROUP BY c.park_id, p.name, p.slug, r.slug, c.product_id, c.tier, c.obs_day
    HAVING max(c.abs_pct) >= ${opts.minPctMove}
    ORDER BY day
  `);

  const skuKeyed = await db.execute<{
    sku: string;
    sku_name: string | null;
    family: string;
    resort: string;
    day: string;
    dates_moved: string;
    avg_old_cents: string;
    avg_new_cents: string;
    max_abs_pct: string;
    samples: Array<{ serviceDate: string; oldCents: number; newCents: number }>;
  }>(sql`
    WITH moves AS (
      SELECT sku, service_date, observed_at, price_cents,
             lag(price_cents) OVER w AS prev_price
      FROM sku_price_obs
      WHERE observed_at >= now() - INTERVAL '120 days'
      WINDOW w AS (PARTITION BY sku, service_date ORDER BY observed_at)
    ), changed AS (
      SELECT *, (observed_at AT TIME ZONE ${PARK_TZ})::date AS obs_day,
             abs(price_cents - prev_price) * 100.0 / prev_price AS abs_pct
      FROM moves
      WHERE observed_at >= now() - make_interval(days => ${opts.lookbackDays})
        AND prev_price IS NOT NULL AND prev_price > 0
        AND price_cents IS NOT NULL
        AND price_cents IS DISTINCT FROM prev_price
    )
    SELECT c.sku, d.name AS sku_name, d.family, d.resort, c.obs_day::text AS day,
           count(*) AS dates_moved,
           round(avg(c.prev_price))::int AS avg_old_cents,
           round(avg(c.price_cents))::int AS avg_new_cents,
           round(max(c.abs_pct), 1) AS max_abs_pct,
           jsonb_path_query_array(
             jsonb_agg(jsonb_build_object(
               'serviceDate', c.service_date::text,
               'oldCents', c.prev_price, 'newCents', c.price_cents
             ) ORDER BY c.service_date),
             '$[0 to 9]'
           ) AS samples
    FROM changed c
    JOIN product_dim d ON d.sku = c.sku
    WHERE d.active = true
      AND c.obs_day < (now() AT TIME ZONE ${PARK_TZ})::date
    GROUP BY c.sku, d.name, d.family, d.resort, c.obs_day
    HAVING max(c.abs_pct) >= ${opts.minPctMove}
    ORDER BY day
  `);

  const events: ReportEventInput[] = [];

  for (const row of parkKeyed.rows) {
    const datesMoved = Number(row.dates_moved);
    const maxAbsPct = Number(row.max_abs_pct);
    const windowStart = localDayStart(row.day);
    events.push({
      kind: "price_change",
      resortSlug: row.resort_slug,
      parkId: Number(row.park_id),
      entityKind: "product",
      entityId: `${row.park_id}:${row.product_id}:${row.tier}`,
      windowStart,
      windowEnd: new Date(windowStart.getTime() + 86_400_000),
      // Bigger moves and broader date coverage both raise the story.
      score: Math.round(maxAbsPct * 10 * Math.log(1 + datesMoved)),
      payload: {
        product: PRODUCT_NAMES[row.product_id] ?? `product ${row.product_id}`,
        tier: row.tier || null,
        park: row.park_name,
        parkSlug: row.park_slug,
        day: row.day,
        datesMoved,
        avgOldCents: Number(row.avg_old_cents),
        avgNewCents: Number(row.avg_new_cents),
        maxAbsPct,
        currency: row.currency ?? "USD",
        samples: row.samples,
      },
    });
  }

  for (const row of skuKeyed.rows) {
    const datesMoved = Number(row.dates_moved);
    const maxAbsPct = Number(row.max_abs_pct);
    const windowStart = localDayStart(row.day);
    events.push({
      kind: "price_change",
      resortSlug: row.resort === "UOR" ? "universal-orlando" : "walt-disney-world",
      parkId: null,
      entityKind: "sku",
      entityId: row.sku,
      windowStart,
      windowEnd: new Date(windowStart.getTime() + 86_400_000),
      score: Math.round(maxAbsPct * 10 * Math.log(1 + datesMoved)),
      payload: {
        product: row.sku_name ?? row.sku,
        family: row.family,
        sku: row.sku,
        day: row.day,
        datesMoved,
        avgOldCents: Number(row.avg_old_cents),
        avgNewCents: Number(row.avg_new_cents),
        maxAbsPct,
        currency: "USD",
        samples: row.samples,
      },
    });
  }

  return events;
}

/**
 * Persist detected events, relying on the identity unique key to drop
 * re-detections. Returns how many rows were actually new.
 */
export async function persistReportEvents(events: ReportEventInput[]): Promise<number> {
  if (events.length === 0) return 0;
  let inserted = 0;
  // Chunked single-row inserts keep the payload jsonb readable in the query
  // log; volume is tens of rows per run, so round-trips are immaterial.
  for (const e of events) {
    const res = await db
      .insert(reportEvent)
      .values({
        kind: e.kind,
        resortSlug: e.resortSlug,
        parkId: e.parkId,
        entityKind: e.entityKind,
        entityId: e.entityId,
        windowStart: e.windowStart,
        windowEnd: e.windowEnd,
        score: e.score,
        payload: e.payload,
      })
      .onConflictDoNothing({
        target: [
          reportEvent.kind,
          reportEvent.entityKind,
          reportEvent.entityId,
          reportEvent.windowStart,
        ],
      })
      .returning({ id: reportEvent.id });
    if (res.length > 0) inserted++;
  }
  return inserted;
}

/**
 * Midnight of a park-local `YYYY-MM-DD` as an absolute instant. Eastern time is
 * UTC-4 or -5; using the fixed standard offset would drift an hour across DST,
 * so resolve the offset for that date via Intl.
 */
function localDayStart(isoDay: string): Date {
  const noonUtc = new Date(`${isoDay}T12:00:00Z`);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: PARK_TZ,
    hour: "numeric",
    hour12: false,
  }).formatToParts(noonUtc);
  const localHourAtNoonUtc = Number(parts.find((p) => p.type === "hour")?.value ?? 7);
  const offsetHours = 12 - localHourAtNoonUtc; // 4 (EDT) or 5 (EST)
  return new Date(`${isoDay}T${String(offsetHours).padStart(2, "0")}:00:00Z`);
}
