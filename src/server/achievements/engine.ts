/**
 * Levels & achievements — engine.
 *
 * Turns a location ping (or a client-reported app event) into: a
 * `user_park_day` rollup update, a queue-dwell state machine over
 * `user_geo_state`, and a re-evaluation of the shared catalog
 * (`src/lib/achievements.ts`) against the user's aggregated stats. Deliberately
 * independent of the Living Layer — no imports from `src/server/living/**`.
 */
import { and, count, desc, eq, gt, inArray, isNotNull, ne, sql } from "drizzle-orm";

import { db } from "#/db/index.ts";
import {
  attractions,
  coasterStats,
  parks,
  pinHave,
  userAchievement,
  userAttraction,
  userGeoState,
  userParkDay,
  userRideEvent,
  userStat,
  weatherObs,
  type GeoPolygon,
} from "#/db/schema.ts";
import {
  ACHIEVEMENTS,
  TRACK_EVENTS,
  levelForXp,
  satisfiedTierIds,
  xpForTierIds,
  type LevelInfo,
  type Stats,
  type StatKey,
  type TrackEvent,
} from "#/lib/achievements.ts";
import { Source } from "#/server/parks/codes.ts";
import { distanceMeters, pointInPolygon, type LngLat } from "./geo.ts";

const PING_MAX_ACCURACY_M = 150; // drop noisy fixes
const PING_MAX_GAP_S = 300; // deltas older than this don't accrue distance/queue
const WALK_SPEED_CAP_MS = 2.5; // m/s — clamps GPS jumps & vehicle travel
const QUEUE_ENTER_RADIUS_M = 40; // anchor to an attraction within this
const QUEUE_EXIT_RADIUS_M = 60; // hysteresis: keep anchor until beyond this
const QUEUE_MIN_DWELL_S = 480; // ≥8 min anchored ⇒ it was a queue ⇒ +1 ride
const ROPE_DROP_BEFORE = { h: 9, m: 30 }; // local
const NIGHT_OWL_AFTER_H = 22; // local
const CACHE_TTL_MS = 10 * 60 * 1000;

export interface UnlockDTO {
  id: string;
  unlockedAt: Date;
}

export interface IngestResult {
  inPark: boolean;
  parkId?: number;
  newlyUnlocked: UnlockDTO[];
  xp?: number;
  level?: LevelInfo;
  today?: { distanceM: number; queueSeconds: number; rides: number };
}

// ---------------------------------------------------------------------------
// In-module caches (park geo + per-park attraction coords). TTL'd, not
// invalidated — geo/attraction data changes on a monthly cron cadence, so a
// few minutes of staleness is a non-issue.
// ---------------------------------------------------------------------------

interface CachedPark {
  id: number;
  timezone: string;
  latMin: number;
  latMax: number;
  lngMin: number;
  lngMax: number;
  boundary: GeoPolygon | null;
}

let parksCache: { at: number; data: CachedPark[] } | null = null;

async function getParks(): Promise<CachedPark[]> {
  if (parksCache && Date.now() - parksCache.at < CACHE_TTL_MS) return parksCache.data;
  const rows = await db
    .select({
      id: parks.id,
      timezone: parks.timezone,
      latMin: parks.latMin,
      latMax: parks.latMax,
      lngMin: parks.lngMin,
      lngMax: parks.lngMax,
      boundary: parks.boundary,
    })
    .from(parks)
    .where(and(eq(parks.active, true), isNotNull(parks.latMin)));
  const data = rows
    .filter(
      (r): r is typeof r & { latMin: number; latMax: number; lngMin: number; lngMax: number } =>
        r.latMin != null && r.latMax != null && r.lngMin != null && r.lngMax != null,
    )
    .map((r) => ({ ...r, boundary: r.boundary ?? null }));
  parksCache = { at: Date.now(), data };
  return data;
}

interface CachedAttraction {
  id: number;
  lng: number;
  lat: number;
}

const attractionsCache = new Map<number, { at: number; data: CachedAttraction[] }>();

async function getAttractions(parkId: number): Promise<CachedAttraction[]> {
  const cached = attractionsCache.get(parkId);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.data;
  const rows = await db
    .select({
      id: attractions.id,
      latitude: attractions.latitude,
      longitude: attractions.longitude,
    })
    .from(attractions)
    .where(
      and(
        eq(attractions.parkId, parkId),
        eq(attractions.entityType, "ATTRACTION"),
        eq(attractions.active, true),
        isNotNull(attractions.latitude),
        isNotNull(attractions.longitude),
      ),
    );
  const data = rows
    .filter(
      (r): r is typeof r & { latitude: number; longitude: number } =>
        r.latitude != null && r.longitude != null,
    )
    .map((r) => ({ id: r.id, lng: r.longitude, lat: r.latitude }));
  attractionsCache.set(parkId, { at: Date.now(), data });
  return data;
}

