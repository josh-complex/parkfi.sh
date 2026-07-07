/**
 * Levels & achievements — engine.
 *
 * Turns a location ping (or a client-reported app event) into: a
 * `user_park_day` rollup update, a queue-dwell state machine over
 * `user_geo_state`, and a re-evaluation of the shared catalog
 * (`src/lib/achievements.ts`) against the user's aggregated stats. Deliberately
 * independent of the Living Layer — no imports from `src/server/living/**`.
 */
import { and, desc, eq, gt, isNotNull, sql } from "drizzle-orm";

import { db } from "#/db/index.ts";
import {
  attractions,
  parks,
  userAchievement,
  userGeoState,
  userParkDay,
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

/** Latest weather_obs for the park within the last 2h — FORECAST or ACTUAL, latest wins. */
async function isRainyNow(parkId: number): Promise<boolean> {
  const [row] = await db
    .select({ precipMm: weatherObs.precipMm, condition: weatherObs.condition })
    .from(weatherObs)
    .where(
      and(
        eq(weatherObs.parkId, parkId),
        gt(weatherObs.observedAt, sql`now() - interval '2 hours'`),
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
 *  case and the cross-park/left-park case (§ ingestPing steps 4 & 7). */
async function settleAnchorRow(
  userId: string,
  parkId: number,
  day: string,
  anchorSeconds: number,
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
}

/**
 * The core: fold one location ping into the user's park-day rollup, run the
 * queue-dwell state machine, and re-evaluate achievements. Server time only —
 * never trusts a client timestamp.
 */
export async function ingestPing(
  userId: string,
  lng: number,
  lat: number,
  accuracyM: number,
): Promise<IngestResult> {
  if (accuracyM > PING_MAX_ACCURACY_M) {
    return { inPark: false, newlyUnlocked: [] };
  }

  const now = new Date();
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
      const { day: oldDay } = localParts(now, oldPark.timezone);
      await settleAnchorRow(userId, oldPark.id, oldDay, state.anchorSeconds);
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
  const ropeDrop =
    hour < ROPE_DROP_BEFORE.h || (hour === ROPE_DROP_BEFORE.h && minute < ROPE_DROP_BEFORE.m);
  const nightOwl = hour >= NIGHT_OWL_AFTER_H;
  const rainy = await isRainyNow(park.id);

  await db
    .insert(userParkDay)
    .values({
      userId,
      parkId: park.id,
      day,
      pings: 1,
      distanceM: moved,
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
    if (priorAnchorId != null) await settleAnchorRow(userId, park.id, day, priorAnchorSeconds);
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

/** Aggregate every geo day-row + event counter into the catalog's stat shape. */
export async function computeStats(userId: string): Promise<Stats> {
  const dayRows = await db
    .select({
      parkId: userParkDay.parkId,
      day: userParkDay.day,
      distanceM: userParkDay.distanceM,
      queueSeconds: userParkDay.queueSeconds,
      rides: userParkDay.rides,
      ropeDrop: userParkDay.ropeDrop,
      nightOwl: userParkDay.nightOwl,
      rainy: userParkDay.rainy,
      firstSeenAt: userParkDay.firstSeenAt,
      lastSeenAt: userParkDay.lastSeenAt,
    })
    .from(userParkDay)
    .where(eq(userParkDay.userId, userId));

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
    park_seconds: dayRows.reduce(
      (s, r) => s + (r.lastSeenAt.getTime() - r.firstSeenAt.getTime()) / 1000,
      0,
    ),
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
): Promise<{ newlyUnlocked: UnlockDTO[]; xp: number; level: LevelInfo }> {
  const stats = await computeStats(userId);
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
// QA/dev only — see ACHIEVEMENTS_DEV gate in the tRPC router. These bypass
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
  await db.delete(userAchievement).where(eq(userAchievement.userId, userId));
}
