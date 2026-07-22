import { sql, type SQL } from "drizzle-orm";
import { z } from "zod";

import { db } from "#/db/index.ts";
import { ALL_PARKS, UOR_PARKS, WDW_PARKS, WDW_WATER_PARK_CODES } from "#/lib/parks.ts";
import { scarcityTier } from "#/lib/ticket-scarcity.ts";
import { QueueState, WDW_WATER_PARK_FAMILIES } from "#/server/parks/codes.ts";
import { loadParkCalendar } from "#/server/forecast/parkCalendar.ts";
import { publicProcedure } from "../init.ts";

import type { TRPCRouterRecord } from "@trpc/server";

/** Window the shelf's "upcoming cheapest" scans, matching the calendar's horizon. */
const SHELF_DAYS = 150;

// Each resort's date-priced "from price to skip/enter" product. WDW date-prices
// admission (Lightning Lane isn't in this feed); Universal date-prices Express
// (its 1-day admission is a flat list price), so that's what the calendar shows.

function parkLabel(
  parks: Array<{ code: string; label: string }>,
  code: string | null,
): string | null {
  if (!code) return null;
  return parks.find((p) => p.code === code)?.label ?? code;
}

/** SQL array literal of the water-park families, for IN/exclusion clauses. */
const WATER_PARK_FAMILY_ARRAY = sql`ARRAY[${sql.join(
  WDW_WATER_PARK_FAMILIES.map((f) => sql`${f}`),
  sql`, `,
)}]::text[]`;

function isWdwWaterPark(park: string | null): boolean {
  return park != null && WDW_WATER_PARK_CODES.has(park);
}

function wdwProduct(
  parkHopper: boolean,
  ageGroup: "ADULT" | "CHILD",
  park: string | null,
): { label: string; filter: SQL } {
  // Water parks price flat single-day tickets, not the demand-priced admission.
  if (isWdwWaterPark(park)) return wdwWaterParkProduct(ageGroup, park);

  const ageStr = ageGroup === "CHILD" ? "Child" : "Adult";
  const parts = [
    parkHopper ? "Park Hopper" : "1-Day",
    ageStr,
    parkLabel(WDW_PARKS, park),
    "Ticket",
  ];
  const parkCond = park ? sql` AND d.park_scope && ARRAY[${park}]::text[]` : sql``;
  // Exclude water-park SKUs so they never undercut the admission price — they'd
  // otherwise match the "All parks" (park = null) 1-day filter and drag it down.
  return {
    label: parts.filter(Boolean).join(" "),
    filter: sql`d.duration_days = 1 AND d.age_group = ${ageGroup} AND d.residency = 'STD' AND d.park_to_park = ${parkHopper} AND NOT (d.family = ANY(${WATER_PARK_FAMILY_ARRAY}))${parkCond}`,
  };
}

/**
 * Flat-priced water-park ticket filter (both tiers: the full-price ticket and the
 * cheaper summer-blockout one). The calendar's min-per-date then shows the cheaper
 * tier on open days and the full price on blockout days (the blockout SKU records
 * no rows in its blocked ranges). Park Hopper / residency don't apply to water
 * parks, so this ignores them.
 */
function wdwWaterParkProduct(
  ageGroup: "ADULT" | "CHILD",
  park: string | null,
): { label: string; filter: SQL } {
  const ageStr = ageGroup === "CHILD" ? "Child" : "Adult";
  const parkCond = park ? sql` AND d.park_scope && ARRAY[${park}]::text[]` : sql``;
  return {
    label: `1-Day ${ageStr} Water Park Ticket`,
    filter: sql`d.family = ANY(${WATER_PARK_FAMILY_ARRAY}) AND d.age_group = ${ageGroup}${parkCond}`,
  };
}

function uorProduct(
  ageGroup: "ADULT" | "CHILD",
  park: string | null,
): { label: string; filter: SQL } {
  const ageStr = ageGroup === "CHILD" ? "Child" : "Adult";
  const parts = ["1-Day", ageStr, parkLabel(UOR_PARKS, park), "Express Pass"];
  // age_group IS NULL covers Express SKUs that don't encode adult/child in the part number
  const parkCond = park ? sql` AND d.park_scope && ARRAY[${park}]::text[]` : sql``;
  return {
    label: parts.filter(Boolean).join(" "),
    filter: sql`d.family = 'EXPRESS' AND d.variable_priced = true AND (d.age_group = ${ageGroup} OR d.age_group IS NULL)${parkCond}`,
  };
}

