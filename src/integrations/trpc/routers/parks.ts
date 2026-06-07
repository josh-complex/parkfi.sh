import { sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "#/db/index.ts";
import { publicProcedure } from "../init.ts";

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
    }>(sql`
      SELECT p.id, p.slug, p.name, p.timezone,
             o.slug AS operator_slug, o.name AS operator_name, r.name AS resort_name
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
    }));
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
      support_types: Array<number> | null;
      hist_standby_wait: number | null;
    }>(sql`
        WITH park AS (SELECT id FROM parks WHERE slug = ${input.parkSlug}),
        latest_status AS (
          SELECT DISTINCT ON (s.attraction_id) s.attraction_id, s.status
          FROM attraction_status_obs s
          JOIN attractions a ON a.id = s.attraction_id
          WHERE a.park_id = (SELECT id FROM park)
          ORDER BY s.attraction_id, s.observed_at DESC
        ),
        -- Current state only: rows older than 24h are stale, not "the board now".
        latest_q AS (
          SELECT DISTINCT ON (q.attraction_id, q.queue_type)
                 q.attraction_id, q.queue_type, q.wait_min, q.state,
                 q.price_cents, q.currency, q.return_start, q.return_end,
                 q.observed_at
          FROM queue_obs q
          JOIN attractions a ON a.id = q.attraction_id
          WHERE a.park_id = (SELECT id FROM park)
            AND q.observed_at >= now() - INTERVAL '24 hours'
          ORDER BY q.attraction_id, q.queue_type, q.observed_at DESC
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
        hist AS (
          SELECT q.attraction_id, avg(q.wait_min)::int AS hist_standby_wait
          FROM queue_obs q
          JOIN attractions a ON a.id = q.attraction_id
          WHERE a.park_id = (SELECT id FROM park)
            AND q.queue_type = 1
            AND q.observed_at >= now() - INTERVAL '48 hours'
            AND q.observed_at < now() - INTERVAL '24 hours'
          GROUP BY q.attraction_id
        )
        SELECT a.id, a.name, a.slug, a.entity_type,
               ls.status,
               sb.wait_min AS standby_wait,
               sb.observed_at,
               prt.state AS ll_state, prt.price_cents AS ll_price_cents,
               prt.currency AS ll_currency,
               prt.return_start AS ll_return_start, prt.return_end AS ll_return_end,
               rt.state AS return_state,
               rt.return_start AS return_start, rt.return_end AS return_end,
               caps.qtypes AS support_types,
               hist.hist_standby_wait
        FROM attractions a
        LEFT JOIN latest_status ls ON ls.attraction_id = a.id
        LEFT JOIN latest_q sb ON sb.attraction_id = a.id AND sb.queue_type = 1
        LEFT JOIN latest_q prt ON prt.attraction_id = a.id AND prt.queue_type = 4
        LEFT JOIN latest_q rt ON rt.attraction_id = a.id AND rt.queue_type = 3
        LEFT JOIN caps ON caps.attraction_id = a.id
        LEFT JOIN hist ON hist.attraction_id = a.id
        WHERE a.park_id = (SELECT id FROM park) AND a.active = true
        ORDER BY a.name
      `);
    return result.rows.map((r) => ({
      id: Number(r.id),
      name: r.name,
      slug: r.slug,
      entityType: r.entity_type,
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
      supportsQueueTypes: (r.support_types ?? []).map(Number),
      histStandbyWait: r.hist_standby_wait,
    }));
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
      }>(sql`
        SELECT time_bucket(${bucket}::interval, observed_at) AS bucket,
               avg(wait_min)::int    AS avg_wait,
               max(wait_min)         AS max_wait,
               min(wait_min)         AS min_wait,
               avg(price_cents)::int AS avg_price,
               count(*) FILTER (WHERE state = 3) AS sold_out_samples,
               count(*)              AS samples
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
      }));
    }),
} satisfies TRPCRouterRecord;