/** Bounds prefilter, then a true polygon test when a boundary is present. */
function parkForPoint(p: LngLat, allParks: CachedPark[]): { id: number; timezone: string } | null {
  const [lng, lat] = p;
  for (const park of allParks) {
    if (lat < park.latMin || lat > park.latMax || lng < park.lngMin || lng > park.lngMax) continue;
    if (park.boundary && !pointInPolygon(p, park.boundary)) continue;
    return { id: park.id, timezone: park.timezone };
  }
  return null;
}

/**
 * Gap-bounded presence seconds contributed by one ping — the delta since the
 * previous ping, but only when that ping was in the *same* park and recent
 * enough to trust as continuous presence. Anything longer than `maxGapS` (app
 * backgrounded, left the park and came back) contributes nothing, which is what
 * keeps `park_seconds` honest. Pure so it can be unit-tested.
 */
export function presenceDelta(
  sameParkAsState: boolean,
  elapsed: number | null,
  maxGapS: number,
): number {
  if (!sameParkAsState || elapsed == null || elapsed <= 0 || elapsed > maxGapS) return 0;
  return elapsed;
}

/**
 * The park-local day a queue dwell settles to: the day of the last confirmed
 * anchored ping (`anchorAt`), NOT `now`. A dwell that ends after a local-day
 * rollover — or after the app was closed and the next ping lands outside the
 * park the following morning — must credit the day it actually happened, which
 * is the only day guaranteed to have a `user_park_day` row for the settle
 * UPDATE to hit. Falls back to `now` if the cursor lacks a timestamp. Pure.
 */
export function settleDay(anchorAt: Date | null | undefined, now: Date, timeZone: string): string {
  return localParts(anchorAt ?? now, timeZone).day;
}

/** Park-local calendar day + clock time, via Intl (en-CA gives YYYY-MM-DD). */
function localParts(now: Date, timeZone: string): { day: string; hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const day = `${get("year")}-${get("month")}-${get("day")}`;
  const hour = Number(get("hour")) % 24; // some ICU builds render midnight as "24"
  const minute = Number(get("minute"));
  return { day, hour, minute };
}

/** Latest weather_obs for the park within the 2h before `now` — FORECAST or
 *  ACTUAL, latest wins. `now` is explicit (not `now()`) so a time-warped
 *  scenario ping evaluates rain against the *injected* clock, not the DB wall
 *  clock — see `adminSimulateScenario`. MANUAL_SEED rows (the dev panel's
 *  "Make it rain") are visible only when `seededWeather` — real users in the
 *  park must not inherit an admin's synthetic rain. */
async function isRainyNow(parkId: number, now: Date, seededWeather: boolean): Promise<boolean> {
  const [row] = await db
    .select({ precipMm: weatherObs.precipMm, condition: weatherObs.condition })
    .from(weatherObs)
    .where(
      and(
        eq(weatherObs.parkId, parkId),
        gt(weatherObs.observedAt, new Date(now.getTime() - 2 * 60 * 60 * 1000)),
        seededWeather ? undefined : ne(weatherObs.source, Source.MANUAL_SEED),
      ),
    )
    .orderBy(desc(weatherObs.observedAt))
    .limit(1);
  if (!row) return false;
  if (row.precipMm != null && row.precipMm > 0) return true;
  return (
    row.condition === "Rain" || row.condition === "Drizzle" || row.condition === "Thunderstorm"
  );
}

/** Bump today's queue_seconds/rides on settle — shared by the same-park exit
 *  case and the cross-park/left-park case (§ ingestPing steps 4 & 7). Also
 *  records the distinct attraction (powers `attractions_unique`). */
