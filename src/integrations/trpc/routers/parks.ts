import { sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "#/db/index.ts";
import { UOR_PARKS } from "#/lib/parks.ts";
import { capacityFromUnits, type CapacityLevel } from "#/lib/ticket-scarcity.ts";
import { buildLightningLaneDeepLink } from "#/server/notifications/lightningLaneDeepLink.ts";
import { disneyCardUrl, QueueState, QueueType } from "#/server/parks/codes.ts";
import { config } from "#/server/parks/config.ts";
import { suppressedFields } from "#/server/content/suppression.ts";
import { publicProcedure } from "../init.ts";

import type { GeoPolygon, ParkHeroSlide } from "#/db/schema.ts";
import type { TRPCRouterRecord } from "@trpc/server";

const STATUS_CODE: Record<number, string> = {
  0: "UNKNOWN",
  1: "OPERATING",
  2: "DOWN",
  3: "CLOSED",
  4: "REFURBISHMENT",
};
const QUEUE_STATE_CODE: Record<number, string> = {
  1: "AVAILABLE",
  2: "LIMITED",
  3: "SOLD_OUT",
  4: "NOT_OFFERED",
  5: "PAUSED",
};

const code = (map: Record<number, string>, v: number | null) =>
  v == null ? null : (map[v] ?? null);

/**
 * Schedule rows that mean the park is actually operating and posting real waits:
 * regular hours, extended/early-entry hours, and hard-ticket events all run rides
 * and post live queues. A timestamp inside *none* of these windows is a genuine
 * closure — which is how the overnight feed that keeps re-posting waits gets
 * correctly treated as shut. Used by every park-open / closed-flag derivation
 * below (`board`, `overview`, `parkHistory`) so they all agree on "open".
 */
const OPEN_SCHEDULE_TYPES = sql`('OPERATING', 'EXTRA_HOURS', 'TICKETED_EVENT')`;

export const parksRouter = {
  /** All active parks with operator/resort context. */
  list: publicProcedure.query(async () => {
    const result = await db.execute<{
      id: string;
      slug: string;
      name: string;
      timezone: string;
      operator_slug: string | null;
      operator_name: string | null;
      resort_name: string | null;
      latitude: number | null;
      longitude: number | null;
      lat_min: number | null;
      lat_max: number | null;
      lng_min: number | null;
      lng_max: number | null;
      map_zoom: number | null;
      boundary: GeoPolygon | null;
      image_url: string | null;
      image_alt: string | null;
      image_thumbhash: string | null;
      hero_media: Array<ParkHeroSlide> | null;
    }>(sql`
      SELECT p.id, p.slug, p.name, p.timezone,
             o.slug AS operator_slug, o.name AS operator_name, r.name AS resort_name,
             p.latitude, p.longitude, p.lat_min, p.lat_max, p.lng_min, p.lng_max, p.map_zoom,
             p.boundary, p.image_url, p.image_alt, p.image_thumbhash, p.hero_media
      FROM parks p
      LEFT JOIN operators o ON o.id = p.operator_id
      LEFT JOIN resorts r ON r.id = p.resort_id
      WHERE p.active = true
      ORDER BY r.name, p.name
    `);
    return result.rows.map((p) => ({
      id: Number(p.id),
      slug: p.slug,
      name: p.name,
      timezone: p.timezone,
      operatorSlug: p.operator_slug,
      operatorName: p.operator_name,
      resortName: p.resort_name,
      latitude: p.latitude,
      longitude: p.longitude,
      bounds:
        p.lat_min != null && p.lat_max != null && p.lng_min != null && p.lng_max != null
          ? { latMin: p.lat_min, latMax: p.lat_max, lngMin: p.lng_min, lngMax: p.lng_max }
          : null,
      mapZoom: p.map_zoom,
      boundary: p.boundary,
      imageUrl: p.image_url,
      imageAlt: p.image_alt,
      imageThumbhash: p.image_thumbhash,
      // Full hero carousel slides (plan item 1.9) — Disney parks only for now.
      heroMedia: p.hero_media ?? [],
    }));
  }),

  /**
   * Cross-park "stock ticker" of live STANDBY waits: every operating ride with a
   * current posted wait, plus the delta vs. ~30 min earlier so the UI can render
   * up/down trend signals. Ordered busiest-first; a wide 3h freshness window and
   * generous cap keep the marquee a long, varied list rather than a few repeats.
   */
  ticker: publicProcedure.query(async () => {
    const result = await db.execute<{
      ride_name: string;
      ride_slug: string;
      park_slug: string;
      park_name: string;
      wait_min: number;
      prev_wait: number | null;
    }>(sql`
      WITH latest AS (
        SELECT DISTINCT ON (q.attraction_id) q.attraction_id, q.wait_min
        FROM queue_obs q
        WHERE q.queue_type = 1
          AND q.observed_at >= now() - INTERVAL '180 minutes'
        ORDER BY q.attraction_id, q.observed_at DESC
      ),
      prev AS (
        SELECT DISTINCT ON (q.attraction_id) q.attraction_id, q.wait_min
        FROM queue_obs q
        WHERE q.queue_type = 1
          AND q.observed_at <= now() - INTERVAL '30 minutes'
          AND q.observed_at >= now() - INTERVAL '210 minutes'
        ORDER BY q.attraction_id, q.observed_at DESC
      )
      SELECT a.name AS ride_name, a.slug AS ride_slug,
             p.slug AS park_slug, p.name AS park_name,
             l.wait_min, pr.wait_min AS prev_wait
      FROM latest l
      JOIN attractions a ON a.id = l.attraction_id AND a.active = true
      JOIN parks p ON p.id = a.park_id AND p.active = true
      LEFT JOIN prev pr ON pr.attraction_id = l.attraction_id
      WHERE l.wait_min IS NOT NULL AND l.wait_min > 0
      ORDER BY l.wait_min DESC, a.name
      LIMIT 30
    `);
    return result.rows.map((r) => {
      const delta = r.prev_wait == null ? 0 : r.wait_min - r.prev_wait;
      return {
        rideName: r.ride_name,
        rideSlug: r.ride_slug,
        parkSlug: r.park_slug,
        parkName: r.park_name,
        waitMin: r.wait_min,
        delta,
        trend: delta > 0 ? ("up" as const) : delta < 0 ? ("down" as const) : ("flat" as const),
      };
    });
  }),

  /** Paid/virtual products a park sells (capability — drives UI tabs). */
  products: publicProcedure.input(z.object({ parkSlug: z.string() })).query(async ({ input }) => {
    const result = await db.execute<{
      code: string;
      pricing_grain: string;
      display_name: string;
    }>(sql`
        SELECT rp.code, rp.pricing_grain, pp.display_name
        FROM park_products pp
        JOIN ref_product rp ON rp.id = pp.product_id
        JOIN parks p ON p.id = pp.park_id
        WHERE p.slug = ${input.parkSlug} AND pp.active = true
        ORDER BY pp.product_id
      `);
    return result.rows.map((r) => ({
      code: r.code,
      pricingGrain: r.pricing_grain,
      displayName: r.display_name,
    }));
  }),

  /**
   * Current board for a park: per-attraction latest status (carry-forward) +
   * latest STANDBY wait + latest LL (paid return) + latest return-time state.
   */
  board: publicProcedure.input(z.object({ parkSlug: z.string() })).query(async ({ input }) => {
    const result = await db.execute<{
      id: string;
      name: string;
      slug: string;
      entity_type: string;
      status: number | null;
      standby_wait: number | null;
      ll_state: number | null;
      ll_price_cents: number | null;
      ll_currency: string | null;
      ll_return_start: string | null;
      ll_return_end: string | null;
      return_state: number | null;
      return_start: string | null;
      return_end: string | null;
      observed_at: string | null;
      showtimes: Array<{ type: string | null; start: string | null; end: string | null }> | null;
      support_types: Array<number> | null;
      hist_standby_wait: number | null;
      latitude: number | null;
      longitude: number | null;
      category: string | null;
      meta_image_thumb_url: string | null;
      meta_image_hero_url: string | null;
      meta_image_alt: string | null;
      meta_image_thumbhash: string | null;
      meta_detail_url: string | null;
      meta_land: string | null;
      meta_height_requirement: string | null;
      meta_tags: Array<string> | null;
      hours_today: Array<{ type: string | null; start: string | null; end: string | null }> | null;
      is_open: boolean | null;
      has_schedule: boolean;
    }>(sql`
        WITH park AS (SELECT id FROM parks WHERE slug = ${input.parkSlug}),
        -- Latest daily snapshot's view of this park's operating windows, reused
        -- from the overview query's schedule gating so the per-park board agrees
        -- with the cross-park map: the upstream feed keeps rides marked OPERATING
        -- (and re-posts waits) overnight, so a calendar gate is the only honest
        -- way to know the park is actually shut.
        sched AS (
          SELECT DISTINCT ON (service_date, opening_time) opening_time, closing_time
          FROM park_schedule
          WHERE park_id = (SELECT id FROM park)
            AND type IN ${OPEN_SCHEDULE_TYPES}
            AND closing_time IS NOT NULL
          ORDER BY service_date, opening_time, snapshot_date DESC
        ),
        park_open AS (
          SELECT bool_or(opening_time <= now() AND now() < closing_time) AS is_open,
                 count(*) > 0 AS has_schedule
          FROM sched
        ),
        -- Capability: every queue type ever seen for the ride (authoritative
        -- "does it offer a paid/virtual line?", independent of current posting).
        caps AS (
          SELECT s.attraction_id, array_agg(DISTINCT s.queue_type) AS qtypes
          FROM attraction_queue_support s
          JOIN attractions a ON a.id = s.attraction_id
          WHERE a.park_id = (SELECT id FROM park)
          GROUP BY s.attraction_id
        ),
        -- Current state from the worker-maintained mirror (Phase 3): a plain
        -- lookup instead of DISTINCT ON scans over the change-logs. status
        -- carries forward unbounded (matching the old latest_status CTE); the
        -- wait/LL/return fields null out once the snapshot is >24h stale
        -- (matching latest_q's 24h window — only reached when an attraction drops
        -- out of the feed, since a polled ride is re-upserted every tick).
        live AS (
          SELECT al.attraction_id,
                 al.status,
                 al.observed_at,
                 CASE WHEN al.observed_at >= now() - INTERVAL '24 hours' THEN al.standby_wait END AS standby_wait,
                 CASE WHEN al.observed_at >= now() - INTERVAL '24 hours' THEN al.ll_state END AS ll_state,
                 CASE WHEN al.observed_at >= now() - INTERVAL '24 hours' THEN al.ll_price_cents END AS ll_price_cents,
                 CASE WHEN al.observed_at >= now() - INTERVAL '24 hours' THEN al.ll_currency END AS ll_currency,
                 CASE WHEN al.observed_at >= now() - INTERVAL '24 hours' THEN al.ll_return_start END AS ll_return_start,
                 CASE WHEN al.observed_at >= now() - INTERVAL '24 hours' THEN al.ll_return_end END AS ll_return_end,
                 CASE WHEN al.observed_at >= now() - INTERVAL '24 hours' THEN al.return_state END AS return_state,
                 CASE WHEN al.observed_at >= now() - INTERVAL '24 hours' THEN al.return_start END AS return_start,
                 CASE WHEN al.observed_at >= now() - INTERVAL '24 hours' THEN al.return_end END AS return_end,
                 CASE WHEN al.observed_at >= now() - INTERVAL '24 hours' THEN al.showtimes END AS showtimes,
                 CASE WHEN al.observed_at >= now() - INTERVAL '24 hours' THEN al.hours_today END AS hours_today
          FROM attraction_live al
          JOIN attractions a ON a.id = al.attraction_id
          WHERE a.park_id = (SELECT id FROM park)
        ),
        -- 24–48h-ago standby baseline for the delta indicator, read from the
        -- queue_hourly continuous aggregate (samples-weighted mean of hourly
        -- avgs) instead of scanning raw queue_obs. The window is entirely >24h
        -- old, so the cagg (1h refresh lag) is fully materialized for it.
        hist AS (
          SELECT qh.attraction_id,
                 (sum(qh.avg_wait::numeric * qh.samples) / nullif(sum(qh.samples), 0))::int AS hist_standby_wait
          FROM queue_hourly qh
          JOIN attractions a ON a.id = qh.attraction_id
          WHERE a.park_id = (SELECT id FROM park)
            AND qh.queue_type = 1
            AND qh.bucket >= now() - INTERVAL '48 hours'
            AND qh.bucket < now() - INTERVAL '24 hours'
          GROUP BY qh.attraction_id
        )
        SELECT a.id, a.name, a.slug, a.entity_type,
               lv.status,
               lv.standby_wait AS standby_wait,
               lv.observed_at,
               lv.ll_state, lv.ll_price_cents, lv.ll_currency,
               lv.ll_return_start, lv.ll_return_end,
               lv.return_state, lv.return_start, lv.return_end,
               lv.showtimes,
               lv.hours_today,
               caps.qtypes AS support_types,
               hist.hist_standby_wait,
               a.latitude, a.longitude, a.category,
               m.image_thumb_url AS meta_image_thumb_url,
               m.image_hero_url AS meta_image_hero_url,
               m.image_alt AS meta_image_alt,
               m.image_thumbhash AS meta_image_thumbhash,
               m.detail_url AS meta_detail_url,
               m.land AS meta_land,
               m.height_requirement AS meta_height_requirement,
               m.tags AS meta_tags,
               (SELECT is_open FROM park_open) AS is_open,
               (SELECT has_schedule FROM park_open) AS has_schedule
        FROM attractions a
        LEFT JOIN live lv ON lv.attraction_id = a.id
        LEFT JOIN caps ON caps.attraction_id = a.id
        LEFT JOIN hist ON hist.attraction_id = a.id
        LEFT JOIN attraction_meta m ON m.attraction_id = a.id
        WHERE a.park_id = (SELECT id FROM park) AND a.active = true
        ORDER BY a.name
      `);
    // When the operating calendar says the park is closed, suppress live tallies:
    // the feed leaves rides OPERATING and re-posts waits overnight, so every live
    // field (status/standby/LL/return time) is reported as closed/empty. No
    // schedule (has_schedule = false) trusts the live carry-forward as before.
    // Capability + historical baseline (supportsQueueTypes, histStandbyWait) stay,
    // since they aren't claims about the park being open right now.
    const knownClosed = Boolean(result.rows[0]?.has_schedule) && result.rows[0]?.is_open === false;
    return result.rows.map((r) => ({
      id: Number(r.id),
      name: r.name,
      slug: r.slug,
      entityType: r.entity_type,
      status: knownClosed ? "CLOSED" : code(STATUS_CODE, r.status),
      standbyWait: knownClosed ? null : r.standby_wait,
      observedAt: r.observed_at,
      lightningLane: knownClosed
        ? { state: null, priceCents: null, currency: null, returnStart: null, returnEnd: null }
        : {
            state: code(QUEUE_STATE_CODE, r.ll_state),
            priceCents: r.ll_price_cents,
            currency: r.ll_currency?.trim() ?? null,
            returnStart: r.ll_return_start,
            returnEnd: r.ll_return_end,
          },
      returnTimeState: knownClosed ? null : code(QUEUE_STATE_CODE, r.return_state),
      returnTimeWindow: knownClosed
        ? { start: null, end: null }
        : { start: r.return_start ?? null, end: r.return_end ?? null },
      // Today's showtimes for SHOW entities (plan item 1.1); [] otherwise.
      showtimes: knownClosed ? [] : (r.showtimes ?? []).filter((s) => s.start != null),
      // Per-entity operating windows today (plan item 1.4) — feeds the "Early
      // Entry rides today" rail; [] when unposted or the park is closed.
      hoursToday: knownClosed ? [] : (r.hours_today ?? []).filter((h) => h.start != null),
      supportsQueueTypes: (r.support_types ?? []).map(Number),
      histStandbyWait: r.hist_standby_wait,
      latitude: r.latitude,
      longitude: r.longitude,
      category: r.category,
      meta:
        r.meta_image_thumb_url != null ||
        r.meta_image_hero_url != null ||
        r.meta_detail_url != null ||
        r.meta_land != null ||
        r.meta_height_requirement != null ||
        (r.meta_tags != null && r.meta_tags.length > 0)
          ? {
              imageThumbUrl: r.meta_image_thumb_url,
              imageHeroUrl: r.meta_image_hero_url,
              imageAlt: r.meta_image_alt,
              imageThumbhash: r.meta_image_thumbhash,
              detailUrl: r.meta_detail_url,
              land: r.meta_land,
              heightRequirement: r.meta_height_requirement,
              tags: r.meta_tags ?? [],
            }
          : null,
    }));
  }),

  /**
   * Dining venues plottable on the map — every active WDW `restaurant_dim` row
   * with coordinates (resort-wide; the map filters to the focused park by its
   * boundary, mirroring the roam focus logic). Drives the optional "Eats" /
   * "Quick Service" marker layers. `category` is the finder map-pin ('dine' |
   * 'characters'), downgraded to 'quick-service' for non-bookable venues
   * (counter-service restaurants and snack carts/kiosks) so the map can offer
   * them as a separate layer from reservable table-service dining.
   */
  dining: publicProcedure.query(async () => {
    const result = await db.execute<{
      facility_id: string;
      name: string;
      url_friendly_id: string | null;
      latitude: number | null;
      longitude: number | null;
      land: string | null;
      map_pin: string | null;
      bookable: boolean;
      image_url: string | null;
      detail_url: string | null;
    }>(sql`
      SELECT facility_id, name, url_friendly_id, latitude, longitude, land, map_pin, bookable,
             image_url, detail_url
      FROM restaurant_dim
      WHERE active = true AND latitude IS NOT NULL AND longitude IS NOT NULL
      ORDER BY name
    `);
    return result.rows.map((r) => ({
      id: r.facility_id,
      name: r.name,
      // Kept for shape-parity with `shops` (the map merges both into one POI
      // list); dining venues link out to `detailUrl`, not an internal route.
      slug: r.url_friendly_id,
      latitude: r.latitude,
      longitude: r.longitude,
      land: r.land,
      // Character dining keeps its own pin regardless of bookable status;
      // everything else non-bookable (quick service + carts) becomes its own
      // category rather than lumping into 'dine'.
      category: !r.bookable && r.map_pin !== "characters" ? "quick-service" : (r.map_pin ?? "dine"),
      imageUrl: r.image_url,
      detailUrl: r.detail_url,
    }));
  }),

  /**
   * Shops plottable on the map — every active `shop_dim` row with coordinates
   * (resort-wide; filtered to the focused park client-side by boundary). Drives
   * the optional "Shops" marker layer. `merchandise` powers a category filter.
   */
  shops: publicProcedure.query(async () => {
    const result = await db.execute<{
      facility_id: string;
      name: string;
      url_friendly_id: string | null;
      latitude: number | null;
      longitude: number | null;
      land: string | null;
      image_url: string | null;
      detail_url: string | null;
      merchandise: Array<string> | null;
    }>(sql`
      SELECT facility_id, name, url_friendly_id, latitude, longitude, land, image_url, detail_url, merchandise
      FROM shop_dim
      WHERE active = true AND latitude IS NOT NULL AND longitude IS NOT NULL
      ORDER BY name
    `);
    return result.rows.map((r) => ({
      id: r.facility_id,
      name: r.name,
      // Finder slug — deep-links the /shop/$slug detail page (null for a few
      // carts/kiosks; those just aren't linkable).
      slug: r.url_friendly_id,
      latitude: r.latitude,
      longitude: r.longitude,
      land: r.land,
      category: "shop" as const,
      imageUrl: r.image_url,
      detailUrl: r.detail_url,
      merchandise: r.merchandise ?? [],
    }));
  }),

  /**
   * Non-facility POIs plottable on the map — every active `park_poi` row with
   * coordinates (resort-wide; the map clips to the focused park by boundary, as
   * dining/shops do). Drives the optional Services / Entertainment / Tours
   * overlay layers. `category` is the client map-pin class ('info' |
   * 'entertainment' | 'character' | 'tour'); `detailUrl` links the operator page.
   */
  poi: publicProcedure.query(async () => {
    const result = await db.execute<{
      poi_id: string;
      name: string;
      latitude: number | null;
      longitude: number | null;
      land: string | null;
      category: string | null;
      image_url: string | null;
      detail_url: string | null;
    }>(sql`
      SELECT poi_id, name, latitude, longitude, land, category, image_url, detail_url
      FROM park_poi
      WHERE active = true AND latitude IS NOT NULL AND longitude IS NOT NULL
      ORDER BY name
    `);
    return result.rows.map((r) => ({
      id: r.poi_id,
      name: r.name,
      // No internal detail page for these; the POI card links out via detailUrl.
      slug: null,
      latitude: r.latitude,
      longitude: r.longitude,
      land: r.land,
      category: r.category ?? "info",
      imageUrl: r.image_url,
      detailUrl: r.detail_url,
    }));
  }),

  /**
   * One shop by its finder slug (`url_friendly_id`) — backs the `/shop/$slug`
   * detail page (deep-linking + SEO). Returns null when the slug is unknown or
   * the shop has gone inactive.
   */
  shop: publicProcedure.input(z.object({ slug: z.string() })).query(async ({ input }) => {
    const result = await db.execute<{
      facility_id: string;
      name: string;
      url_friendly_id: string | null;
      land: string | null;
      park_resort: string | null;
      image_url: string | null;
      image_thumbhash: string | null;
      detail_url: string | null;
      merchandise: Array<string> | null;
      latitude: number | null;
      longitude: number | null;
      description: string | null;
    }>(sql`
      SELECT facility_id, name, url_friendly_id, land, park_resort, image_url, image_thumbhash,
             detail_url, merchandise, latitude, longitude, description
      FROM shop_dim
      WHERE active = true AND url_friendly_id = ${input.slug}
      LIMIT 1
    `);
    const r = result.rows[0];
    if (!r) return null;
    // Reversible content suppression from the removal-request flow.
    const suppressed = await suppressedFields("shop", r.facility_id);
    if (suppressed.has("*")) return null;
    return {
      id: r.facility_id,
      name: r.name,
      slug: r.url_friendly_id,
      land: r.land,
      parkResort: r.park_resort,
      imageUrl: suppressed.has("image") ? null : r.image_url,
      imageThumbhash: suppressed.has("image") ? null : r.image_thumbhash,
      detailUrl: r.detail_url,
      merchandise: r.merchandise ?? [],
      latitude: r.latitude,
      longitude: r.longitude,
      // Official marketing copy (plan item 2.3) — UOR shops only until a WDW
      // shop-detail fetch pass exists.
      description: suppressed.has("description") ? null : r.description,
    };
  }),

  /**
   * Every active ride across all parks with its live status + standby wait + the
   * fields the unified Waits list filters on (category, land, height requirement,
   * thumbnail) and its park/operator context. Mirrors `board`'s per-park schedule
   * gating (a calendar-closed park's rides are reported CLOSED / wait null) but
   * cross-park. Ghost duplicate rows (null category) are dropped.
   */
  allRides: publicProcedure.query(async () => {
    const result = await db.execute<{
      id: string;
      name: string;
      slug: string;
      category: string | null;
      status: number | null;
      standby_wait: number | null;
      latitude: number | null;
      longitude: number | null;
      park_slug: string;
      park_name: string;
      operator_slug: string | null;
      operator_name: string | null;
      meta_land: string | null;
      meta_height_requirement: string | null;
      meta_image_thumb_url: string | null;
      meta_image_hero_url: string | null;
      meta_image_alt: string | null;
      meta_image_thumbhash: string | null;
      is_open: boolean | null;
      has_schedule: boolean;
    }>(sql`
      WITH live AS (
        -- Current state from the worker-maintained mirror (Phase 3), same shape
        -- as board/overview: status carries forward unbounded; standby nulls out
        -- once the snapshot is >24h stale (matching the old latest_standby 24h
        -- window).
        SELECT al.attraction_id,
               al.status,
               CASE WHEN al.observed_at >= now() - INTERVAL '24 hours' THEN al.standby_wait END AS wait_min
        FROM attraction_live al
      ),
      sched AS (
        SELECT DISTINCT ON (park_id, service_date, opening_time)
               park_id, opening_time, closing_time
        FROM park_schedule
        WHERE type IN ${OPEN_SCHEDULE_TYPES} AND closing_time IS NOT NULL
        ORDER BY park_id, service_date, opening_time, snapshot_date DESC
      ),
      park_open AS (
        SELECT p.id AS park_id,
               bool_or(s.opening_time <= now() AND now() < s.closing_time) AS is_open,
               count(s.opening_time) > 0 AS has_schedule
        FROM parks p
        LEFT JOIN sched s ON s.park_id = p.id
        GROUP BY p.id
      )
      SELECT a.id, a.name, a.slug, a.category, a.latitude, a.longitude,
             lv.status, lv.wait_min AS standby_wait,
             p.slug AS park_slug, p.name AS park_name,
             o.slug AS operator_slug, o.name AS operator_name,
             m.land AS meta_land, m.height_requirement AS meta_height_requirement,
             m.image_thumb_url AS meta_image_thumb_url,
             m.image_hero_url AS meta_image_hero_url,
             m.image_alt AS meta_image_alt,
             m.image_thumbhash AS meta_image_thumbhash,
             po.is_open, coalesce(po.has_schedule, false) AS has_schedule
      FROM attractions a
      JOIN parks p ON p.id = a.park_id AND p.active = true
      LEFT JOIN operators o ON o.id = p.operator_id
      LEFT JOIN live lv ON lv.attraction_id = a.id
      LEFT JOIN attraction_meta m ON m.attraction_id = a.id
      LEFT JOIN park_open po ON po.park_id = p.id
      WHERE a.active = true AND a.entity_type = 'ATTRACTION' AND a.category IS NOT NULL
      ORDER BY p.name, a.name
    `);
    return result.rows.map((r) => {
      const knownClosed = Boolean(r.has_schedule) && r.is_open === false;
      return {
        id: Number(r.id),
        name: r.name,
        slug: r.slug,
        category: r.category,
        status: knownClosed ? "CLOSED" : code(STATUS_CODE, r.status),
        standbyWait: knownClosed ? null : r.standby_wait,
        latitude: r.latitude,
        longitude: r.longitude,
        parkSlug: r.park_slug,
        parkName: r.park_name,
        operatorSlug: r.operator_slug,
        operatorName: r.operator_name,
        land: r.meta_land,
        heightRequirement: r.meta_height_requirement,
        imageThumbUrl: r.meta_image_thumb_url,
        // Card-sized (600px) variant for the ride shelves; falls back to the
        // hero, then the raw thumb, for non-Disney assets that lack the resize
        // segment.
        imageCardUrl:
          disneyCardUrl(r.meta_image_thumb_url) ?? r.meta_image_hero_url ?? r.meta_image_thumb_url,
        imageHeroUrl: r.meta_image_hero_url,
        imageAlt: r.meta_image_alt,
        imageThumbhash: r.meta_image_thumbhash,
      };
    });
  }),

  /**
   * Operating hours for a park over a date range (defaults to today + the next
   * 13 days). Reads the latest daily snapshot of `park_schedule` — the same feed
   * the open/closed gating uses — and groups by service date into a regular
   * OPERATING window (the earliest open / latest close, so split-operation days
   * collapse to one envelope) plus any extra windows (Early Entry, Extended
   * Evening, hard-ticket events). `timestamptz` instants are returned raw; the
   * client renders them in the park's `timezone` (also returned).
   */
  hours: publicProcedure
    .input(
      z.object({
        parkSlug: z.string(),
        startDate: z.string().optional(),
        endDate: z.string().optional(),
      }),
    )
    .query(async ({ input }) => {
      // Default bounds use the park-local date, not the DB's current_date (UTC):
      // otherwise today's row drops out of the range once UTC rolls over in the
      // park's evening, and the UI reads it as "Closed today".
      const localToday = sql`(now() AT TIME ZONE (SELECT timezone FROM park))::date`;
      const start = input.startDate ? sql`${input.startDate}::date` : localToday;
      const end = input.endDate
        ? sql`${input.endDate}::date`
        : sql`${localToday} + INTERVAL '13 days'`;
      const result = await db.execute<{
        timezone: string;
        service_date: string;
        type: string;
        opening_time: string;
        closing_time: string | null;
        description: string | null;
      }>(sql`
        WITH park AS (SELECT id, timezone FROM parks WHERE slug = ${input.parkSlug})
        SELECT DISTINCT ON (s.service_date, s.type, s.opening_time)
               (SELECT timezone FROM park) AS timezone,
               s.service_date, s.type, s.opening_time, s.closing_time, s.description
        FROM park_schedule s
        WHERE s.park_id = (SELECT id FROM park)
          AND s.service_date >= ${start}
          AND s.service_date <= ${end}
        ORDER BY s.service_date, s.type, s.opening_time, s.snapshot_date DESC
      `);

      type Extra = {
        type: string;
        description: string | null;
        open: string;
        close: string | null;
      };
      const byDate = new Map<
        string,
        { open: string | null; close: string | null; extras: Array<Extra> }
      >();
      for (const r of result.rows) {
        const e = byDate.get(r.service_date) ?? { open: null, close: null, extras: [] };
        if (r.type === "OPERATING") {
          if (!e.open || r.opening_time < e.open) e.open = r.opening_time;
          if (r.closing_time && (!e.close || r.closing_time > e.close)) e.close = r.closing_time;
        } else if (r.type === "EXTRA_HOURS" || r.type === "TICKETED_EVENT") {
          e.extras.push({
            type: r.type,
            description: r.description,
            open: r.opening_time,
            close: r.closing_time,
          });
        }
        byDate.set(r.service_date, e);
      }

      const days = [...byDate.entries()]
        .map(([date, v]) => ({ date, open: v.open, close: v.close, extras: v.extras }))
        .sort((a, b) => a.date.localeCompare(b.date));

      return { timezone: result.rows[0]?.timezone ?? "America/New_York", days };
    }),

  /**
   * Single attraction detail (`/park/$slug/ride/$rideSlug`). Same per-ride shape
   * as a `board` row — latest carried status + latest STANDBY/LL/return-time
   * `queue_obs` within 24h + queue-type capability + 24-48h historical baseline —
   * scoped to one ride, plus the park context the page header needs. Slugs are
   * unique only within a park, so both keys are required. Returns null when the
   * (park, ride) pair is unknown.
   */
  /**
   * One attraction by numeric id, deliberately light: name + coords for the nav
   * deep link (`/map?nav=<id>`), plus the current standby/status for the live
   * "wait at your destination" chip while navigating (§3.5). No schedule gating
   * — the chip only renders for OPERATING, so an overnight carry-forward wait
   * never shows.
   */
  attractionById: publicProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .query(async ({ input }) => {
      const result = await db.execute<{
        id: string;
        name: string;
        latitude: number | null;
        longitude: number | null;
        status: number | null;
        standby_wait: number | null;
      }>(sql`
        SELECT a.id, a.name, a.latitude, a.longitude,
               (SELECT s.status FROM attraction_status_obs s
                 WHERE s.attraction_id = a.id
                 ORDER BY s.observed_at DESC LIMIT 1) AS status,
               (SELECT q.wait_min FROM queue_obs q
                 WHERE q.attraction_id = a.id AND q.queue_type = 1
                   AND q.observed_at >= now() - INTERVAL '24 hours'
                 ORDER BY q.observed_at DESC LIMIT 1) AS standby_wait
        FROM attractions a
        WHERE a.id = ${input.id} AND a.active = true
        LIMIT 1
      `);
      const r = result.rows[0];
      if (!r) return null;
      return {
        id: Number(r.id),
        name: r.name,
        latitude: r.latitude,
        longitude: r.longitude,
        status: code(STATUS_CODE, r.status),
        standbyWait: r.standby_wait,
      };
    }),

  attraction: publicProcedure
    .input(z.object({ parkSlug: z.string(), rideSlug: z.string() }))
    .query(async ({ input }) => {
      const result = await db.execute<{
        id: string;
        name: string;
        slug: string;
        entity_type: string;
        park_id: string;
        park_slug: string;
        park_name: string;
        park_timezone: string;
        operator_slug: string | null;
        resort_name: string | null;
        status: number | null;
        standby_wait: number | null;
        ll_state: number | null;
        ll_price_cents: number | null;
        ll_currency: string | null;
        ll_return_start: string | null;
        ll_return_end: string | null;
        return_state: number | null;
        return_start: string | null;
        return_end: string | null;
        observed_at: string | null;
        showtimes: Array<{ type: string | null; start: string | null; end: string | null }> | null;
        hours_today: Array<{
          type: string | null;
          start: string | null;
          end: string | null;
        }> | null;
        boarding_group: number | null;
        boarding_group_end: number | null;
        boarding_allocation: number | null;
        support_types: Array<number> | null;
        hist_standby_wait: number | null;
        latitude: number | null;
        longitude: number | null;
        category: string | null;
        meta_image_thumb_url: string | null;
        meta_image_hero_url: string | null;
        meta_image_alt: string | null;
        meta_image_thumbhash: string | null;
        meta_detail_url: string | null;
        meta_land: string | null;
        meta_height_requirement: string | null;
        meta_tags: Array<string> | null;
        meta_description: string | null;
        meta_hero_media: Array<ParkHeroSlide> | null;
        coaster_track_length_m: number | null;
        coaster_top_speed_kmh: number | null;
        coaster_drop_height_m: number | null;
        coaster_max_height_m: number | null;
        coaster_inversions: number | null;
        coaster_type: string | null;
        coaster_manufacturer: string | null;
        coaster_opened_year: number | null;
      }>(sql`
        WITH park AS (SELECT id FROM parks WHERE slug = ${input.parkSlug}),
        ride AS (
          SELECT id FROM attractions
          WHERE park_id = (SELECT id FROM park) AND slug = ${input.rideSlug} AND active = true
          LIMIT 1
        ),
        latest_status AS (
          SELECT DISTINCT ON (s.attraction_id) s.attraction_id, s.status
          FROM attraction_status_obs s
          WHERE s.attraction_id = (SELECT id FROM ride)
          ORDER BY s.attraction_id, s.observed_at DESC
        ),
        latest_q AS (
          SELECT DISTINCT ON (q.queue_type)
                 q.queue_type, q.wait_min, q.state,
                 q.price_cents, q.currency, q.return_start, q.return_end,
                 q.observed_at
          FROM queue_obs q
          WHERE q.attraction_id = (SELECT id FROM ride)
            AND q.observed_at >= now() - INTERVAL '24 hours'
          ORDER BY q.queue_type, q.observed_at DESC
        ),
        caps AS (
          SELECT array_agg(DISTINCT s.queue_type) AS qtypes
          FROM attraction_queue_support s
          WHERE s.attraction_id = (SELECT id FROM ride)
        ),
        hist AS (
          SELECT avg(q.wait_min)::int AS hist_standby_wait
          FROM queue_obs q
          WHERE q.attraction_id = (SELECT id FROM ride)
            AND q.queue_type = 1
            AND q.observed_at >= now() - INTERVAL '48 hours'
            AND q.observed_at < now() - INTERVAL '24 hours'
        )
        SELECT a.id, a.name, a.slug, a.entity_type,
               p.id AS park_id, p.slug AS park_slug, p.name AS park_name,
               p.timezone AS park_timezone,
               o.slug AS operator_slug, r.name AS resort_name,
               ls.status,
               sb.wait_min AS standby_wait,
               sb.observed_at,
               prt.state AS ll_state, prt.price_cents AS ll_price_cents,
               prt.currency AS ll_currency,
               prt.return_start AS ll_return_start, prt.return_end AS ll_return_end,
               rt.state AS return_state,
               rt.return_start AS return_start, rt.return_end AS return_end,
               al.showtimes AS showtimes,
               al.hours_today AS hours_today,
               al.boarding_group, al.boarding_group_end, al.boarding_allocation,
               caps.qtypes AS support_types,
               hist.hist_standby_wait,
               a.latitude, a.longitude, a.category,
               m.image_thumb_url AS meta_image_thumb_url,
               m.image_hero_url AS meta_image_hero_url,
               m.image_alt AS meta_image_alt,
               m.image_thumbhash AS meta_image_thumbhash,
               m.detail_url AS meta_detail_url,
               m.land AS meta_land,
               m.height_requirement AS meta_height_requirement,
               m.tags AS meta_tags,
               m.description AS meta_description,
               m.hero_media AS meta_hero_media,
               cs.track_length_m AS coaster_track_length_m,
               cs.top_speed_kmh AS coaster_top_speed_kmh,
               cs.drop_height_m AS coaster_drop_height_m,
               cs.max_height_m AS coaster_max_height_m,
               cs.inversions AS coaster_inversions,
               cs.coaster_type AS coaster_type,
               cs.manufacturer AS coaster_manufacturer,
               cs.opened_year AS coaster_opened_year
        FROM attractions a
        JOIN parks p ON p.id = a.park_id
        LEFT JOIN operators o ON o.id = p.operator_id
        LEFT JOIN resorts r ON r.id = p.resort_id
        LEFT JOIN latest_status ls ON ls.attraction_id = a.id
        LEFT JOIN latest_q sb ON sb.queue_type = 1
        LEFT JOIN latest_q prt ON prt.queue_type = 4
        LEFT JOIN latest_q rt ON rt.queue_type = 3
        LEFT JOIN caps ON true
        LEFT JOIN hist ON true
        LEFT JOIN attraction_live al ON al.attraction_id = a.id
        LEFT JOIN attraction_meta m ON m.attraction_id = a.id
        LEFT JOIN coaster_stats cs ON cs.attraction_id = a.id
        WHERE a.id = (SELECT id FROM ride)
      `);
      const r = result.rows[0];
      if (!r) return null;
      // Reversible content suppression from the removal-request flow.
      const suppressed = await suppressedFields("attraction", String(r.id));
      if (suppressed.has("*")) return null;
      const hideImage = suppressed.has("image");
      // "Open in Disney App" handoff: only meaningful for a Disney ride whose
      // Lightning Lane is currently grabbable (AVAILABLE/LIMITED). Universal has
      // no MDE, and the day-level My Genie Day link is misleading when LL is
      // sold out / not offered. See lightningLaneDeepLink.ts for the ceiling.
      const llGrabbable = r.ll_state === QueueState.AVAILABLE || r.ll_state === QueueState.LIMITED;
      const lightningLaneDeepLink =
        r.operator_slug !== "universal" && llGrabbable
          ? buildLightningLaneDeepLink(`${config.appBaseUrl}/park/${r.park_slug}/ride/${r.slug}`)
          : null;
      return {
        id: Number(r.id),
        name: r.name,
        slug: r.slug,
        entityType: r.entity_type,
        park: {
          id: Number(r.park_id),
          slug: r.park_slug,
          name: r.park_name,
          timezone: r.park_timezone,
          operatorSlug: r.operator_slug,
          resortName: r.resort_name,
        },
        status: code(STATUS_CODE, r.status),
        standbyWait: r.standby_wait,
        observedAt: r.observed_at,
        lightningLane: {
          state: code(QUEUE_STATE_CODE, r.ll_state),
          priceCents: r.ll_price_cents,
          currency: r.ll_currency?.trim() ?? null,
          returnStart: r.ll_return_start,
          returnEnd: r.ll_return_end,
        },
        returnTimeState: code(QUEUE_STATE_CODE, r.return_state),
        returnTimeWindow: { start: r.return_start ?? null, end: r.return_end ?? null },
        // Today's performances for SHOW entities (plan item 1.1); [] otherwise.
        showtimes: (r.showtimes ?? []).filter((s) => s.start != null),
        // Per-entity operating windows today (plan item 1.4); [] when unposted.
        hoursToday: (r.hours_today ?? []).filter((h) => h.start != null),
        // Boarding-group range + allocation state (plan item 1.5). Allocation
        // reuses the QueueState vocabulary (SOLD_OUT = all groups distributed).
        boardingGroup: r.boarding_group,
        boardingGroupEnd: r.boarding_group_end,
        boardingAllocation: code(QUEUE_STATE_CODE, r.boarding_allocation),
        lightningLaneDeepLink,
        supportsQueueTypes: (r.support_types ?? []).map(Number),
        histStandbyWait: r.hist_standby_wait,
        latitude: r.latitude,
        longitude: r.longitude,
        category: r.category,
        meta:
          r.meta_image_thumb_url != null ||
          r.meta_image_hero_url != null ||
          r.meta_detail_url != null ||
          r.meta_land != null ||
          r.meta_height_requirement != null ||
          r.meta_description != null ||
          (r.meta_tags != null && r.meta_tags.length > 0)
            ? {
                imageThumbUrl: hideImage ? null : r.meta_image_thumb_url,
                imageHeroUrl: hideImage ? null : r.meta_image_hero_url,
                imageAlt: r.meta_image_alt,
                imageThumbhash: hideImage ? null : r.meta_image_thumbhash,
                detailUrl: r.meta_detail_url,
                land: r.meta_land,
                heightRequirement: r.meta_height_requirement,
                tags: r.meta_tags ?? [],
                // Official marketing copy (plan item 2.3) — the About section.
                description: suppressed.has("description") ? null : r.meta_description,
                // Full media collection (plan item 1.9, ride-level) — stills +
                // ambient video/cinemagraph loops for the hero.
                heroMedia: hideImage ? [] : (r.meta_hero_media ?? []),
              }
            : null,
        // Published coaster facts (from coaster_stats). Present only when the
        // ride is a catalogued coaster; null otherwise. Public, indexable.
        coasterStats:
          r.coaster_track_length_m != null ||
          r.coaster_top_speed_kmh != null ||
          r.coaster_drop_height_m != null ||
          r.coaster_max_height_m != null ||
          r.coaster_inversions != null ||
          r.coaster_type != null ||
          r.coaster_manufacturer != null ||
          r.coaster_opened_year != null
            ? {
                trackLengthM: r.coaster_track_length_m,
                topSpeedKmh: r.coaster_top_speed_kmh,
                dropHeightM: r.coaster_drop_height_m,
                maxHeightM: r.coaster_max_height_m,
                inversions: r.coaster_inversions,
                coasterType: r.coaster_type,
                manufacturer: r.coaster_manufacturer,
                openedYear: r.coaster_opened_year,
              }
            : null,
      };
    }),

  /**
   * Cross-park overview for the map dashboard: per-park live stats (avg standby
   * wait, operating count, longest ride) for the markers, rolled up into a global
   * headline and a per-resort (Disney vs Universal) split. Reuses the
   * latest-per-attraction CTE shape from `board`.
   */
  overview: publicProcedure.query(async () => {
    const result = await db.execute<{
      id: string;
      slug: string;
      name: string;
      latitude: number | null;
      longitude: number | null;
      boundary: GeoPolygon | null;
      image_url: string | null;
      image_alt: string | null;
      image_thumbhash: string | null;
      operator_slug: string | null;
      operator_name: string | null;
      resort_name: string | null;
      total_rides: number;
      operating: number;
      wait_samples: number;
      avg_wait: number | null;
      longest_name: string | null;
      longest_wait: number | null;
      is_open: boolean | null;
      has_schedule: boolean;
      opens_at: string | null;
    }>(sql`
      -- Current state from the worker-maintained mirror (Phase 3): one row per
      -- attraction instead of DISTINCT ON scans over the change-logs. status
      -- carries forward unbounded (the WDW feed leaves some rides marked
      -- OPERATING for hours/days; bounding by age would wrongly drop genuinely-
      -- open rides — overnight "still shows operating" is handled by the schedule
      -- gate below). Standby nulls out once the snapshot is >24h stale, matching
      -- the old latest_standby 24h window.
      WITH live AS (
        SELECT al.attraction_id,
               al.status,
               CASE WHEN al.observed_at >= now() - INTERVAL '24 hours' THEN al.standby_wait END AS wait_min
        FROM attraction_live al
      ),
      ride AS (
        SELECT a.id, a.park_id, a.name,
               lv.status AS status, lv.wait_min AS wait_min
        FROM attractions a
        LEFT JOIN live lv ON lv.attraction_id = a.id
        WHERE a.active = true AND a.entity_type = 'ATTRACTION'
      ),
      park_agg AS (
        SELECT park_id,
               count(*) AS total_rides,
               count(*) FILTER (WHERE status = 1) AS operating,
               count(*) FILTER (WHERE status = 1 AND wait_min IS NOT NULL) AS wait_samples,
               avg(wait_min) FILTER (WHERE status = 1 AND wait_min IS NOT NULL)::int AS avg_wait
        FROM ride
        GROUP BY park_id
      ),
      longest AS (
        SELECT DISTINCT ON (park_id) park_id, name AS longest_name, wait_min AS longest_wait
        FROM ride
        WHERE status = 1 AND wait_min IS NOT NULL
        ORDER BY park_id, wait_min DESC
      ),
      -- Latest daily snapshot's view of each park's operating windows, reusing the
      -- DISTINCT ON … snapshot_date DESC shape from parkHistory.
      sched AS (
        SELECT DISTINCT ON (park_id, service_date, opening_time)
               park_id, opening_time, closing_time
        FROM park_schedule
        WHERE type IN ${OPEN_SCHEDULE_TYPES} AND closing_time IS NOT NULL
        ORDER BY park_id, service_date, opening_time, snapshot_date DESC
      ),
      -- Per-park current open/closed state from the operating calendar. Parks
      -- with no schedule rows get is_open = NULL / has_schedule = false so the UI
      -- can degrade to "hours unavailable" rather than claiming live operation.
      park_open AS (
        SELECT p.id AS park_id,
               bool_or(s.opening_time <= now() AND now() < s.closing_time) AS is_open,
               min(s.opening_time) FILTER (WHERE s.opening_time > now()) AS opens_at,
               count(s.opening_time) > 0 AS has_schedule
        FROM parks p
        LEFT JOIN sched s ON s.park_id = p.id
        GROUP BY p.id
      )
      SELECT p.id, p.slug, p.name, p.latitude, p.longitude, p.boundary, p.image_url, p.image_alt,
             p.image_thumbhash,
             o.slug AS operator_slug, o.name AS operator_name, r.name AS resort_name,
             coalesce(pa.total_rides, 0) AS total_rides,
             coalesce(pa.operating, 0) AS operating,
             coalesce(pa.wait_samples, 0) AS wait_samples,
             pa.avg_wait,
             l.longest_name, l.longest_wait,
             po.is_open, coalesce(po.has_schedule, false) AS has_schedule, po.opens_at
      FROM parks p
      LEFT JOIN operators o ON o.id = p.operator_id
      LEFT JOIN resorts r ON r.id = p.resort_id
      LEFT JOIN park_agg pa ON pa.park_id = p.id
      LEFT JOIN longest l ON l.park_id = p.id
      LEFT JOIN park_open po ON po.park_id = p.id
      WHERE p.active = true
      ORDER BY r.name, p.name
    `);

    // Today's Universal Express capacity per park (plan item 3.1). The map's
    // zoomed-out badges show a coarse "nearing/at capacity" chip from this —
    // tier-based, since Universal appears to cap the raw unit count. WDW
    // admission carries no units, so only UOR parks get a chip.
    const capBySlug = new Map<string, CapacityLevel>();
    {
      const expRows = await db.execute<{
        park_scope: Array<string>;
        available: boolean | null;
        available_units: number | null;
      }>(sql`
        SELECT DISTINCT ON (sp.sku) d.park_scope, sp.available, sp.available_units
        FROM sku_price_obs sp
        JOIN product_dim d ON d.sku = sp.sku
        WHERE d.resort = 'UOR' AND d.family = 'EXPRESS' AND d.variable_priced = true
          AND sp.service_date = current_date
        ORDER BY sp.sku, sp.observed_at DESC
      `);
      for (const park of UOR_PARKS) {
        if (!park.slug) continue;
        const rows = expRows.rows.filter((r) => r.park_scope?.includes(park.code));
        if (rows.length === 0) continue;
        const available = rows.some((r) => r.available);
        // Tightest stock among available SKUs covering the park.
        const units = rows
          .filter((r) => r.available && r.available_units != null)
          .reduce<number | null>(
            (m, r) =>
              m == null ? Number(r.available_units) : Math.min(m, Number(r.available_units)),
            null,
          );
        const level = capacityFromUnits(available, units);
        if (level) capBySlug.set(park.slug, level);
      }
    }

    const parks = result.rows.map((p) => {
      // null = no schedule data (UI shows "hours unavailable"); otherwise a
      // confident open/closed derived from the operating calendar.
      const isOpen = p.has_schedule ? Boolean(p.is_open) : null;
      // When the calendar says the park is closed, suppress live tallies: the
      // feed can keep rides marked OPERATING overnight, and we must never show
      // rides as open while the park is closed. No schedule (isOpen === null) =>
      // trust the live carry-forward status.
      const knownClosed = isOpen === false;
      return {
        id: Number(p.id),
        slug: p.slug,
        name: p.name,
        latitude: p.latitude,
        longitude: p.longitude,
        boundary: p.boundary,
        imageUrl: p.image_url,
        imageAlt: p.image_alt,
        imageThumbhash: p.image_thumbhash,
        operatorSlug: p.operator_slug,
        operatorName: p.operator_name,
        resortName: p.resort_name,
        avgWait: knownClosed ? null : p.avg_wait,
        operating: knownClosed ? 0 : Number(p.operating),
        totalRides: Number(p.total_rides),
        waitSamples: knownClosed ? 0 : Number(p.wait_samples),
        longest:
          !knownClosed && p.longest_name != null && p.longest_wait != null
            ? { name: p.longest_name, wait: p.longest_wait }
            : null,
        isOpen,
        opensAt: p.opens_at,
        // Today's Universal Express capacity chip for the map badge (UOR only).
        expressCapacity: capBySlug.get(p.slug) ?? null,
      };
    });

    // Operating-sample-weighted mean = exact overall avg over rides with a wait.
    const weighted = (items: Array<(typeof parks)[number]>) => {
      let num = 0;
      let den = 0;
      for (const p of items) {
        if (p.avgWait != null && p.waitSamples > 0) {
          num += p.avgWait * p.waitSamples;
          den += p.waitSamples;
        }
      }
      return den > 0 ? Math.round(num / den) : null;
    };

    const busiest = parks
      .filter((p) => p.avgWait != null)
      .sort((a, b) => (b.avgWait ?? 0) - (a.avgWait ?? 0))[0];

    const global = {
      busiestParkSlug: busiest?.slug ?? null,
      busiestParkName: busiest?.name ?? null,
      busiestParkWait: busiest?.avgWait ?? null,
      avgWait: weighted(parks),
      operating: parks.reduce((s, p) => s + p.operating, 0),
      totalRides: parks.reduce((s, p) => s + p.totalRides, 0),
      parkCount: parks.length,
    };

    const byOperator = new Map<string, Array<(typeof parks)[number]>>();
    for (const p of parks) {
      const key = p.operatorSlug ?? "other";
      const list = byOperator.get(key) ?? [];
      list.push(p);
      byOperator.set(key, list);
    }
    const resorts = [...byOperator.entries()].map(([operatorSlug, items]) => ({
      operatorSlug,
      operatorName: items[0]?.operatorName ?? null,
      avgWait: weighted(items),
      operating: items.reduce((s, p) => s + p.operating, 0),
      totalRides: items.reduce((s, p) => s + p.totalRides, 0),
      parkCount: items.length,
    }));

    return { parks, global, resorts };
  }),

  /**
   * Hourly history for one attraction/queue type (powers charts).
   *
   * Aggregates raw `queue_obs` with `time_bucket` rather than reading the
   * `queue_hourly` continuous aggregate: the cagg's refresh policy lags ~hours
   * behind live, which made recent points vanish from the chart. Scoped to one
   * attraction + queue type over a bounded window, this stays cheap and is
   * always current. (`queue_hourly` remains for heavier cross-ride analytics.)
   */
  history: publicProcedure
    .input(
      z.object({
        attractionId: z.number().int().positive(),
        queueType: z.number().int().min(1).max(6).default(1),
        hours: z
          .number()
          .int()
          .min(1)
          .max(24 * 90)
          .default(24),
      }),
    )
    .query(async ({ input }) => {
      // Bucket width scales with the window so the chart shows the real
      // intra-day detail (we sample every ~1-3 min) instead of one point/hour:
      // 24h -> 15 min, up to 3 days -> 30 min, a week -> 1 hour, then coarser.
      const bucket =
        input.hours <= 24
          ? "15 minutes"
          : input.hours <= 72
            ? "30 minutes"
            : input.hours <= 24 * 7
              ? "1 hour"
              : input.hours <= 24 * 30
                ? "6 hours"
                : "1 day";
      const result = await db.execute<{
        bucket: string;
        avg_wait: number | null;
        max_wait: number | null;
        min_wait: number | null;
        avg_price: number | null;
        sold_out_samples: number;
        samples: number;
        avail_state: number | null;
      }>(sql`
        SELECT time_bucket(${bucket}::interval, observed_at) AS bucket,
               avg(wait_min)::int    AS avg_wait,
               max(wait_min)         AS max_wait,
               min(wait_min)         AS min_wait,
               avg(price_cents)::int AS avg_price,
               count(*) FILTER (WHERE state = 3) AS sold_out_samples,
               count(*)              AS samples,
               -- The bucket's representative paid-line state (most frequent),
               -- powering the ride page's Lightning Lane availability timeline.
               mode() WITHIN GROUP (ORDER BY state) AS avail_state
        FROM queue_obs
        WHERE attraction_id = ${input.attractionId}
          AND queue_type = ${input.queueType}
          AND observed_at >= now() - (${input.hours} * INTERVAL '1 hour')
        GROUP BY bucket
        ORDER BY bucket
      `);
      return result.rows.map((r) => ({
        bucket: r.bucket,
        avgWait: r.avg_wait,
        maxWait: r.max_wait,
        minWait: r.min_wait,
        avgPrice: r.avg_price,
        soldOutSamples: Number(r.sold_out_samples),
        samples: Number(r.samples),
        availState: r.avail_state == null ? null : Number(r.avail_state),
      }));
    }),

  /**
   * Per-ride analytics rollups over recent STANDBY `queue_obs`, shaped for the
   * charts on the individual ride page: hour-of-day rhythm and day-of-week
   * pattern (both 30 days) plus a date × hour crowd calendar (14 days). Hour /
   * date / weekday grouping is done in the park's *local* timezone so "9am" and
   * "Saturday" mean what a guest at the park would expect, not UTC. The windowed
   * wait-trend chart on that page reuses `history` directly.
   */
  rideAnalytics: publicProcedure
    .input(z.object({ attractionId: z.number().int().positive() }))
    .query(async ({ input }) => {
      const id = input.attractionId;
      const meta = await db.execute<{ timezone: string }>(sql`
        SELECT p.timezone
        FROM attractions a JOIN parks p ON p.id = a.park_id
        WHERE a.id = ${id}
        LIMIT 1
      `);
      const tz = meta.rows[0]?.timezone ?? "UTC";
      const empty = {
        timezone: tz,
        hourly: [] as Array<{ hour: number; avgWait: number; peak: number; samples: number }>,
        weekday: [] as Array<{ dow: number; avgWait: number; peak: number; samples: number }>,
        heatmap: [] as Array<{ date: string; hour: number; avgWait: number }>,
      };
      if (!meta.rows[0]) return empty;

      const [hourly, weekday, heatmap] = await Promise.all([
        // Avg + peak standby by local hour-of-day (30 days).
        db.execute<{ h: number; avg_wait: number; peak: number; samples: number }>(sql`
          SELECT extract(hour FROM observed_at AT TIME ZONE ${tz})::int AS h,
                 avg(wait_min)::int AS avg_wait,
                 max(wait_min)      AS peak,
                 count(*)           AS samples
          FROM queue_obs
          WHERE attraction_id = ${id} AND queue_type = 1 AND wait_min IS NOT NULL
            AND observed_at >= now() - INTERVAL '30 days'
          GROUP BY h ORDER BY h
        `),
        // Avg + peak standby by local day-of-week (0=Sun … 6=Sat) over 30 days.
        db.execute<{ dow: number; avg_wait: number; peak: number; samples: number }>(sql`
          SELECT extract(dow FROM observed_at AT TIME ZONE ${tz})::int AS dow,
                 avg(wait_min)::int AS avg_wait,
                 max(wait_min)      AS peak,
                 count(*)           AS samples
          FROM queue_obs
          WHERE attraction_id = ${id} AND queue_type = 1 AND wait_min IS NOT NULL
            AND observed_at >= now() - INTERVAL '30 days'
          GROUP BY dow ORDER BY dow
        `),
        // Crowd calendar: avg standby by local date × hour-of-day (14 days).
        db.execute<{ d: string; h: number; avg_wait: number }>(sql`
          SELECT (observed_at AT TIME ZONE ${tz})::date::text AS d,
                 extract(hour FROM observed_at AT TIME ZONE ${tz})::int AS h,
                 avg(wait_min)::int AS avg_wait
          FROM queue_obs
          WHERE attraction_id = ${id} AND queue_type = 1 AND wait_min IS NOT NULL
            AND observed_at >= now() - INTERVAL '14 days'
          GROUP BY d, h ORDER BY d, h
        `),
      ]);

      return {
        timezone: tz,
        hourly: hourly.rows.map((r) => ({
          hour: Number(r.h),
          avgWait: Number(r.avg_wait),
          peak: Number(r.peak),
          samples: Number(r.samples),
        })),
        weekday: weekday.rows.map((r) => ({
          dow: Number(r.dow),
          avgWait: Number(r.avg_wait),
          peak: Number(r.peak),
          samples: Number(r.samples),
        })),
        heatmap: heatmap.rows.map((r) => ({
          date: r.d,
          hour: Number(r.h),
          avgWait: Number(r.avg_wait),
        })),
      };
    }),

  /**
   * Whole-park bucketed history for one queue type, pivoted per attraction.
   *
   * Powers the multi-series park chart (one togglable line per ride) and the
   * board's per-row wait sparklines. Same bucket-width scaling as `history`, but
   * grouped by attraction so the client can pivot into `{ bucket, [rideId]: v }`
   * rows. `value` is the avg standby wait, or — for the paid-return queue type
   * (4) — the avg Lightning Lane price in dollars, matching `ParkWaitChart`'s
   * per-ride mode.
   */
  parkHistory: publicProcedure
    .input(
      z.object({
        parkSlug: z.string(),
        queueType: z.number().int().min(1).max(6).default(1),
        // `wait` → avg standby/single-rider minutes; `price` → avg LL Single
        // dollars; `count` → per ride the fraction of the bucket its Lightning
        // Lane was bookable (AVAILABLE or LIMITED), so the client sums them into
        // a whole-park "average Lightning Lanes available" line. Spans LL Multi +
        // Single, ignoring `queueType`.
        metric: z.enum(["wait", "price", "count"]).default("wait"),
        hours: z
          .number()
          .int()
          .min(1)
          .max(24 * 90)
          .default(24 * 7),
      }),
    )
    .query(async ({ input }) => {
      const bucket =
        input.hours <= 24
          ? "15 minutes"
          : input.hours <= 72
            ? "30 minutes"
            : input.hours <= 24 * 7
              ? "1 hour"
              : input.hours <= 24 * 30
                ? "6 hours"
                : "1 day";
      const isPrice = input.metric === "price";
      const isCount = input.metric === "count";
      // The available-count spans both Lightning Lane products (Multi =
      // RETURN_TIME, Single = PAID_RETURN_TIME); wait/price key off the single
      // requested type.
      const queueFilter = isCount
        ? sql`q.queue_type IN (${QueueType.RETURN_TIME}, ${QueueType.PAID_RETURN_TIME})`
        : sql`q.queue_type = ${input.queueType}`;
      // Per (attraction, bucket): the *fraction* of the bucket the ride's
      // Lightning Lane was bookable — avg (not max/peak) of a per-sample 1
      // (AVAILABLE or LIMITED) / 0 (SOLD_OUT or PAUSED) flag. NOT_OFFERED / no
      // state drop to NULL so they're excluded from the average, and a ride that
      // is all-unoffered yields a null point (the client bridges it as downtime,
      // and drops it from the legend). Summing these fractions across rides on
      // the client yields the whole-park "average Lightning Lanes available"
      // line — a true time-average rather than the peak count.
      const valueExpr = isCount
        ? sql`avg(CASE
                    WHEN q.state IN (${QueueState.AVAILABLE}, ${QueueState.LIMITED}) THEN 1.0
                    WHEN q.state IN (${QueueState.SOLD_OUT}, ${QueueState.PAUSED}) THEN 0.0
                    ELSE NULL END)`
        : isPrice
          ? sql`(avg(q.price_cents) / 100.0)`
          : sql`avg(q.wait_min)::int`;
      const [meta, result, spine] = await Promise.all([
        db.execute<{ timezone: string }>(
          sql`SELECT timezone FROM parks WHERE slug = ${input.parkSlug} LIMIT 1`,
        ),
        db.execute<{
          attraction_id: string;
          name: string;
          bucket: string;
          value: number | null;
        }>(sql`
          SELECT q.attraction_id,
                 a.name,
                 time_bucket(${bucket}::interval, q.observed_at) AS bucket,
                 ${valueExpr} AS value
          FROM queue_obs q
          JOIN attractions a ON a.id = q.attraction_id
          WHERE a.park_id = (SELECT id FROM parks WHERE slug = ${input.parkSlug})
            AND a.active = true
            -- Skip un-enriched "ghost" duplicates (null category) so a ride like
            -- Soarin' doesn't show up as two identical series.
            AND a.category IS NOT NULL
            AND ${queueFilter}
            AND q.observed_at >= now() - (${input.hours} * INTERVAL '1 hour')
          GROUP BY q.attraction_id, a.name, bucket
          ORDER BY bucket
        `),
        // Continuous bucket spine with a per-bucket `closed` flag from the park's
        // operating calendar, so the client can draw 0 (not a bridged gap) while
        // the park is shut. We mark a bucket closed only when it falls *inside*
        // the overall span of known operating windows but outside every one of
        // them — buckets before the earliest / after the latest known window
        // (no schedule knowledge) and parks with no schedule at all stay
        // `closed = false`, degrading to the old connect-the-gap behavior.
        db.execute<{ bucket: string; closed: boolean }>(sql`
          WITH park AS (SELECT id FROM parks WHERE slug = ${input.parkSlug}),
          spine AS (
            SELECT generate_series(
              time_bucket(${bucket}::interval, now() - (${input.hours} * INTERVAL '1 hour')),
              time_bucket(${bucket}::interval, now()),
              ${bucket}::interval
            ) AS bucket
          ),
          -- Latest daily snapshot's view of each operating window.
          sched AS (
            SELECT DISTINCT ON (service_date, opening_time) opening_time, closing_time
            FROM park_schedule
            WHERE park_id = (SELECT id FROM park)
              AND type IN ${OPEN_SCHEDULE_TYPES}
              AND closing_time IS NOT NULL
            ORDER BY service_date, opening_time, snapshot_date DESC
          ),
          span AS (SELECT min(opening_time) AS lo, max(closing_time) AS hi FROM sched)
          SELECT s.bucket,
                 (
                   (SELECT lo FROM span) IS NOT NULL
                   AND s.bucket >= (SELECT lo FROM span)
                   AND s.bucket <  (SELECT hi FROM span)
                   AND NOT EXISTS (
                     SELECT 1 FROM sched w
                     WHERE s.bucket >= w.opening_time AND s.bucket < w.closing_time
                   )
                 ) AS closed
          FROM spine s
          ORDER BY s.bucket
        `),
      ]);

      // Seed one record per bucket from the continuous spine (so fully-closed
      // buckets exist even though no ride reported), then pivot the observation
      // rows on top keyed by attraction id, and summarize each ride (peak value)
      // so the client can order the legend busiest-first and pick which series
      // to enable by default.
      type Point = { bucket: string; closed: boolean } & Record<
        string,
        number | string | boolean | null
      >;
      const buckets = new Map<string, Point>();
      for (const r of spine.rows) {
        buckets.set(r.bucket, { bucket: r.bucket, closed: r.closed });
      }
      const rideMap = new Map<number, { id: number; name: string; peak: number }>();
      for (const r of result.rows) {
        const id = Number(r.attraction_id);
        const value = r.value == null ? null : Number(r.value);
        let point = buckets.get(r.bucket);
        if (!point) {
          point = { bucket: r.bucket, closed: false };
          buckets.set(r.bucket, point);
        }
        point[String(id)] = value;
        const ride = rideMap.get(id) ?? { id, name: r.name, peak: 0 };
        if (value != null && value > ride.peak) ride.peak = value;
        rideMap.set(id, ride);
      }

      const rides = [...rideMap.values()].sort((a, b) => b.peak - a.peak);
      const points = [...buckets.values()].sort((a, b) =>
        String(a.bucket).localeCompare(String(b.bucket)),
      );
      return { rides, points, timezone: meta.rows[0]?.timezone ?? "UTC" };
    }),

  /**
   * Bottom-of-page analytics bundle: several independent rollups over the park's
   * recent STANDBY `queue_obs`, each shaped for a differently-typed chart on the
   * park page (area / heatmap / bar / radar / scatter). One procedure, one
   * round-trip — the sub-queries run in parallel. Hour/date grouping is done in
   * the park's *local* timezone so "9am" means 9am at the park, not in UTC.
   */
  analytics: publicProcedure.input(z.object({ parkSlug: z.string() })).query(async ({ input }) => {
    const meta = await db.execute<{ id: string; timezone: string }>(sql`
      SELECT id, timezone FROM parks WHERE slug = ${input.parkSlug}
    `);
    const park = meta.rows[0];
    const empty = {
      timezone: park?.timezone ?? "UTC",
      activity: [] as Array<{
        bucket: string;
        rides: number;
        avgWait: number | null;
        closed: boolean;
      }>,
      heatmap: [] as Array<{ date: string; hour: number; avgWait: number }>,
      byLand: [] as Array<{ land: string; avgWait: number; peak: number; rides: number }>,
      rhythm: [] as Array<{ hour: number; avgWait: number; kind: "attraction" | "character" }>,
      scatter: [] as Array<{
        id: number;
        name: string;
        kind: "attraction" | "character";
        avgWait: number;
        volatility: number;
        peak: number;
        samples: number;
      }>,
      treemap: [] as Array<{
        id: number;
        name: string;
        kind: "attraction" | "character";
        total: number;
        avgWait: number;
      }>,
    };
    if (!park) return empty;
    const pid = Number(park.id);
    const tz = park.timezone;

    const [activity, heatmap, byLand, rhythm, scatter, treemap] = await Promise.all([
      // 1) Distinct rides reporting + avg wait per hour over 7 days, projected
      // onto a continuous hourly spine carrying a per-bucket `closed` flag from
      // the operating calendar — same construction as `parkHistory`'s spine — so
      // the client can sink closed (overnight) buckets to 0 instead of bridging
      // them, matching the main wait chart. The upstream feed keeps re-posting
      // waits overnight, so without the calendar gate the area would smoothly
      // bridge the closure rather than dropping to the baseline.
      db.execute<{ bucket: string; rides: number; avg_wait: number | null; closed: boolean }>(sql`
        WITH spine AS (
          SELECT generate_series(
            time_bucket('1 hour'::interval, now() - INTERVAL '7 days'),
            time_bucket('1 hour'::interval, now()),
            '1 hour'::interval
          ) AS bucket
        ),
        sched AS (
          SELECT DISTINCT ON (service_date, opening_time) opening_time, closing_time
          FROM park_schedule
          WHERE park_id = ${pid}
            AND type IN ${OPEN_SCHEDULE_TYPES}
            AND closing_time IS NOT NULL
          ORDER BY service_date, opening_time, snapshot_date DESC
        ),
        span AS (SELECT min(opening_time) AS lo, max(closing_time) AS hi FROM sched),
        obs AS (
          SELECT time_bucket('1 hour'::interval, q.observed_at) AS bucket,
                 count(DISTINCT q.attraction_id) AS rides,
                 avg(q.wait_min)::int AS avg_wait
          FROM queue_obs q JOIN attractions a ON a.id = q.attraction_id
          WHERE a.park_id = ${pid} AND q.queue_type = 1
            AND q.observed_at >= now() - INTERVAL '7 days'
          GROUP BY bucket
        )
        SELECT s.bucket,
               coalesce(o.rides, 0) AS rides,
               o.avg_wait,
               (
                 (SELECT lo FROM span) IS NOT NULL
                 AND s.bucket >= (SELECT lo FROM span)
                 AND s.bucket <  (SELECT hi FROM span)
                 AND NOT EXISTS (
                   SELECT 1 FROM sched w
                   WHERE s.bucket >= w.opening_time AND s.bucket < w.closing_time
                 )
               ) AS closed
        FROM spine s
        LEFT JOIN obs o ON o.bucket = s.bucket
        ORDER BY s.bucket
      `),
      // 2) Crowd calendar: avg standby by local date x hour-of-day over 14 days.
      db.execute<{ d: string; h: number; avg_wait: number }>(sql`
        SELECT (q.observed_at AT TIME ZONE ${tz})::date::text AS d,
               extract(hour FROM q.observed_at AT TIME ZONE ${tz})::int AS h,
               avg(q.wait_min)::int AS avg_wait
        FROM queue_obs q JOIN attractions a ON a.id = q.attraction_id
        WHERE a.park_id = ${pid} AND q.queue_type = 1 AND q.wait_min IS NOT NULL
          AND q.observed_at >= now() - INTERVAL '14 days'
        GROUP BY d, h ORDER BY d, h
      `),
      // 3) Avg + peak standby grouped by land (7 days).
      db.execute<{ land: string; avg_wait: number; peak: number; rides: number }>(sql`
        SELECT m.land,
               avg(q.wait_min)::int AS avg_wait,
               max(q.wait_min) AS peak,
               count(DISTINCT a.id) AS rides
        FROM queue_obs q
        JOIN attractions a ON a.id = q.attraction_id
        JOIN attraction_meta m ON m.attraction_id = a.id
        WHERE a.park_id = ${pid} AND q.queue_type = 1 AND q.wait_min IS NOT NULL
          AND m.land IS NOT NULL
          AND q.observed_at >= now() - INTERVAL '7 days'
        GROUP BY m.land ORDER BY avg_wait DESC
      `),
      // 4) Typical daily rhythm: avg standby by local hour-of-day (14 days),
      // split into character meet-and-greets vs. rides — the two have very
      // different shapes, so the chart toggles between them.
      db.execute<{ h: number; kind: "attraction" | "character"; avg_wait: number }>(sql`
        SELECT extract(hour FROM q.observed_at AT TIME ZONE ${tz})::int AS h,
               CASE WHEN a.category = 'character' THEN 'character' ELSE 'attraction' END AS kind,
               avg(q.wait_min)::int AS avg_wait
        FROM queue_obs q JOIN attractions a ON a.id = q.attraction_id
        WHERE a.park_id = ${pid} AND q.queue_type = 1 AND q.wait_min IS NOT NULL
          AND a.category IS NOT NULL
          AND q.observed_at >= now() - INTERVAL '14 days'
        GROUP BY h, kind ORDER BY h
      `),
      // 5) Per-ride "busy vs. volatile" (7 days): mean wait vs. the spread of
      // waits (population stddev), with peak for point sizing.
      db.execute<{
        id: string;
        name: string;
        kind: "attraction" | "character";
        avg_wait: number;
        volatility: number;
        peak: number;
        samples: number;
      }>(sql`
        SELECT a.id, a.name,
               CASE WHEN a.category = 'character' THEN 'character' ELSE 'attraction' END AS kind,
               avg(q.wait_min)::numeric(10,1) AS avg_wait,
               coalesce(stddev_pop(q.wait_min), 0)::numeric(10,1) AS volatility,
               max(q.wait_min) AS peak,
               count(*) AS samples
        FROM queue_obs q JOIN attractions a ON a.id = q.attraction_id
        WHERE a.park_id = ${pid} AND q.queue_type = 1 AND q.wait_min IS NOT NULL
          AND a.active = true AND a.category IS NOT NULL
          AND q.observed_at >= now() - INTERVAL '7 days'
        GROUP BY a.id, a.name HAVING count(*) > 5
        ORDER BY avg_wait DESC
      `),
      // 6) Total queue burden per ride (7 days): summed standby minutes, which
      // sizes a treemap by how much of the park's waiting each ride accounts for.
      db.execute<{ id: string; name: string; kind: string; total: number; avg_wait: number }>(sql`
        SELECT a.id, a.name,
               CASE WHEN a.category = 'character' THEN 'character' ELSE 'attraction' END AS kind,
               sum(q.wait_min)::int AS total,
               avg(q.wait_min)::int AS avg_wait
        FROM queue_obs q JOIN attractions a ON a.id = q.attraction_id
        WHERE a.park_id = ${pid} AND q.queue_type = 1 AND q.wait_min IS NOT NULL
          AND a.active = true AND a.category IS NOT NULL
          AND q.observed_at >= now() - INTERVAL '7 days'
        GROUP BY a.id, a.name, a.category HAVING sum(q.wait_min) > 0
        ORDER BY total DESC
      `),
    ]);

    return {
      timezone: tz,
      activity: activity.rows.map((r) => ({
        bucket: r.bucket,
        rides: Number(r.rides),
        avgWait: r.avg_wait,
        closed: r.closed,
      })),
      heatmap: heatmap.rows.map((r) => ({
        date: r.d,
        hour: Number(r.h),
        avgWait: Number(r.avg_wait),
      })),
      byLand: byLand.rows.map((r) => ({
        land: r.land,
        avgWait: Number(r.avg_wait),
        peak: Number(r.peak),
        rides: Number(r.rides),
      })),
      rhythm: rhythm.rows.map((r) => ({
        hour: Number(r.h),
        avgWait: Number(r.avg_wait),
        kind: r.kind,
      })),
      scatter: scatter.rows.map((r) => ({
        id: Number(r.id),
        name: r.name,
        kind: r.kind,
        avgWait: Number(r.avg_wait),
        volatility: Number(r.volatility),
        peak: Number(r.peak),
        samples: Number(r.samples),
      })),
      treemap: treemap.rows.map((r) => ({
        id: Number(r.id),
        name: r.name,
        kind: r.kind === "character" ? ("character" as const) : ("attraction" as const),
        total: Number(r.total),
        avgWait: Number(r.avg_wait),
      })),
    };
  }),
} satisfies TRPCRouterRecord;