export const ticketsRouter = {
  /**
   * Per-date pricing calendar for a resort: the cheapest qualifying product for
   * each service date, from the latest snapshot. `available` is true if any
   * qualifying SKU was sellable that day. Returns the product label so the UI
   * can title itself (admission for WDW, Express for UOR).
   */
  priceCalendar: publicProcedure
    .input(
      z.object({
        resort: z.enum(["WDW", "UOR"]).default("WDW"),
        days: z.number().int().min(1).max(365).default(120),
        pastDays: z.number().int().min(0).max(365).default(90),
        parkHopper: z.boolean().default(false),
        ageGroup: z.enum(["ADULT", "CHILD"]).default("ADULT"),
        park: z.string().nullable().default(null),
      }),
    )
    .query(async ({ input }) => {
      const product =
        input.resort === "UOR"
          ? uorProduct(input.ageGroup, input.park)
          : wdwProduct(input.parkHopper, input.ageGroup, input.park);
      const result = await db.execute<{
        service_date: Date | string;
        price_cents: number;
        available: boolean | null;
        available_units: number | null;
        observed_at: string | null;
      }>(sql`
        WITH latest AS (
          SELECT DISTINCT ON (sp.sku, sp.service_date)
                 sp.sku, sp.service_date, sp.price_cents, sp.available,
                 sp.available_units, sp.observed_at
          FROM sku_price_obs sp
          JOIN product_dim d ON d.sku = sp.sku
          WHERE d.resort = ${input.resort}
            AND ${product.filter}
            AND sp.service_date >= current_date - ${input.pastDays}::int
            AND sp.service_date < current_date + ${input.days}::int
          ORDER BY sp.sku, sp.service_date, sp.observed_at DESC
        )
        SELECT service_date,
               min(price_cents) AS price_cents,
               bool_or(available) AS available,
               max(observed_at) AS observed_at,
               -- units of the cheapest *available* SKU for the date (Universal
               -- Express only; WDW admission carries no units → NULL)
               (array_agg(available_units ORDER BY
                  (CASE WHEN available THEN 0 ELSE 1 END), price_cents ASC NULLS LAST)
                 FILTER (WHERE available_units IS NOT NULL))[1] AS available_units
        FROM latest
        WHERE price_cents IS NOT NULL
        GROUP BY service_date
        ORDER BY service_date
      `);
      const lastUpdatedAt = result.rows.reduce<string | null>((m, r) => {
        if (!r.observed_at) return m;
        const s = String(r.observed_at);
        return !m || s > m ? s : m;
      }, null);
      return {
        resort: input.resort,
        productLabel: product.label,
        lastUpdatedAt,
        days: result.rows.map((r) => {
          const units = r.available_units != null ? Number(r.available_units) : null;
          return {
            date: (r.service_date instanceof Date
              ? r.service_date.toISOString()
              : String(r.service_date)
            ).slice(0, 10),
            priceCents: Number(r.price_cents),
            available: r.available ?? true,
            // Raw count for the Tickets page (shows actual availability); tier
            // for hedged surfaces like the map's limited marker display.
            availableUnits: units,
            scarcity: scarcityTier(units),
          };
        }),
      };
    }),

  /**
   * One summary row per park for the mobile ticket shelves: today's price, the
   * cheapest upcoming (sellable) day, and today's crowd + weather. Prices reuse
   * the same per-park product filters as `priceCalendar`; crowd/weather come from
   * `loadParkCalendar` (the same source the calendar overlay uses), scoped to
   * today. Parks without a slug (e.g. water parks) are omitted.
   */
  parkShelf: publicProcedure
    .input(
      z.object({
        parkHopper: z.boolean().default(false),
        ageGroup: z.enum(["ADULT", "CHILD"]).default("ADULT"),
      }),
    )
    .query(async ({ input }) => {
      const today = new Intl.DateTimeFormat("en-CA", {
        timeZone: "America/New_York",
      }).format(new Date());
      const parks = ALL_PARKS.filter((p) => p.slug);

      // Canonical park names (e.g. "Universal Studios Florida") so the shelf
      // headers read exactly like the Waits/Eats/Stays pages.
      const nameRes = await db.execute<{ slug: string; name: string }>(
        sql`SELECT slug, name FROM parks`,
      );
      const nameBySlug = new Map(nameRes.rows.map((r) => [r.slug, r.name]));

      const rows = await Promise.all(
        parks.map(async (p) => {
          const product =
            p.resort === "UOR"
              ? uorProduct(input.ageGroup, p.code)
              : wdwProduct(input.parkHopper, input.ageGroup, p.code);

          const priceP = db.execute<{
            today_cents: number | null;
            today_available: boolean | null;
            today_units: number | null;
            cheapest_cents: number | null;
            cheapest_date: Date | string | null;
          }>(sql`
            WITH latest AS (
              SELECT DISTINCT ON (sp.sku, sp.service_date)
                     sp.sku, sp.service_date, sp.price_cents, sp.available, sp.available_units
              FROM sku_price_obs sp
              JOIN product_dim d ON d.sku = sp.sku
              WHERE d.resort = ${p.resort}
                AND ${product.filter}
                AND sp.service_date >= current_date
                AND sp.service_date < current_date + ${SHELF_DAYS}::int
              ORDER BY sp.sku, sp.service_date, sp.observed_at DESC
            ),
            agg AS (
              SELECT service_date,
                     min(price_cents) AS price_cents,
                     bool_or(available) AS available,
                     (array_agg(available_units ORDER BY
                        (CASE WHEN available THEN 0 ELSE 1 END), price_cents ASC NULLS LAST)
                       FILTER (WHERE available_units IS NOT NULL))[1] AS available_units
              FROM latest
              WHERE price_cents IS NOT NULL
              GROUP BY service_date
            )
            SELECT
              (SELECT price_cents FROM agg WHERE service_date = current_date) AS today_cents,
              (SELECT available FROM agg WHERE service_date = current_date) AS today_available,
              (SELECT available_units FROM agg WHERE service_date = current_date) AS today_units,
              (SELECT price_cents FROM agg WHERE available
                 ORDER BY price_cents ASC, service_date ASC LIMIT 1) AS cheapest_cents,
              (SELECT service_date FROM agg WHERE available
                 ORDER BY price_cents ASC, service_date ASC LIMIT 1) AS cheapest_date
          `);

          // Richer today-weather than loadParkCalendar surfaces: daily high/low,
          // precip chance, wind, and humidity for the shelf's weather card.
          const weatherP = db.execute<{
            high_c: number | null;
            low_c: number | null;
            precip_prob: number | null;
            precip_peak: string | null;
            wind_kph: number | null;
            humidity: number | null;
            condition: string | null;
          }>(sql`
            WITH park AS (SELECT id, timezone FROM parks WHERE slug = ${p.slug}),
            hourly AS (
              SELECT wo.temp_c, wo.precip_prob, wo.wind_kph, wo.humidity, wo.condition,
                     (wo.observed_at AT TIME ZONE (SELECT timezone FROM park)) AS local_ts,
                     abs(extract(hour from wo.observed_at AT TIME ZONE (SELECT timezone FROM park)) - 13)
                       AS noon_dist
              FROM weather_obs wo
              WHERE wo.park_id = (SELECT id FROM park)
                AND wo.kind IN ('FORECAST', 'ACTUAL')
                AND (wo.observed_at AT TIME ZONE (SELECT timezone FROM park))::date = ${today}::date
            )
            SELECT
              max(temp_c) AS high_c,
              min(temp_c) AS low_c,
              max(precip_prob) AS precip_prob,
              max(wind_kph) AS wind_kph,
              round(avg(humidity)) AS humidity,
              (SELECT condition FROM hourly ORDER BY noon_dist LIMIT 1) AS condition,
              (SELECT to_char(local_ts, 'FMHH12am') FROM hourly
                 WHERE precip_prob IS NOT NULL
                 ORDER BY precip_prob DESC, local_ts LIMIT 1) AS precip_peak
            FROM hourly
          `);

          const [priceRes, cal, weatherRes] = await Promise.all([
            priceP,
            loadParkCalendar(p.slug as string, today, today),
            weatherP,
          ]);
          const price = priceRes.rows[0];
          const day = cal.days.find((d) => d.date === today) ?? cal.days[0] ?? null;
          const cheapestDate = price?.cheapest_date;
          const w = weatherRes.rows[0];
          const toF = (c: number | null | undefined) =>
            c != null ? Math.round((c * 9) / 5 + 32) : null;

          return {
            resort: p.resort,
            code: p.code,
            slug: p.slug,
            label: nameBySlug.get(p.slug as string) ?? p.label,
            parkHopper: p.resort === "WDW" ? input.parkHopper : false,
            todayCents: price?.today_cents != null ? Number(price.today_cents) : null,
            todayAvailable: price?.today_available ?? false,
            todayUnits: price?.today_units != null ? Number(price.today_units) : null,
            todayScarcity: scarcityTier(
              price?.today_units != null ? Number(price.today_units) : null,
            ),
            cheapestCents: price?.cheapest_cents != null ? Number(price.cheapest_cents) : null,
            cheapestDate: cheapestDate
              ? (cheapestDate instanceof Date
                  ? cheapestDate.toISOString()
                  : String(cheapestDate)
                ).slice(0, 10)
              : null,
            crowdIndex: day?.crowdIndex ?? null,
            crowdIsEstimate: day?.crowdIsEstimate ?? false,
            highF: toF(w?.high_c) ?? day?.weather?.highF ?? null,
            lowF: toF(w?.low_c),
            precipProb: w?.precip_prob ?? day?.weather?.precipProb ?? null,
            precipPeak: w?.precip_peak ?? null,
            windMph: w?.wind_kph != null ? Math.round(w.wind_kph * 0.621371) : null,
            humidity: w?.humidity != null ? Number(w.humidity) : null,
            condition: w?.condition ?? day?.weather?.condition ?? null,
          };
        }),
      );

      return { date: today, parks: rows };
    }),

  /**
   * Annual Pass blockout calendar (plan item 2.4). The tickets cron sweeps the
   * `passholder` segment of the free availability endpoint into
   * `ticket_availability`; a blockout is a `SOLD_OUT` state for a (park, date) in
   * that segment, from the latest snapshot. Blockouts are seasonal (holiday
   * weeks) and often absent entirely — an empty `days` is the expected
   * "all-clear" case, which the UI renders as a designed empty state (the
   * *appearance* of blockouts is itself the news). WDW-only (Disney AP concept).
   */
  passholderBlockouts: publicProcedure
    .input(
      z.object({
        days: z.number().int().min(1).max(365).default(180),
      }),
    )
    .query(async ({ input }) => {
      const result = await db.execute<{
        slug: string;
        name: string;
        service_date: Date | string;
        snapshot_date: Date | string;
      }>(sql`
        WITH latest AS (
          SELECT DISTINCT ON (ta.park_id, ta.service_date)
                 ta.park_id, ta.service_date, ta.state, ta.snapshot_date
          FROM ticket_availability ta
          WHERE ta.segment = 'passholder'
            AND ta.service_date >= current_date
            AND ta.service_date < current_date + ${input.days}::int
          ORDER BY ta.park_id, ta.service_date, ta.snapshot_date DESC
        )
        SELECT p.slug, p.name, l.service_date, l.snapshot_date
        FROM latest l
        JOIN parks p ON p.id = l.park_id
        WHERE l.state = ${QueueState.SOLD_OUT} AND p.slug IS NOT NULL
        ORDER BY l.service_date, p.name
      `);

      const isoDate = (d: Date | string) =>
        (d instanceof Date ? d.toISOString() : String(d)).slice(0, 10);
      const todayIso = new Intl.DateTimeFormat("en-CA", {
        timeZone: "America/New_York",
      }).format(new Date());

      // Group blocked parks by service date.
      const byDate = new Map<string, Array<{ slug: string; name: string }>>();
      let lastSnapshot: string | null = null;
      for (const r of result.rows) {
        const date = isoDate(r.service_date);
        const list = byDate.get(date) ?? [];
        list.push({ slug: r.slug, name: r.name });
        byDate.set(date, list);
        const snap = isoDate(r.snapshot_date);
        if (!lastSnapshot || snap > lastSnapshot) lastSnapshot = snap;
      }

      const days = [...byDate.entries()]
        .map(([date, blocked]) => ({ date, blocked }))
        .sort((a, b) => a.date.localeCompare(b.date));

      return {
        lastSnapshot,
        days,
        todayBlocked: byDate.get(todayIso) ?? [],
      };
    }),
} satisfies TRPCRouterRecord;