async function settleAnchorRow(
  userId: string,
  parkId: number,
  day: string,
  anchorSeconds: number,
  attractionId: number,
): Promise<void> {
  if (anchorSeconds < QUEUE_MIN_DWELL_S) return;
  await db
    .update(userParkDay)
    .set({
      queueSeconds: sql`${userParkDay.queueSeconds} + ${Math.round(anchorSeconds)}`,
      rides: sql`${userParkDay.rides} + 1`,
    })
    .where(
      and(eq(userParkDay.userId, userId), eq(userParkDay.parkId, parkId), eq(userParkDay.day, day)),
    );
  await db
    .insert(userAttraction)
    .values({ userId, attractionId, parkId, rideCount: 1 })
    .onConflictDoUpdate({
      target: [userAttraction.userId, userAttraction.attractionId],
      set: { rideCount: sql`${userAttraction.rideCount} + 1`, lastRiddenAt: new Date() },
    });
}

/**
 * The core: fold one location ping into the user's park-day rollup, run the
 * queue-dwell state machine, and re-evaluate achievements.
 *
 * The public `ping` procedure never forwards a client time — it calls this with
 * the default `now = new Date()`, so real pings still run on server time only.
 * The `now` parameter exists solely for the admin time-warp scenario runner
 * (`adminSimulateScenario`), which replays a scripted day through the real
 * pipeline with an injected clock. Keep the injectable path admin-only.
 *
 * `seededWeather` lets MANUAL_SEED weather rows (the dev panel's "Make it
 * rain") count as rain for this ping. Only admin pings may set it — a seeded
 * row lives in the shared per-park table, so without the gate every real user
 * in the park would earn rainy credit off an admin's test.
 */
export async function ingestPing(
  userId: string,
  lng: number,
  lat: number,
  accuracyM: number,
  now: Date = new Date(),
  opts: { seededWeather?: boolean } = {},
): Promise<IngestResult> {
  if (accuracyM > PING_MAX_ACCURACY_M) {
    return { inPark: false, newlyUnlocked: [] };
  }

  const point: LngLat = [lng, lat];
  const allParks = await getParks();
  const park = parkForPoint(point, allParks);

  const [state] = await db.select().from(userGeoState).where(eq(userGeoState.userId, userId));
  const elapsed = state?.at ? (now.getTime() - state.at.getTime()) / 1000 : null;

  // Left-park / cross-park anchor settlement, against the OLD park's current
  // local day, before we switch state to the new park (or none).
  if (state?.anchorAttractionId != null && (!park || park.id !== state.parkId)) {
    const oldPark = allParks.find((p) => p.id === state.parkId);
    if (oldPark) {
      const oldDay = settleDay(state.at, now, oldPark.timezone);
      await settleAnchorRow(
        userId,
        oldPark.id,
        oldDay,
        state.anchorSeconds,
        state.anchorAttractionId,
      );
    }
  }

  if (!park) {
    await db
      .insert(userGeoState)
      .values({
        userId,
        parkId: null,
        lng,
        lat,
        at: now,
        anchorAttractionId: null,
        anchorSince: null,
        anchorSeconds: 0,
      })
      .onConflictDoUpdate({
        target: userGeoState.userId,
        set: {
          parkId: null,
          lng,
          lat,
          at: now,
          anchorAttractionId: null,
          anchorSince: null,
          anchorSeconds: 0,
        },
      });
    return { inPark: false, newlyUnlocked: [] };
  }

  const { day, hour, minute } = localParts(now, park.timezone);
  const sameParkAsState = state?.parkId === park.id;
  const moved =
    sameParkAsState &&
    elapsed != null &&
    elapsed <= PING_MAX_GAP_S &&
    state?.lng != null &&
    state?.lat != null
      ? Math.min(distanceMeters([state.lng, state.lat], point), WALK_SPEED_CAP_MS * elapsed)
      : 0;
  const present = presenceDelta(sameParkAsState, elapsed, PING_MAX_GAP_S);
  const ropeDrop =
    hour < ROPE_DROP_BEFORE.h || (hour === ROPE_DROP_BEFORE.h && minute < ROPE_DROP_BEFORE.m);
  const nightOwl = hour >= NIGHT_OWL_AFTER_H;
  const rainy = await isRainyNow(park.id, now, opts.seededWeather ?? false);

  await db
    .insert(userParkDay)
    .values({
      userId,
      parkId: park.id,
      day,
      pings: 1,
      distanceM: moved,
      presentSeconds: Math.round(present),
      ropeDrop,
      nightOwl,
      rainy,
    })
    .onConflictDoUpdate({
      target: [userParkDay.userId, userParkDay.parkId, userParkDay.day],
      set: {
        lastSeenAt: now,
        pings: sql`${userParkDay.pings} + 1`,
        distanceM: sql`${userParkDay.distanceM} + ${moved}`,
        presentSeconds: sql`${userParkDay.presentSeconds} + ${Math.round(present)}`,
        ropeDrop: sql`${userParkDay.ropeDrop} OR ${ropeDrop}`,
        nightOwl: sql`${userParkDay.nightOwl} OR ${nightOwl}`,
        rainy: sql`${userParkDay.rainy} OR ${rainy}`,
      },
    });

  // Queue dwell state machine.
  const attractionsForPark = await getAttractions(park.id);
  let nearest: { id: number; d: number } | null = null;
  for (const a of attractionsForPark) {
    const d = distanceMeters(point, [a.lng, a.lat]);
    if (!nearest || d < nearest.d) nearest = { id: a.id, d };
  }

  const priorAnchorId = sameParkAsState ? (state?.anchorAttractionId ?? null) : null;
  const priorAnchorSeconds = sameParkAsState ? (state?.anchorSeconds ?? 0) : 0;
  const anchoredAttraction =
    priorAnchorId != null ? attractionsForPark.find((a) => a.id === priorAnchorId) : undefined;
  const anchoredDist = anchoredAttraction
    ? distanceMeters(point, [anchoredAttraction.lng, anchoredAttraction.lat])
    : null;

  let anchorAttractionId: number | null;
  let anchorSince: Date | null;
  let anchorSeconds: number;

  if (priorAnchorId != null && anchoredDist != null && anchoredDist <= QUEUE_EXIT_RADIUS_M) {
    // Continue the existing dwell.
    anchorAttractionId = priorAnchorId;
    anchorSince = state?.anchorSince ?? now;
    anchorSeconds = priorAnchorSeconds + Math.min(elapsed ?? 0, PING_MAX_GAP_S);
  } else {
    // Settle a dwell we just walked away from, then see if we entered a new one.
    if (priorAnchorId != null)
      await settleAnchorRow(userId, park.id, day, priorAnchorSeconds, priorAnchorId);
    if (nearest && nearest.d <= QUEUE_ENTER_RADIUS_M) {
      anchorAttractionId = nearest.id;
      anchorSince = now;
      anchorSeconds = 0;
    } else {
      anchorAttractionId = null;
      anchorSince = null;
      anchorSeconds = 0;
    }
  }

  await db
    .insert(userGeoState)
    .values({
      userId,
      parkId: park.id,
      lng,
      lat,
      at: now,
      anchorAttractionId,
      anchorSince,
      anchorSeconds,
    })
    .onConflictDoUpdate({
      target: userGeoState.userId,
      set: { parkId: park.id, lng, lat, at: now, anchorAttractionId, anchorSince, anchorSeconds },
    });

  const [todayRow] = await db
    .select({
      distanceM: userParkDay.distanceM,
      queueSeconds: userParkDay.queueSeconds,
      rides: userParkDay.rides,
    })
    .from(userParkDay)
    .where(
      and(
        eq(userParkDay.userId, userId),
        eq(userParkDay.parkId, park.id),
        eq(userParkDay.day, day),
      ),
    );

  const { newlyUnlocked, xp, level } = await evaluateAndUnlock(userId);

  return {
    inPark: true,
    parkId: park.id,
    newlyUnlocked,
    xp,
    level,
    today: todayRow ?? { distanceM: moved, queueSeconds: 0, rides: 0 },
  };
}

