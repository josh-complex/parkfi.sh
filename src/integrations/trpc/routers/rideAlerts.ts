import { TRPCError, type TRPCRouterRecord } from "@trpc/server";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "#/db/index.ts";
import { rideAlert } from "#/db/schema.ts";
import { QueueState, QueueType } from "#/server/parks/codes.ts";
import { config } from "#/server/parks/config.ts";
import { protectedProcedure } from "../init.ts";

/** Max active alerts a user may keep per park (app rule; see schema invariant). */
const MAX_PER_PARK = 3;

const STATUS_CODE: Record<number, string> = {
  0: "UNKNOWN",
  1: "OPERATING",
  2: "DOWN",
  3: "CLOSED",
  4: "REFURBISHMENT",
};

// Latest STANDBY wait / carried status for an attraction, as correlated lateral
// subqueries (same shape `parks.board` and the alert evaluator use).
const latestWait = (attractionCol: string) => sql`
  LEFT JOIN LATERAL (
    SELECT q.wait_min
    FROM queue_obs q
    WHERE q.attraction_id = ${sql.raw(attractionCol)}
      AND q.queue_type = ${QueueType.STANDBY}
      AND q.observed_at >= now() - INTERVAL '24 hours'
    ORDER BY q.observed_at DESC
    LIMIT 1
  ) sb ON true`;
const latestStatus = (attractionCol: string) => sql`
  LEFT JOIN LATERAL (
    SELECT s.status
    FROM attraction_status_obs s
    WHERE s.attraction_id = ${sql.raw(attractionCol)}
    ORDER BY s.observed_at DESC
    LIMIT 1
  ) st ON true`;
// Latest Lightning Lane state (either product — Multi=RETURN_TIME or
// Single=PAID_RETURN_TIME, whichever last reported) for mode-3 alerts.
const latestLl = (attractionCol: string) => sql`
  LEFT JOIN LATERAL (
    SELECT q.state
    FROM queue_obs q
    WHERE q.attraction_id = ${sql.raw(attractionCol)}
      AND q.queue_type IN (${QueueType.RETURN_TIME}, ${QueueType.PAID_RETURN_TIME})
      AND q.observed_at >= now() - INTERVAL '24 hours'
    ORDER BY q.observed_at DESC
    LIMIT 1
  ) ll ON true`;

/**
 * My Disney Experience's `mdx://` deep-link scheme (route table recovered by
 * static decompile, see `docs/plans/jiminy/write-spike.md`). There is no
 * ride-scoped "open this Lightning Lane" route in that table — Multi/Single
 * *modify* links need a `planId`/`orderId` from the user's own MDE plan, which
 * parkfi has no delegated read of. The best honest link is "My Genie Day" for
 * today, which lands the user on the day's LL/Genie+ screen so they can grab
 * the ride themselves — a couple of taps, not zero-touch, same ceiling as the
 * dining deep link.
 */
function buildLightningLaneDeepLink(completionDeepLink: string): string {
  const today = new Date().toISOString().slice(0, 10);
  const qs = new URLSearchParams({
    tab: "day",
    displayDate: today,
    completionDeepLink,
  });
  return `mdx://magicaccess/mygenieday?${qs.toString()}`;
}

const modeSchema = z.union([z.literal(1), z.literal(2), z.literal(3)]);

// mode 1 (threshold) requires a target wait; mode 2 (change) requires a delta.
const needsThreshold = (v: { mode: number; thresholdMin?: number }) =>
  v.mode !== 1 || v.thresholdMin != null;
const needsDelta = (v: { mode: number; changeDelta?: number }) =>
  v.mode !== 2 || v.changeDelta != null;
const thresholdError = {
  message: "A target wait time is required for threshold alerts",
  path: ["thresholdMin"],
};
const deltaError = {
  message: "A change amount is required for change alerts",
  path: ["changeDelta"],
};

