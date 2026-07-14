/**
 * Sensor ride-trace ingestion.
 *
 * The native `ride-recorder` plugin computes ride metrics on device and uploads
 * a compact `RideTrace`; this module validates it (plausibility bounds), ties it
 * to a real attraction via the user's recent geo state (anti-spoof), records a
 * `user_ride_event`, credits the achievement stats, and re-evaluates unlocks.
 *
 * Kept out of `engine.ts` so that file stays focused on the ping/dwell machine.
 * The pure decision helpers (schema, attraction resolution, coaster clamp,
 * dedupe window, credit path) are exported for unit testing without a DB.
 */
import { and, desc, eq, gte, isNotNull, lte, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { db } from "#/db/index.ts";
import {
  attractions,
  coasterStats,
  parks,
  userAttraction,
  userGeoState,
  userParkDay,
  userRideEvent,
  userStat,
} from "#/db/schema.ts";
import type { StatKey } from "#/lib/achievements.ts";
import { distanceMeters } from "./geo.ts";
import { evaluateAndUnlock, settleDay, type UnlockDTO } from "./engine.ts";
import type { LevelInfo } from "#/lib/achievements.ts";

// A sensor submit must be backed by a location ping this recent, else there's
// no trustworthy attraction anchor ("couch shake" rejection).
const RIDE_FRESH_WINDOW_MS = 15 * 60 * 1000;
// Nearest-active-attraction resolution radius when there's no live anchor.
const NEAREST_MAX_M = 120;
// Two events for the same (user, attraction) this close in time are the same
// physical ride — idempotent, don't double-write.
const DEDUPE_WINDOW_MS = 5 * 60 * 1000;

// ---------------------------------------------------------------------------
// Validation — mirrors RideMetrics with plausibility bounds baked in. Reject
// (don't clamp) at the schema level; the device shouldn't be producing these.
// ---------------------------------------------------------------------------

const isoTimestamp = z
  .string()
  .refine((s) => !Number.isNaN(Date.parse(s)), { message: "unparseable timestamp" });

export const rideMetricsSchema = z
  .object({
    startedAt: isoTimestamp,
    endedAt: isoTimestamp,
    durationS: z.number().gt(0).lte(360),
    dropCount: z.number().int().min(0).max(20),
    airtimeS: z.number().min(0),
    maxG: z.number().min(0).max(8),
    inversions: z.number().int().min(0).max(15),
    verticalM: z.number().min(0).max(600),
    maxDropM: z.number().min(0).max(200),
    // nullish, not nullable: the native bridge drops null-valued keys entirely
    // (Android JSONObject.put(k, null) removes k; iOS serializes Optional.none
    // unreliably), so a no-barometer device sends this key MISSING, not null.
    // Normalize to null so the stored jsonb matches RideMetrics.
    estTopSpeedKmh: z
      .number()
      .min(0)
      .max(300)
      .nullish()
      .transform((v) => v ?? null),
    baroAvailable: z.boolean(),
    gyroAvailable: z.boolean(),
    confidence: z.number().min(0).max(1),
  })
  .refine((m) => m.airtimeS <= m.durationS, { message: "airtimeS exceeds durationS" })
  .refine(
    (m) => {
      const wall = (Date.parse(m.endedAt) - Date.parse(m.startedAt)) / 1000;
      // endedAt−startedAt must agree with durationS within ±10%.
      return wall > 0 && Math.abs(wall - m.durationS) <= m.durationS * 0.1;
    },
    { message: "endedAt−startedAt disagrees with durationS" },
  );

export const rideTraceSchema = z.object({
  metrics: rideMetricsSchema,
  samples: z
    .array(
      z.object({
        t: z.number(),
        aMag: z.number(),
        // Same bridge caveat as estTopSpeedKmh: no-baro samples arrive without
        // the key, not with null.
        altRel: z
          .number()
          .nullish()
          .transform((v) => v ?? null),
      }),
    )
    .max(600)
    .optional(),
});

export type RideTraceInput = z.infer<typeof rideTraceSchema>;

// ---------------------------------------------------------------------------
// Pure decision helpers (unit-tested).
// ---------------------------------------------------------------------------

/** Whether the last geo ping is recent enough to trust as a ride anchor. */
export function isPingFresh(stateAt: Date | null | undefined, now: Date): boolean {
  if (!stateAt) return false;
  const dt = now.getTime() - stateAt.getTime();
  return dt >= 0 && dt <= RIDE_FRESH_WINDOW_MS;
}

/**
 * Resolve the ridden attraction: prefer a live dwell anchor, else the nearest
 * candidate within {@link NEAREST_MAX_M}. `candidates` are pre-filtered to
 * active, geocoded, non-ghost (`category IS NOT NULL`) attractions in the park.
 */
export function resolveRideAttractionId(
  anchorAttractionId: number | null | undefined,
  candidates: ReadonlyArray<{ id: number; distM: number }>,
): number | null {
  if (anchorAttractionId != null) return anchorAttractionId;
  let best: { id: number; distM: number } | null = null;
  for (const c of candidates) {
    if (c.distM <= NEAREST_MAX_M && (!best || c.distM < best.distM)) best = c;
  }
  return best?.id ?? null;
}

/**
 * Reject on-device metrics that contradict the coaster's published figures
 * (loose bounds — sensor error is expected). Returns a reason, or null if the
 * metrics are plausible / there's no published figure to check against.
 */
export function coasterClampReason(
  metrics: { inversions: number; verticalM: number },
  stats: { inversions: number | null; dropHeightM: number | null } | null,
): string | null {
  if (!stats) return null;
  if (stats.inversions != null && metrics.inversions > stats.inversions + 2) {
    return `inversions ${metrics.inversions} exceeds published ${stats.inversions}+2`;
  }
  if (stats.dropHeightM != null && metrics.verticalM > stats.dropHeightM * 3) {
    return `verticalM ${metrics.verticalM} exceeds 3× published drop ${stats.dropHeightM}`;
  }
  return null;
}

/** Two timestamps within the dedupe window = the same physical ride. */
export function isWithinDedupeWindow(a: Date, b: Date): boolean {
  return Math.abs(a.getTime() - b.getTime()) <= DEDUPE_WINDOW_MS;
}

/**
 * The double-count guard. When the sensor ride resolves to the *same*
 * attraction the geo state is currently anchored to, the dwell-settle path
 * (`settleAnchorRow`) will credit `user_attraction` + `user_park_day.rides` on
 * geofence exit — so the sensor path must NOT also credit the ride count, only
 * attach metrics. Otherwise the sensor path is the sole crediter.
 */
export function creditDecision(
  anchorAttractionId: number | null | undefined,
  resolvedAttractionId: number,
): { creditRideCount: boolean; source: "sensor" | "sensor+dwell" } {
  const anchoredSame = anchorAttractionId != null && anchorAttractionId === resolvedAttractionId;
  return {
    creditRideCount: !anchoredSame,
    source: anchoredSame ? "sensor+dwell" : "sensor",
  };
}

// ---------------------------------------------------------------------------
// Stat writers.
// ---------------------------------------------------------------------------

/** Additive `user_stat` upsert (server-written sensor counters). */
async function addStat(userId: string, stat: StatKey, by: number): Promise<void> {
  if (by === 0) return;
  await db
    .insert(userStat)
    .values({ userId, stat, value: by })
    .onConflictDoUpdate({
      target: [userStat.userId, userStat.stat],
      set: { value: sql`${userStat.value} + ${by}`, updatedAt: new Date() },
    });
}

/** High-water-mark `user_stat` upsert (e.g. `max_g_best`). */
async function raiseStat(userId: string, stat: StatKey, to: number): Promise<void> {
  await db
    .insert(userStat)
    .values({ userId, stat, value: to })
    .onConflictDoUpdate({
      target: [userStat.userId, userStat.stat],
      set: { value: sql`GREATEST(${userStat.value}, ${to})`, updatedAt: new Date() },
    });
}

// ---------------------------------------------------------------------------
// Orchestration.
// ---------------------------------------------------------------------------

export async function ingestRideTrace(
  userId: string,
  input: RideTraceInput,
): Promise<{ newlyUnlocked: UnlockDTO[]; xp: number; level: LevelInfo }> {
  const { metrics } = input;
  const startedAt = new Date(metrics.startedAt);
  const now = new Date();

  // 1. Geofence cross-check — a recent ping in a park is required.
  const [state] = await db.select().from(userGeoState).where(eq(userGeoState.userId, userId));
  if (!state || state.parkId == null || !isPingFresh(state.at, now)) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "No recent in-park location to attribute this ride to.",
    });
  }

  // Resolve the attraction: prefer the live dwell anchor, else nearest active
  // non-ghost attraction within range of the last ping.
  let resolvedId = state.anchorAttractionId ?? null;
  if (resolvedId == null && state.lng != null && state.lat != null) {
    const nearby = await db
      .select({ id: attractions.id, lat: attractions.latitude, lng: attractions.longitude })
      .from(attractions)
      .where(
        and(
          eq(attractions.parkId, state.parkId),
          eq(attractions.active, true),
          isNotNull(attractions.category), // drop un-enriched ghost duplicates
          isNotNull(attractions.latitude),
          isNotNull(attractions.longitude),
        ),
      );
    const point: [number, number] = [state.lng, state.lat];
    const candidates = nearby
      .filter((a): a is { id: number; lat: number; lng: number } => a.lat != null && a.lng != null)
      .map((a) => ({ id: a.id, distM: distanceMeters(point, [a.lng, a.lat]) }));
    resolvedId = resolveRideAttractionId(null, candidates);
  }
  if (resolvedId == null) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Couldn't match this ride to a nearby attraction.",
    });
  }

  // 2. Sanity-clamp against published coaster figures when we have them.
  const [stats] = await db
    .select({ inversions: coasterStats.inversions, dropHeightM: coasterStats.dropHeightM })
    .from(coasterStats)
    .where(eq(coasterStats.attractionId, resolvedId));
  const clamp = coasterClampReason(metrics, stats ?? null);
  if (clamp) {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: `Implausible metrics: ${clamp}` });
  }

  // 3. Dedupe: same (user, attraction) within ±5 min of startedAt → idempotent.
  const [dupe] = await db
    .select({ id: userRideEvent.id })
    .from(userRideEvent)
    .where(
      and(
        eq(userRideEvent.userId, userId),
        eq(userRideEvent.attractionId, resolvedId),
        gte(userRideEvent.riddenAt, new Date(startedAt.getTime() - DEDUPE_WINDOW_MS)),
        lte(userRideEvent.riddenAt, new Date(startedAt.getTime() + DEDUPE_WINDOW_MS)),
      ),
    )
    .orderBy(desc(userRideEvent.riddenAt))
    .limit(1);
  if (dupe) return evaluateAndUnlock(userId);

  const decision = creditDecision(state.anchorAttractionId, resolvedId);

  // 4. Write the per-ride fact row.
  await db.insert(userRideEvent).values({
    userId,
    attractionId: resolvedId,
    parkId: state.parkId,
    riddenAt: startedAt,
    source: decision.source,
    metrics,
    trace: input,
  });

  // 5. Credit the ride count — unless the dwell-settle path will (anchored to
  // the same attraction), which would double-count.
  if (decision.creditRideCount) {
    await db
      .insert(userAttraction)
      .values({ userId, attractionId: resolvedId, parkId: state.parkId, rideCount: 1 })
      .onConflictDoUpdate({
        target: [userAttraction.userId, userAttraction.attractionId],
        set: { rideCount: sql`${userAttraction.rideCount} + 1`, lastRiddenAt: now },
      });

    const [park] = await db
      .select({ timezone: parks.timezone })
      .from(parks)
      .where(eq(parks.id, state.parkId));
    if (park) {
      const day = settleDay(startedAt, startedAt, park.timezone);
      await db
        .insert(userParkDay)
        .values({ userId, parkId: state.parkId, day, rides: 1 })
        .onConflictDoUpdate({
          target: [userParkDay.userId, userParkDay.parkId, userParkDay.day],
          set: { rides: sql`${userParkDay.rides} + 1`, lastSeenAt: now },
        });
    }
  }

  // 6. Bump the sensor-derived stat counters (always — these are per-ride
  // metrics, independent of the ride-count credit guard above).
  // Accumulate floats raw (user_stat.value is double precision) — per-ride
  // rounding floor-biases small values (a 0.4 s airtime ride credited 0 against
  // a 10 s first tier). Rounding happens at display time (formatStatValue).
  await addStat(userId, "coaster_drops", metrics.dropCount);
  await addStat(userId, "airtime_seconds", metrics.airtimeS);
  await addStat(userId, "inversions_ridden", metrics.inversions);
  await addStat(userId, "vertical_m", metrics.verticalM);
  await raiseStat(userId, "max_g_best", metrics.maxG);

  // 7. Re-evaluate — same shape the ping/track toast funnel consumes.
  return evaluateAndUnlock(userId);
}