/** One `user_park_day` row, narrowed to the fields the stat math needs. */
export interface DayStatRow {
  parkId: number;
  day: string; // park-local YYYY-MM-DD
  distanceM: number;
  presentSeconds: number;
  queueSeconds: number;
  rides: number;
  ropeDrop: boolean;
  nightOwl: boolean;
  rainy: boolean;
}

/** Sat/Sun in the row's own park-local calendar (`day` is already local
 *  YYYY-MM-DD). Parsed at UTC noon so the weekday can't shift across a boundary. */
function isWeekend(day: string): boolean {
  const dow = new Date(`${day}T12:00:00Z`).getUTCDay();
  return dow === 0 || dow === 6;
}

/**
 * Pure: fold the user's park-day rows into the day-derived slice of Stats.
 * DB-free so the arithmetic (sums, distinct sets, streaks, weekday buckets) is
 * unit-testable without a database. `computeStats` layers the cross-table and
 * event-counter stats on top.
 */
export function aggregateDayRows(dayRows: DayStatRow[]): Stats {
  const stats: Stats = {
    park_days: dayRows.length,
    parks_unique: new Set(dayRows.map((r) => r.parkId)).size,
    distance_m: dayRows.reduce((s, r) => s + r.distanceM, 0),
    queue_seconds: dayRows.reduce((s, r) => s + r.queueSeconds, 0),
    rides: dayRows.reduce((s, r) => s + r.rides, 0),
    rope_drops: dayRows.filter((r) => r.ropeDrop).length,
    night_owls: dayRows.filter((r) => r.nightOwl).length,
    rain_days: dayRows.filter((r) => r.rainy).length,
    best_day_distance_m: dayRows.reduce((m, r) => Math.max(m, r.distanceM), 0),
    best_day_queue_seconds: dayRows.reduce((m, r) => Math.max(m, r.queueSeconds), 0),
    park_seconds: dayRows.reduce((s, r) => s + r.presentSeconds, 0),
    full_days: dayRows.filter((r) => r.ropeDrop && r.nightOwl).length,
    weekend_days: dayRows.filter((r) => isWeekend(r.day)).length,
  };

  const byDay = new Map<string, Set<number>>();
  for (const r of dayRows) {
    const set = byDay.get(r.day) ?? new Set<number>();
    set.add(r.parkId);
    byDay.set(r.day, set);
  }
  stats.park_hop_days = [...byDay.values()].filter((s) => s.size >= 2).length;

  // Longest run of consecutive dates over the distinct sorted day set — parsed
  // at UTC noon so DST transitions can't shift a date across a day boundary.
  const distinctDays = [...byDay.keys()].sort();
  let best = 0;
  let current = 0;
  let prevTime: number | null = null;
  for (const dayKey of distinctDays) {
    const t = Date.parse(`${dayKey}T12:00:00Z`);
    current = prevTime != null && t - prevTime === 24 * 60 * 60 * 1000 ? current + 1 : 1;
    best = Math.max(best, current);
    prevTime = t;
  }
  stats.streak_best = best;

  return stats;
}

