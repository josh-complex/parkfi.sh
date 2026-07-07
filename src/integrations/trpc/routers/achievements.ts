import { TRPCError, type TRPCRouterRecord } from "@trpc/server";
import { and, eq, ilike, inArray, isNull, or, sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "#/db/index.ts";
import { user, userAchievement, userGeoState, userParkDay, userStat } from "#/db/schema.ts";
import { TRACK_EVENTS, levelForXp, xpForTierIds, type TrackEvent } from "#/lib/achievements.ts";
import {
  bumpEventStat,
  computeStats,
  devResetMine,
  devUnlockNext,
  ingestPing,
} from "#/server/achievements/engine.ts";
import { adminProcedure, protectedProcedure } from "../init.ts";

const TRACK_EVENT_KEYS = Object.keys(TRACK_EVENTS) as [TrackEvent, ...TrackEvent[]];

/**
 * QA backdoor for the unlock toast/haptic/level-up funnel — bypasses real stat
 * thresholds entirely, so it must never be reachable by real users in
 * production. Same convention as Living Layer's LIVING_DEV (config.ts):
 * enabled by default outside production, opt-in only via env var in prod.
 */
const ACHIEVEMENTS_DEV =
  process.env.ACHIEVEMENTS_DEV === "1" || process.env.NODE_ENV !== "production";

export const achievementsRouter = {
  /** Location ping from the tracker. ~1 per 30s per active user. */
  ping: protectedProcedure
    .input(
      z.object({
        lng: z.number().gte(-180).lte(180),
        lat: z.number().gte(-90).lte(90),
        accuracy: z.number().nonnegative().max(100_000),
      }),
    )
    .mutation(({ ctx, input }) => ingestPing(ctx.userId, input.lng, input.lat, input.accuracy)),

  /** Allowlisted client event (pin scan, alert created, …). */
  track: protectedProcedure
    .input(z.object({ event: z.enum(TRACK_EVENT_KEYS) }))
    .mutation(({ ctx, input }) => bumpEventStat(ctx.userId, input.event)),

  /** Full progress for the achievements page: stats + unlocked ids + xp/level. */
  progress: protectedProcedure.query(async ({ ctx }) => {
    const stats = await computeStats(ctx.userId);
    const unlocked = await db
      .select({ id: userAchievement.achievementId, unlockedAt: userAchievement.unlockedAt })
      .from(userAchievement)
      .where(eq(userAchievement.userId, ctx.userId));
    const xp = xpForTierIds(unlocked.map((u) => u.id));
    return { stats, unlocked, xp, level: levelForXp(xp) };
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
   * on demand. FORBIDDEN unless ACHIEVEMENTS_DEV (see above).
   */
  devUnlock: protectedProcedure.mutation(({ ctx }) => {
    if (!ACHIEVEMENTS_DEV) throw new TRPCError({ code: "FORBIDDEN" });
    return devUnlockNext(ctx.userId);
  }),

  /** QA/dev only: wipe the caller's own achievement state to replay from zero. */
  devReset: protectedProcedure.mutation(async ({ ctx }) => {
    if (!ACHIEVEMENTS_DEV) throw new TRPCError({ code: "FORBIDDEN" });
    await devResetMine(ctx.userId);
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
} satisfies TRPCRouterRecord;
