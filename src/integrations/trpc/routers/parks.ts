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
      operator_name: string | null;
      resort_name: string | null;
    }>(sql`
      SELECT p.id, p.slug, p.name, p.timezone,
             o.name AS operator_name, r.name AS resort_name
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
      observed_at: string | null;
    }>(sql`
        WITH park AS (SELECT id FROM parks WHERE slug = ${input.parkSlug}),
        latest_status AS (
          SELECT DISTINCT ON (s.attraction_id) s.attraction_id, s.status
          FROM attraction_status_obs s
          JOIN attractions a ON a.id = s.attraction_id
          WHERE a.park_id = (SELECT id FROM park)
          ORDER BY s.attraction_id, s.observed_at DESC
        ),
        latest_q AS (
          SELECT DISTINCT ON (q.attraction_id, q.queue_type)
                 q.attraction_id, q.queue_type, q.wait_min, q.state,
                 q.price_cents, q.currency, q.return_start, q.return_end,
                 q.observed_at
          FROM queue_obs q
          JOIN attractions a ON a.id = q.attraction_id
          WHERE a.park_id = (SELECT id FROM park)
          ORDER BY q.attraction_id, q.queue_type, q.observed_at DESC
        )
        SELECT a.id, a.name, a.slug, a.entity_type,
               ls.status,
               sb.wait_min AS standby_wait,
               sb.observed_at,
               prt.state AS ll_state, prt.price_cents AS ll_price_cents,
               prt.currency AS ll_currency,
               prt.return_start AS ll_return_start, prt.return_end AS ll_return_end,
               rt.state AS return_state
        FROM attractions a
        LEFT JOIN latest_status ls ON ls.attraction_id = a.id
        LEFT JOIN latest_q sb ON sb.attraction_id = a.id AND sb.queue_type = 1
        LEFT JOIN latest_q prt ON prt.attraction_id = a.id AND prt.queue_type = 4
        LEFT JOIN latest_q rt ON rt.attraction_id = a.id AND rt.queue_type = 3
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
    }));
  }),

  /** Hourly history for one attraction/queue type (powers charts). */
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
      const result = await db.execute<{
        bucket: string;
        avg_wait: number | null;
        max_wait: number | null;
        min_wait: number | null;
        avg_price: number | null;
        sold_out_samples: number;
        samples: number;
      }>(sql`
        SELECT bucket, avg_wait, max_wait, min_wait, avg_price,
               sold_out_samples, samples
        FROM queue_hourly
        WHERE attraction_id = ${input.attractionId}
          AND queue_type = ${input.queueType}
          AND bucket >= now() - (${input.hours} * INTERVAL '1 hour')
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