/** Aggregate every day-row + cross-table count + event counter into the
 *  catalog's stat shape. */
export async function computeStats(userId: string): Promise<Stats> {
  const dayRows = await db
    .select({
      parkId: userParkDay.parkId,
      day: userParkDay.day,
      distanceM: userParkDay.distanceM,
      presentSeconds: userParkDay.presentSeconds,
      queueSeconds: userParkDay.queueSeconds,
      rides: userParkDay.rides,
      ropeDrop: userParkDay.ropeDrop,
      nightOwl: userParkDay.nightOwl,
      rainy: userParkDay.rainy,
    })
    .from(userParkDay)
    .where(eq(userParkDay.userId, userId));

  const stats = aggregateDayRows(dayRows);

  // Cross-table counts (not day-rows, not event counters).
  const [attractionRow] = await db
    .select({ n: count() })
    .from(userAttraction)
    .where(eq(userAttraction.userId, userId));
  stats.attractions_unique = attractionRow?.n ?? 0;

  const [pinRow] = await db.select({ n: count() }).from(pinHave).where(eq(pinHave.userId, userId));
  stats.pins_owned = pinRow?.n ?? 0;

  // Track distance is a cross-table aggregate (Σ ride_count × published track
  // length), NOT a counter — so it becomes retroactively correct the moment
  // coaster_stats gets seeded, without any per-ride bookkeeping.
  const [trackRow] = await db
    .select({
      m: sql<number>`coalesce(sum(${userAttraction.rideCount} * ${coasterStats.trackLengthM}), 0)`,
    })
    .from(userAttraction)
    .innerJoin(coasterStats, eq(coasterStats.attractionId, userAttraction.attractionId))
    .where(eq(userAttraction.userId, userId));
  stats.track_distance_m = trackRow?.m ?? 0;

  // Client-reported event counters.
  const statRows = await db.select().from(userStat).where(eq(userStat.userId, userId));
  for (const row of statRows) {
    stats[row.stat as StatKey] = row.value;
  }

  return stats;
}

/** Re-evaluate the catalog against fresh stats and insert any newly-satisfied
 *  tiers. Never deletes — unlocks are sticky; admin revoke is the only removal
 *  path (see `adminRevoke` in the tRPC router). */
