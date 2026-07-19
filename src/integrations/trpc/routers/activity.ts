/**
 * /activity page endpoints — the per-park-day recap feed.
 *
 * Reads the `user_park_day` rollups the achievements engine maintains
 * (src/server/achievements/engine.ts) plus the per-ride `user_ride_event`
 * journal and same-day achievement unlocks. Lifetime totals deliberately have
 * no endpoint here — the client reuses `achievements.progress`.
 */
import { type TRPCRouterRecord } from "@trpc/server";
import { and, asc, desc, eq, gte, inArray, lt, lte } from "drizzle-orm";
import { z } from "zod";

import { db } from "#/db/index.ts";
import { attractions, parks, userAchievement, userParkDay, userRideEvent } from "#/db/schema.ts";
import { localParts } from "#/server/achievements/engine.ts";
import { protectedProcedure } from "../init.ts";

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** One park's slice of a local day, joined with park identity for display. */
const dayEntrySelection = {
  day: userParkDay.day,
  parkName: parks.name,
  parkSlug: parks.slug,
  parkTimezone: parks.timezone,
  firstSeenAt: userParkDay.firstSeenAt,
  lastSeenAt: userParkDay.lastSeenAt,
  steps: userParkDay.steps,
  distanceM: userParkDay.distanceM,
  presentSeconds: userParkDay.presentSeconds,
  queueSeconds: userParkDay.queueSeconds,
  rides: userParkDay.rides,
  shows: userParkDay.shows,
  ropeDrop: userParkDay.ropeDrop,
  nightOwl: userParkDay.nightOwl,
  rainy: userParkDay.rainy,
};

type DayEntryRow = {
  day: string;
  parkName: string;
  parkSlug: string;
  parkTimezone: string;
  firstSeenAt: Date;
  lastSeenAt: Date;
  steps: number;
  distanceM: number;
  presentSeconds: number;
  queueSeconds: number;
  rides: number;
  shows: number;
  ropeDrop: boolean;
  nightOwl: boolean;
  rainy: boolean;
};

function toEntry(r: DayEntryRow) {
  return {
    park: { name: r.parkName, slug: r.parkSlug, timezone: r.parkTimezone },
    firstSeenAt: r.firstSeenAt,
    lastSeenAt: r.lastSeenAt,
    steps: r.steps,
    distanceM: r.distanceM,
    presentSeconds: r.presentSeconds,
    queueSeconds: r.queueSeconds,
    rides: r.rides,
    shows: r.shows,
    ropeDrop: r.ropeDrop,
    nightOwl: r.nightOwl,
    rainy: r.rainy,
  };
}

/**
 * UTC probe window guaranteed to contain every instant of `day` in any park
 * timezone (UTC−12 … UTC+14): the day's UTC midnight ± 24h/+48h. Rows are then
 * exact-filtered through `localParts` against a real timezone.
 */
function utcWindowForDay(day: string): { from: Date; to: Date } {
  const base = Date.parse(`${day}T00:00:00Z`);
  return { from: new Date(base - 24 * 60 * 60 * 1000), to: new Date(base + 48 * 60 * 60 * 1000) };
}

export const activityRouter = {
  /**
   * The day feed: park-day rollups grouped by local day, newest first.
   * Keyset-paginated on the day string; entries within a day are ordered by
   * arrival (`firstSeenAt`), which IS the park-hop chain (MK → EPCOT).
   */
  myActivityDays: protectedProcedure
    .input(
      z.object({
        limit: z.number().int().min(1).max(30).default(15),
        cursor: z.string().regex(DAY_RE).nullish(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const dayRows = await db
        .selectDistinct({ day: userParkDay.day })
        .from(userParkDay)
        .where(
          and(
            eq(userParkDay.userId, ctx.userId),
            input.cursor ? lt(userParkDay.day, input.cursor) : undefined,
          ),
        )
        .orderBy(desc(userParkDay.day))
        .limit(input.limit + 1);

      const hasMore = dayRows.length > input.limit;
      const wanted = (hasMore ? dayRows.slice(0, input.limit) : dayRows).map((r) => r.day);
      if (wanted.length === 0) return { days: [], nextCursor: null };

      const rows = await db
        .select(dayEntrySelection)
        .from(userParkDay)
        .innerJoin(parks, eq(parks.id, userParkDay.parkId))
        .where(and(eq(userParkDay.userId, ctx.userId), inArray(userParkDay.day, wanted)))
        .orderBy(desc(userParkDay.day), asc(userParkDay.firstSeenAt));

      const byDay = new Map<string, ReturnType<typeof toEntry>[]>();
      for (const r of rows) {
        const list = byDay.get(r.day) ?? [];
        list.push(toEntry(r));
        byDay.set(r.day, list);
      }
      return {
        days: wanted.map((day) => ({ day, entries: byDay.get(day) ?? [] })),
        nextCursor: hasMore ? wanted.at(-1)! : null,
      };
    }),

  /**
   * One expanded day: its park entries, the ride-by-ride timeline (ALL
   * sources — dwell rides have no metrics, which is fine here, unlike the
   * sensor-only `achievements.myRideLog`), and the badges unlocked that local
   * day. "Local day" resolves per ride against its own park's timezone; the
   * unlock filter uses the day's first park (hop days share a resort
   * timezone in practice).
   */
  myDayDetail: protectedProcedure
    .input(z.object({ day: z.string().regex(DAY_RE) }))
    .query(async ({ ctx, input }) => {
      const rows = await db
        .select(dayEntrySelection)
        .from(userParkDay)
        .innerJoin(parks, eq(parks.id, userParkDay.parkId))
        .where(and(eq(userParkDay.userId, ctx.userId), eq(userParkDay.day, input.day)))
        .orderBy(asc(userParkDay.firstSeenAt));
      if (rows.length === 0) {
        return { entries: [], rideEvents: [], unlocks: [] };
      }

      const { from, to } = utcWindowForDay(input.day);
      const rideRows = await db
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
            gte(userRideEvent.riddenAt, from),
            lte(userRideEvent.riddenAt, to),
          ),
        )
        .orderBy(asc(userRideEvent.riddenAt), asc(userRideEvent.id));
      const rideEvents = rideRows
        .filter((r) => localParts(r.riddenAt, r.parkTimezone).day === input.day)
        .map((r) => ({
          id: r.id,
          riddenAt: r.riddenAt,
          source: r.source,
          metrics: r.metrics,
          attraction: { name: r.attractionName, slug: r.attractionSlug },
          park: { name: r.parkName, slug: r.parkSlug, timezone: r.parkTimezone },
        }));

      const tz = rows[0].parkTimezone;
      const unlockRows = await db
        .select({ id: userAchievement.achievementId, unlockedAt: userAchievement.unlockedAt })
        .from(userAchievement)
        .where(
          and(
            eq(userAchievement.userId, ctx.userId),
            gte(userAchievement.unlockedAt, from),
            lte(userAchievement.unlockedAt, to),
          ),
        )
        .orderBy(asc(userAchievement.unlockedAt));
      const unlocks = unlockRows.filter((u) => localParts(u.unlockedAt, tz).day === input.day);

      return { entries: rows.map(toEntry), rideEvents, unlocks };
    }),
} satisfies TRPCRouterRecord;