const createInput = z
  .object({
    attractionId: z.number().int().positive(),
    mode: modeSchema,
    thresholdMin: z.number().int().positive().max(600).optional(),
    changeDelta: z.number().int().positive().max(600).optional(),
  })
  .refine(needsThreshold, thresholdError)
  .refine(needsDelta, deltaError);

const updateInput = z
  .object({
    id: z.number().int().positive(),
    mode: modeSchema,
    thresholdMin: z.number().int().positive().max(600).optional(),
    changeDelta: z.number().int().positive().max(600).optional(),
  })
  .refine(needsThreshold, thresholdError)
  .refine(needsDelta, deltaError);

/** Split the rule fields so the unused one is always nulled out. */
function ruleColumns(input: { mode: number; thresholdMin?: number; changeDelta?: number }) {
  return {
    mode: input.mode,
    thresholdMin: input.mode === 1 ? (input.thresholdMin ?? null) : null,
    changeDelta: input.mode === 2 ? (input.changeDelta ?? null) : null,
  };
}

export const rideAlertsRouter = {
  /** Current user's active alerts, grouped by park with per-park capacity. */
  list: protectedProcedure.query(async ({ ctx }) => {
    const result = await db.execute<{
      id: string;
      attraction_id: string;
      attraction_name: string;
      attraction_slug: string;
      park_id: string;
      park_slug: string;
      park_name: string;
      mode: number;
      threshold_min: number | null;
      change_delta: number | null;
      armed: boolean;
      last_fired_at: string | null;
      current_wait: number | null;
      status: number | null;
      ll_state: number | null;
    }>(sql`
      SELECT ra.id, ra.attraction_id, a.name AS attraction_name, a.slug AS attraction_slug,
             ra.park_id, p.slug AS park_slug, p.name AS park_name,
             ra.mode, ra.threshold_min, ra.change_delta, ra.armed, ra.last_fired_at,
             sb.wait_min AS current_wait, st.status AS status, ll.state AS ll_state
      FROM ride_alert ra
      JOIN attractions a ON a.id = ra.attraction_id
      JOIN parks p ON p.id = ra.park_id
      ${latestWait("ra.attraction_id")}
      ${latestStatus("ra.attraction_id")}
      ${latestLl("ra.attraction_id")}
      WHERE ra.user_id = ${ctx.userId} AND ra.active = true
      ORDER BY p.name, a.name
    `);

    const byPark = new Map<
      number,
      {
        parkId: number;
        parkSlug: string;
        parkName: string;
        used: number;
        limit: number;
        alerts: Array<{
          id: number;
          attractionId: number;
          attractionName: string;
          attractionSlug: string;
          mode: number;
          thresholdMin: number | null;
          changeDelta: number | null;
          armed: boolean;
          lastFiredAt: string | null;
          currentWait: number | null;
          status: string | null;
          llAvailable: boolean;
          deepLink: string | null;
        }>;
      }
    >();

    for (const r of result.rows) {
      const parkId = Number(r.park_id);
      let group = byPark.get(parkId);
      if (!group) {
        group = {
          parkId,
          parkSlug: r.park_slug,
          parkName: r.park_name,
          used: 0,
          limit: MAX_PER_PARK,
          alerts: [],
        };
        byPark.set(parkId, group);
      }
      group.used++;
      const llAvailable = r.ll_state === QueueState.AVAILABLE || r.ll_state === QueueState.LIMITED;
      const deepLink =
        Number(r.mode) === 3 && llAvailable
          ? buildLightningLaneDeepLink(
              `${config.appBaseUrl}/park/${r.park_slug}/ride/${r.attraction_slug}`,
            )
          : null;
      group.alerts.push({
        id: Number(r.id),
        attractionId: Number(r.attraction_id),
        attractionName: r.attraction_name,
        attractionSlug: r.attraction_slug,
        mode: Number(r.mode),
        thresholdMin: r.threshold_min,
        changeDelta: r.change_delta,
        armed: r.armed,
        lastFiredAt: r.last_fired_at,
        currentWait: r.current_wait,
        status: r.status == null ? null : (STATUS_CODE[r.status] ?? null),
        llAvailable,
        deepLink,
      });
    }

    return { parks: [...byPark.values()], limitPerPark: MAX_PER_PARK };
  }),

  /** Create or reconfigure the active alert for a ride (upsert; cap-enforced). */
  create: protectedProcedure.input(createInput).mutation(async ({ ctx, input }) => {
    // Resolve the ride's park and seed the firing baseline from current data so
    // the first tick has something to edge-detect against.
    const resolved = await db.execute<{
      park_id: string;
      wait: number | null;
      status: number | null;
      ll_state: number | null;
    }>(sql`
      SELECT a.park_id, sb.wait_min AS wait, st.status AS status, ll.state AS ll_state
      FROM attractions a
      ${latestWait("a.id")}
      ${latestStatus("a.id")}
      ${latestLl("a.id")}
      WHERE a.id = ${input.attractionId}
    `);
    const info = resolved.rows[0];
    if (!info) throw new TRPCError({ code: "NOT_FOUND", message: "Attraction not found" });
    const parkId = Number(info.park_id);

    // Enforce the per-park cap, but allow reconfiguring a ride already tracked.
    const cap = await db.execute<{ used: number; this_ride: number }>(sql`
      SELECT count(*) FILTER (WHERE active) AS used,
             count(*) FILTER (WHERE active AND attraction_id = ${input.attractionId}) AS this_ride
      FROM ride_alert
      WHERE user_id = ${ctx.userId} AND park_id = ${parkId}
    `);
    const { used, this_ride } = cap.rows[0] ?? { used: 0, this_ride: 0 };
    if (Number(used) >= MAX_PER_PARK && Number(this_ride) === 0) {
      throw new TRPCError({
        code: "CONFLICT",
        message: `You can track at most ${MAX_PER_PARK} rides per park. Remove one to add another.`,
      });
    }

    const rule = ruleColumns(input);
    await db
      .insert(rideAlert)
      .values({
        userId: ctx.userId,
        parkId,
        attractionId: input.attractionId,
        ...rule,
        armed: true,
        lastWaitMin: info.wait,
        lastStatus: info.status,
        lastLlState: info.ll_state,
        active: true,
      })
      .onConflictDoUpdate({
        target: [rideAlert.userId, rideAlert.attractionId],
        targetWhere: sql`active`,
        set: {
          ...rule,
          armed: true,
          lastFiredAt: null,
          lastWaitMin: info.wait,
          lastStatus: info.status,
          lastLlState: info.ll_state,
          active: true,
        },
      });

    return { ok: true };
  }),

  /** Edit an existing alert's rule and re-arm it. */
  update: protectedProcedure.input(updateInput).mutation(async ({ ctx, input }) => {
    const seed = await db.execute<{
      wait: number | null;
      status: number | null;
      ll_state: number | null;
    }>(sql`
      SELECT sb.wait_min AS wait, st.status AS status, ll.state AS ll_state
      FROM ride_alert ra
      ${latestWait("ra.attraction_id")}
      ${latestStatus("ra.attraction_id")}
      ${latestLl("ra.attraction_id")}
      WHERE ra.id = ${input.id} AND ra.user_id = ${ctx.userId} AND ra.active = true
    `);
    const info = seed.rows[0];
    if (!info) throw new TRPCError({ code: "NOT_FOUND", message: "Alert not found" });

    await db
      .update(rideAlert)
      .set({
        ...ruleColumns(input),
        armed: true,
        lastFiredAt: null,
        lastWaitMin: info.wait,
        lastStatus: info.status,
        lastLlState: info.ll_state,
      })
      .where(and(eq(rideAlert.id, input.id), eq(rideAlert.userId, ctx.userId)));

    return { ok: true };
  }),

  /** Soft-delete an alert (keeps history; cascade hard-deletes with the user). */
  remove: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      await db
        .update(rideAlert)
        .set({ active: false })
        .where(and(eq(rideAlert.id, input.id), eq(rideAlert.userId, ctx.userId)));
      return { ok: true };
    }),
} satisfies TRPCRouterRecord;