export async function evaluateAndUnlock(
  userId: string,
  precomputed?: Stats,
): Promise<{ newlyUnlocked: UnlockDTO[]; xp: number; level: LevelInfo }> {
  const stats = precomputed ?? (await computeStats(userId));
  const deserved = satisfiedTierIds(stats);

  let newlyUnlocked: UnlockDTO[] = [];
  if (deserved.length > 0) {
    newlyUnlocked = await db
      .insert(userAchievement)
      .values(deserved.map((id) => ({ userId, achievementId: id })))
      .onConflictDoNothing()
      .returning({ id: userAchievement.achievementId, unlockedAt: userAchievement.unlockedAt });
  }

  const unlockedRows = await db
    .select({ achievementId: userAchievement.achievementId })
    .from(userAchievement)
    .where(eq(userAchievement.userId, userId));
  const xp = xpForTierIds(unlockedRows.map((u) => u.achievementId));

  return { newlyUnlocked, xp, level: levelForXp(xp) };
}

/** Upsert a client-reported event counter, then re-evaluate. */
export async function bumpEventStat(userId: string, event: TrackEvent, by = 1) {
  const stat = TRACK_EVENTS[event];
  await db
    .insert(userStat)
    .values({ userId, stat, value: by })
    .onConflictDoUpdate({
      target: [userStat.userId, userStat.stat],
      set: { value: sql`${userStat.value} + ${by}`, updatedAt: new Date() },
    });
  return evaluateAndUnlock(userId);
}

// ---------------------------------------------------------------------------
// QA/dev only — adminProcedure-gated in the tRPC router (owner-only). These bypass
// real stat thresholds entirely so the unlock toast/haptic/level-up funnel can
// be exercised on demand instead of waiting on real park activity.
// ---------------------------------------------------------------------------

/** Unlock the next catalog tier (display order) the user doesn't have yet. */
export async function devUnlockNext(
  userId: string,
): Promise<{ newlyUnlocked: UnlockDTO[]; xp: number; level: LevelInfo }> {
  const unlockedRows = await db
    .select({ achievementId: userAchievement.achievementId })
    .from(userAchievement)
    .where(eq(userAchievement.userId, userId));
  const unlockedSet = new Set(unlockedRows.map((r) => r.achievementId));
  const next = ACHIEVEMENTS.flatMap((f) => f.tiers).find((t) => !unlockedSet.has(t.id));

  let newlyUnlocked: UnlockDTO[] = [];
  if (next) {
    newlyUnlocked = await db
      .insert(userAchievement)
      .values({ userId, achievementId: next.id })
      .onConflictDoNothing()
      .returning({ id: userAchievement.achievementId, unlockedAt: userAchievement.unlockedAt });
  }

  const allRows = await db
    .select({ achievementId: userAchievement.achievementId })
    .from(userAchievement)
    .where(eq(userAchievement.userId, userId));
  const xp = xpForTierIds(allRows.map((r) => r.achievementId));

  return { newlyUnlocked, xp, level: levelForXp(xp) };
}

/** Wipe the caller's own achievement state (rollups, counters, unlocks) so the
 *  dev unlock loop can be replayed from zero. */
export async function devResetMine(userId: string): Promise<void> {
  await db.delete(userParkDay).where(eq(userParkDay.userId, userId));
  await db.delete(userStat).where(eq(userStat.userId, userId));
  await db.delete(userGeoState).where(eq(userGeoState.userId, userId));
  await db.delete(userRideEvent).where(eq(userRideEvent.userId, userId));
  await db.delete(userAttraction).where(eq(userAttraction.userId, userId));
  await db.delete(userAchievement).where(eq(userAchievement.userId, userId));
}

/**
 * Stored `user_stat` keys written by the sensor ride path (`submitRideTrace`).
 * `track_distance_m` is intentionally absent — it's computed live in
 * `computeStats` from `user_attraction × coaster_stats`, never persisted, so
 * clearing `user_ride_event`/`user_attraction` already zeroes it.
 */
const SENSOR_STAT_KEYS = [
  "coaster_drops",
  "airtime_seconds",
  "max_g_best",
  "inversions_ridden",
  "vertical_m",
] as const;

/**
 * QA/dev only: wipe just the sensor-tracked ride data (per-ride events, the
 * dwell/sensor ride-count rows, and the sensor stat counters) so the native
 * coaster-detection loop can be re-tested from zero — without losing the
 * caller's GPS-accumulated park progress (park-days, distance, queues, streaks).
 * Achievement unlocks are left in place; re-earning them re-fires normally.
 */
export async function devResetRides(userId: string): Promise<void> {
  await db.delete(userRideEvent).where(eq(userRideEvent.userId, userId));
  await db.delete(userAttraction).where(eq(userAttraction.userId, userId));
  await db
    .delete(userStat)
    .where(and(eq(userStat.userId, userId), inArray(userStat.stat, [...SENSOR_STAT_KEYS])));
}
