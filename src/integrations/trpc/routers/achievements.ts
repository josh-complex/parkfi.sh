import { TRPCError, type TRPCRouterRecord } from "@trpc/server";
import { and, desc, eq, ilike, inArray, isNotNull, isNull, lt, or, sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "#/db/index.ts";
import {
  attractions,
  parks,
  pinHave,
  user,
  userAchievement,
  userGeoState,
  userParkDay,
  userRideEvent,
  userStat,
} from "#/db/schema.ts";
import { TRACK_EVENTS, levelForXp, xpForTierIds, type TrackEvent } from "#/lib/achievements.ts";
import {
  bumpEventStat,
  computeStats,
  devResetMine,
  devResetRides,
  devUnlockNext,
  evaluateAndUnlock,
  ingestPing,
  reconcileDaySteps,
} from "#/server/achievements/engine.ts";
import { ingestRideTrace, rideTraceSchema } from "#/server/achievements/rides.ts";
import {
  buildScenario,
  loadSimPark,
  runScenario,
  SCENARIO_PRESETS,
  setSyntheticWeather,
} from "#/server/achievements/scenarios.ts";
import { adminProcedure, isAdminEmail, protectedProcedure } from "../init.ts";

const TRACK_EVENT_KEYS = Object.keys(TRACK_EVENTS) as [TrackEvent, ...TrackEvent[]];

export const achievementsRouter = {
  /** Location ping from the tracker. ~1 per 30s per active user. */
  ping: protectedProcedure
    .input(
      z.object({
        lng: z.number().gte(-180).lte(180),
        lat: z.number().gte(-90).lte(90),
        accuracy: z.number().nonnegative().max(100_000),
        // Raw pedometer report (native only): the session-cumulative step count
        // plus the session's start time. The server diffs against its stored
        // cursor (idempotent under retries); the hard ceilings only bound
        // payload abuse — the real plausibility clamp is rate-based in
        // ingestPing.
        stepsCum: z.number().int().min(0).max(500_000).optional(),
        stepsSessionMs: z.number().int().positive().optional(),
      }),
    )
    .mutation(({ ctx, input }) =>
      // Seeded ("Make it rain") weather counts only for owner pings — see ingestPing.
      ingestPing(ctx.userId, input.lng, input.lat, input.accuracy, new Date(), {
        seededWeather: isAdminEmail(ctx.userEmail),
        steps:
          input.stepsCum != null && input.stepsSessionMs != null
            ? { cum: input.stepsCum, sessionMs: input.stepsSessionMs }
            : null,
      }),
    ),

  /** Recent park-day windows for the pedometer reconciliation pass (iOS): the
   *  absolute in-park time span + currently credited steps per day. The client
   *  queries the OS pedometer buffer over each window and reports back any
   *  higher total via reconcileSteps. */
  myStepWindows: protectedProcedure.query(async ({ ctx }) => {
    const rows = await db
      .select({
        parkId: userParkDay.parkId,
        day: userParkDay.day,
        firstSeenAt: userParkDay.firstSeenAt,
        lastSeenAt: userParkDay.lastSeenAt,
        steps: userParkDay.steps,
      })
      .from(userParkDay)
      .where(eq(userParkDay.userId, ctx.userId))
      .orderBy(desc(userParkDay.day))
      .limit(6); // covers a week incl. hop days; older windows outlive the OS buffer anyway
    return rows.map((r) => ({
      parkId: r.parkId,
      day: r.day,
      fromMs: r.firstSeenAt.getTime(),
      toMs: r.lastSeenAt.getTime(),
      steps: r.steps,
    }));
  }),

  /** Max-repair a park-day's steps from the OS pedometer's historical buffer —
   *  capped server-side by the window duration (see reconcileDaySteps). Returns
   *  the usual unlock/xp/level shape so repairs can fire the toast funnel. */
  reconcileSteps: protectedProcedure
    .input(
      z.object({
        parkId: z.number().int().positive(),
        day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        steps: z.number().int().min(0).max(200_000),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const result = await reconcileDaySteps(ctx.userId, input.parkId, input.day, input.steps);
      return result ?? { newlyUnlocked: [], xp: 0, level: levelForXp(0), steps: null };
    }),

  /** Allowlisted client event (pin scan, alert created, …). */
  track: protectedProcedure
    .input(z.object({ event: z.enum(TRACK_EVENT_KEYS) }))
    .mutation(({ ctx, input }) => bumpEventStat(ctx.userId, input.event)),

  /** Sensor-verified ride from the native ride-recorder plugin. Validated,
   *  geofence-checked, and credited server-side; returns the same
   *  unlock/xp/level shape the ping/track toast funnel consumes. */
  submitRideTrace: protectedProcedure
    .input(rideTraceSchema)
    .mutation(({ ctx, input }) => ingestRideTrace(ctx.userId, input)),

  /** Caller's personal sensor-ride bests for one attraction — powers the
   *  "your rides" block on the ride detail page. Empty-safe (aggregate over no
   *  rows returns a single zero/null row). */
  myRideStats: protectedProcedure
    .input(z.object({ attractionId: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      const [row] = await db
        .select({
          rideCount: sql<number>`count(*)`.mapWith(Number),
          totalDrops:
            sql<number>`coalesce(sum((${userRideEvent.metrics} ->> 'dropCount')::int), 0)`.mapWith(
              Number,
            ),
          bestMaxG: sql<
            number | null
          >`max((${userRideEvent.metrics} ->> 'maxG')::double precision)`,
          lastRiddenAt: sql<string | null>`max(${userRideEvent.riddenAt})`,
        })
        .from(userRideEvent)
        .where(
          and(
            eq(userRideEvent.userId, ctx.userId),
            eq(userRideEvent.attractionId, input.attractionId),
          ),
        );
      return {
        rideCount: row?.rideCount ?? 0,
        totalDrops: row?.totalDrops ?? 0,
        bestMaxG: row?.bestMaxG ?? null,
        lastRiddenAt: row?.lastRiddenAt ?? null,
      };
    }),

  /**
   * The caller's durable sensor-ride journal — the per-ride receipts behind the
   * aggregate sensor stats. Keyset-paginated (riddenAt DESC, id DESC); only rows
   * carrying on-device metrics (dwell-only rides have none). The audit `trace`
   * blob is deliberately not selected — it never ships to the client.
   */
  myRideLog: protectedProcedure
    .input(
      z.object({
        limit: z.number().int().min(1).max(50).default(20),
        cursor: z.object({ riddenAt: z.string(), id: z.number().int() }).nullish(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const cur = input.cursor;
      const rows = await db
        .select({
          id: userRideEvent.id,
          riddenAt: userRideEvent.riddenAt,
          source: userRideEvent.source,
          metrics: userRideEvent.metrics,
          attractionName: attractions.name,
          attractionSlug: attractions.slug,
          parkName: parks.name,
          parkSlug: parks.slug,
          parkTimezone: parks.timezone,
        })
        .from(userRideEvent)
        .innerJoin(attractions, eq(attractions.id, userRideEvent.attractionId))
        .innerJoin(parks, eq(parks.id, userRideEvent.parkId))
        .where(
          and(
            eq(userRideEvent.userId, ctx.userId),
            isNotNull(userRideEvent.metrics),
            cur
              ? or(
                  lt(userRideEvent.riddenAt, new Date(cur.riddenAt)),
                  and(
                    eq(userRideEvent.riddenAt, new Date(cur.riddenAt)),
                    lt(userRideEvent.id, cur.id),
                  ),
                )
              : undefined,
          ),
        )
        .orderBy(desc(userRideEvent.riddenAt), desc(userRideEvent.id))
        .limit(input.limit + 1);

      const hasMore = rows.length > input.limit;
      const items = (hasMore ? rows.slice(0, input.limit) : rows).map((r) => ({
        id: r.id,
        riddenAt: r.riddenAt,
        source: r.source,
        metrics: r.metrics,
        attraction: { name: r.attractionName, slug: r.attractionSlug },
        park: { name: r.parkName, slug: r.parkSlug, timezone: r.parkTimezone },
      }));
      const last = items.at(-1);
      const nextCursor =
        hasMore && last ? { riddenAt: last.riddenAt.toISOString(), id: last.id } : null;

      return { items, nextCursor };
    }),

  /** Full progress for the achievements page: stats + unlocked ids + xp/level.
   *  Persists any tiers the current stats already satisfy — so catalog
   *  additions and stats that changed without a ping/track (e.g. pins added to
   *  the collection) unlock on page load instead of waiting on the next ping. */
  progress: protectedProcedure.query(async ({ ctx }) => {
    const stats = await computeStats(ctx.userId);
    const { xp, level } = await evaluateAndUnlock(ctx.userId, stats);
    const unlocked = await db
      .select({ id: userAchievement.achievementId, unlockedAt: userAchievement.unlockedAt })
      .from(userAchievement)
      .where(eq(userAchievement.userId, ctx.userId));
    return { stats, unlocked, xp, level };
  }),

  /**
   * Unlocks whose toast may never have shown (notified_at null), plus current
   * xp/level so the client's replay funnel can also detect a level-up — the
   * same shape `showUnlockToasts` needs everywhere else it's called.
   */
  pendingUnlocks: protectedProcedure.query(async ({ ctx }) => {
    const unlocked = await db
      .select({ id: userAchievement.achievementId, unlockedAt: userAchievement.unlockedAt })
      .from(userAchievement)
      .where(and(eq(userAchievement.userId, ctx.userId), isNull(userAchievement.notifiedAt)));
    if (unlocked.length === 0) return { unlocked, xp: 0, level: levelForXp(0) };

    const all = await db
      .select({ id: userAchievement.achievementId })
      .from(userAchievement)
      .where(eq(userAchievement.userId, ctx.userId));
    const xp = xpForTierIds(all.map((u) => u.id));
    return { unlocked, xp, level: levelForXp(xp) };
  }),

  /** Mark unlock toasts as delivered. */
  ackUnlocks: protectedProcedure
    .input(z.object({ ids: z.array(z.string().max(64)).min(1).max(100) }))
    .mutation(async ({ ctx, input }) => {
      await db
        .update(userAchievement)
        .set({ notifiedAt: new Date() })
        .where(
          and(
            eq(userAchievement.userId, ctx.userId),
            inArray(userAchievement.achievementId, input.ids),
          ),
        );
      return { ok: true };
    }),

  /**
   * QA/dev only: unlock the next catalog tier the caller doesn't have yet,
   * bypassing real stat thresholds — a fast way to exercise the unlock toast
   * on demand. Owner-only (adminProcedure), so it's safe in production without
   * an env flag: real users can't reach it.
   */
  devUnlock: adminProcedure.mutation(({ ctx }) => devUnlockNext(ctx.userId)),

  /** QA/dev only: wipe the caller's own achievement state to replay from zero. */
  devReset: adminProcedure.mutation(async ({ ctx }) => {
    await devResetMine(ctx.userId);
    return { ok: true };
  }),

  /**
   * QA/dev only: wipe just the sensor-tracked ride data (ride events, ride-count
   * rows, sensor stat counters) so native coaster detection can be re-tested
   * without losing GPS park progress. Unlocks stay; re-earning re-fires.
   */
  devResetRides: adminProcedure.mutation(async ({ ctx }) => {
    await devResetRides(ctx.userId);
    return { ok: true };
  }),

  // ---- admin (testing tools) ----

  adminSearchUsers: adminProcedure
    .input(z.object({ q: z.string().trim().min(1).max(200) }))
    .query(async ({ input }) => {
      const q = `%${input.q}%`;
      return db
        .select({
          id: user.id,
          email: user.email,
          name: user.name,
          unlockCount: sql<number>`count(${userAchievement.achievementId})`.mapWith(Number),
        })
        .from(user)
        .leftJoin(userAchievement, eq(userAchievement.userId, user.id))
        .where(or(ilike(user.email, q), ilike(user.name, q)))
        .groupBy(user.id, user.email, user.name)
        .limit(20);
    }),

  adminUserDetail: adminProcedure
    .input(z.object({ userId: z.string() }))
    .query(async ({ input }) => {
      const [row] = await db
        .select({ id: user.id, email: user.email, name: user.name })
        .from(user)
        .where(eq(user.id, input.userId));
      if (!row) throw new TRPCError({ code: "NOT_FOUND" });

      const stats = await computeStats(input.userId);
      const unlocked = await db
        .select({
          id: userAchievement.achievementId,
          unlockedAt: userAchievement.unlockedAt,
          notifiedAt: userAchievement.notifiedAt,
        })
        .from(userAchievement)
        .where(eq(userAchievement.userId, input.userId));
      const xp = xpForTierIds(unlocked.map((u) => u.id));

      return { user: row, stats, unlocked, xp, level: levelForXp(xp) };
    }),

  adminRevoke: adminProcedure
    .input(z.object({ userId: z.string(), achievementIds: z.array(z.string()).min(1).max(200) }))
    .mutation(async ({ input }) => {
      const removed = await db
        .delete(userAchievement)
        .where(
          and(
            eq(userAchievement.userId, input.userId),
            inArray(userAchievement.achievementId, input.achievementIds),
          ),
        )
        .returning({ id: userAchievement.achievementId });
      return { removed: removed.length };
    }),

  adminResetStats: adminProcedure
    .input(z.object({ userId: z.string(), alsoAchievements: z.boolean().default(false) }))
    .mutation(async ({ input }) => {
      await db.delete(userParkDay).where(eq(userParkDay.userId, input.userId));
      await db.delete(userStat).where(eq(userStat.userId, input.userId));
      await db.delete(userGeoState).where(eq(userGeoState.userId, input.userId));
      if (input.alsoAchievements) {
        await db.delete(userAchievement).where(eq(userAchievement.userId, input.userId));
      }
      return { ok: true };
    }),

  /**
   * Backfill: re-evaluate every user who has any achievement-relevant data
   * against the current catalog, persisting newly-satisfied tiers. Run once
   * after adding families/tiers so existing (and dormant) users get credit
   * without waiting on their next ping. Sequential — it's an admin one-shot.
   */
  adminReevaluateAll: adminProcedure.mutation(async () => {
    const sources = await Promise.all([
      db.selectDistinct({ userId: userParkDay.userId }).from(userParkDay),
      db.selectDistinct({ userId: userStat.userId }).from(userStat),
      db.selectDistinct({ userId: pinHave.userId }).from(pinHave),
    ]);
    const ids = new Set(sources.flat().map((r) => r.userId));
    for (const userId of ids) await evaluateAndUnlock(userId);
    return { evaluated: ids.size };
  }),

  // ---- device-test-tooling: time-warp scenarios + synthetic weather ----

  /** Active parks that can seed a sim/scenario (have geocoded attractions),
   *  for the park picker in the on-device sim panel & admin page. */
  adminSimParks: adminProcedure.query(async () => {
    const rows = await db
      .select({
        id: parks.id,
        slug: parks.slug,
        name: parks.name,
        timezone: parks.timezone,
        attractionCount: sql<number>`count(${attractions.id})`.mapWith(Number),
      })
      .from(parks)
      .innerJoin(
        attractions,
        and(
          eq(attractions.parkId, parks.id),
          eq(attractions.entityType, "ATTRACTION"),
          eq(attractions.active, true),
          isNotNull(attractions.category),
          isNotNull(attractions.latitude),
          isNotNull(attractions.longitude),
        ),
      )
      .where(eq(parks.active, true))
      .groupBy(parks.id, parks.slug, parks.name, parks.timezone)
      .orderBy(parks.name);
    return rows;
  }),

  /** One park's anchorable attractions (with coords) for the sim panel's
   *  teleport/queue targets. */
  adminSimPark: adminProcedure
    .input(z.object({ parkId: z.number().int().positive() }))
    .query(async ({ input }) => {
      const park = await loadSimPark(input.parkId);
      if (!park) throw new TRPCError({ code: "NOT_FOUND" });
      return park;
    }),

  /**
   * Replay a scripted park day through the real `ingestPing` pipeline with an
   * injected clock, on the caller's own account. Returns the same
   * unlock/xp/level shape the ping funnel does, so the client fires the whole
   * batch through the live toast/haptic path in one session.
   */
  adminSimulateScenario: adminProcedure
    .input(
      z.object({
        preset: z.enum(SCENARIO_PRESETS),
        parkId: z.number().int().positive(),
        secondParkId: z.number().int().positive().optional(),
        days: z.number().int().min(2).max(30).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const park = await loadSimPark(input.parkId);
      if (!park) throw new TRPCError({ code: "NOT_FOUND", message: "Park not found" });
      const secondPark = input.secondParkId ? await loadSimPark(input.secondParkId) : undefined;
      let script;
      try {
        script = buildScenario(input.preset, {
          park,
          secondPark: secondPark ?? undefined,
          days: input.days,
        });
      } catch (err) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: err instanceof Error ? err.message : "Could not build scenario",
        });
      }
      return runScenario(ctx.userId, script);
    }),

  /** Insert a synthetic "raining now" observation so the rainy-day family is
   *  testable without real weather. Self-expires via the engine's 2 h window. */
  adminSetWeather: adminProcedure
    .input(z.object({ parkId: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      await setSyntheticWeather(input.parkId);
      return { ok: true };
    }),

  // ---- device-test-tooling: Layer D observability ----

  /** Live geo cursor for a user — park, coords, and the dwell state machine's
   *  current anchor (resolved to a name). Refetch on an interval to watch a
   *  queue sim tick. */
  adminGeoCursor: adminProcedure
    .input(z.object({ userId: z.string() }))
    .query(async ({ input }) => {
      const [row] = await db
        .select({
          parkId: userGeoState.parkId,
          parkName: parks.name,
          lng: userGeoState.lng,
          lat: userGeoState.lat,
          at: userGeoState.at,
          anchorAttractionId: userGeoState.anchorAttractionId,
          anchorName: attractions.name,
          anchorSince: userGeoState.anchorSince,
          anchorSeconds: userGeoState.anchorSeconds,
        })
        .from(userGeoState)
        .leftJoin(parks, eq(parks.id, userGeoState.parkId))
        .leftJoin(attractions, eq(attractions.id, userGeoState.anchorAttractionId))
        .where(eq(userGeoState.userId, input.userId));
      return row ?? null;
    }),

  /** Recent park-day rollups (flags included) for a user — the raw rows behind
   *  the geo-derived stat families. */
  adminRecentDays: adminProcedure
    .input(z.object({ userId: z.string() }))
    .query(async ({ input }) => {
      return db
        .select({
          day: userParkDay.day,
          parkName: parks.name,
          distanceM: userParkDay.distanceM,
          steps: userParkDay.steps,
          presentSeconds: userParkDay.presentSeconds,
          queueSeconds: userParkDay.queueSeconds,
          rides: userParkDay.rides,
          ropeDrop: userParkDay.ropeDrop,
          nightOwl: userParkDay.nightOwl,
          rainy: userParkDay.rainy,
        })
        .from(userParkDay)
        .innerJoin(parks, eq(parks.id, userParkDay.parkId))
        .where(eq(userParkDay.userId, input.userId))
        .orderBy(desc(userParkDay.day))
        .limit(30);
    }),

  /** Recent sensor/dwell ride events for a user, with the gate `source` — the
   *  raw rows behind the sensor stat families. */
  adminRecentRides: adminProcedure
    .input(z.object({ userId: z.string() }))
    .query(async ({ input }) => {
      return db
        .select({
          id: userRideEvent.id,
          riddenAt: userRideEvent.riddenAt,
          source: userRideEvent.source,
          attractionName: attractions.name,
          metrics: userRideEvent.metrics,
        })
        .from(userRideEvent)
        .innerJoin(attractions, eq(attractions.id, userRideEvent.attractionId))
        .where(eq(userRideEvent.userId, input.userId))
        .orderBy(desc(userRideEvent.riddenAt), desc(userRideEvent.id))
        .limit(20);
    }),
} satisfies TRPCRouterRecord;
