/**
 * Levels & achievements — engine.
 *
 * Turns a location ping (or a client-reported app event) into: a
 * `user_park_day` rollup update, a queue-dwell state machine over
 * `user_geo_state`, and a re-evaluation of the shared catalog
 * (`src/lib/achievements.ts`) against the user's aggregated stats. Deliberately
 * independent of the Living Layer — no imports from `src/server/living/**`.
 */
import { and, count, desc, eq, gt, gte, inArray, isNotNull, ne, sql } from "drizzle-orm";

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
import { HEADLINERS } from "#/lib/headliners.ts";
import { Source } from "#/server/parks/codes.ts";
import {
  distanceMeters,
  distanceToBoundary,
  GEOFENCE_BUFFER_M,
  geofenceBounds,
  pointInPolygon,
  type LngLat,
} from "./geo.ts";

// Re-exported for the engine tests, which exercise the prefilter/park-point
// pipeline through this module.
export { geofenceBounds } from "./geo.ts";
import {
  advanceTransitState,
  aggregateDisneyDayStats,
  CLASSICS_1971_SET,
  countSetMatches,
  EPCOT_SLUG,
  MOUNTAIN_SET,
  WDW_PARK_SLUGS,
  zoneForPoint,
  type TransitState,
} from "./disney.ts";

const PING_MAX_ACCURACY_M = 150; // drop noisy fixes
const PING_MAX_GAP_S = 300; // deltas older than this don't accrue distance/queue
const WALK_SPEED_CAP_MS = 2.5; // m/s — clamps GPS jumps & vehicle travel
const QUEUE_ENTER_RADIUS_M = 40; // anchor to an attraction within this
const QUEUE_EXIT_RADIUS_M = 60; // hysteresis: keep anchor until beyond this
const QUEUE_MIN_DWELL_S = 480; // ≥8 min anchored ⇒ it was a queue ⇒ +1 ride
// Steps-per-second plausibility ceiling for a client-reported pedometer delta —
// a flat-out run is ~3/s; anything past this is a spoofed or corrupt counter.
// Deliberately NOT gap-bounded like presence/distance: the whole point of the
// pedometer is that a backgrounded stretch (no pings) still walked real steps,
// so a long-elapsed delta is legitimate as long as the rate is human.
const MAX_STEPS_PER_S = 4.5;
// Generous meters-per-step ceiling (tall stride at a brisk walk). When a ping
// carries pedometer data, GPS distance is credited at most steps × this — which
// zeroes phantom meters from GPS jitter while standing in a queue, and from
// sub-walking-speed vehicle travel (trams, boats, slow monorail segments) that
// the WALK_SPEED_CAP_MS clamp lets through.
const STRIDE_MAX_M = 1.3;
const ROPE_DROP_BEFORE = { h: 9, m: 30 }; // local
const NIGHT_OWL_AFTER_H = 22; // local
const CACHE_TTL_MS = 10 * 60 * 1000;

export interface UnlockDTO {
  id: string;
  unlockedAt: Date;
}

export interface IngestResult {
  /** True/false when the fix was usable; null when the ping was dropped
   *  (accuracy worse than PING_MAX_ACCURACY_M). A dropped ping says nothing
   *  about where the user is — the client must not treat it as a park exit
   *  (the ride-recorder disarm trigger keys off this distinction). */
  inPark: boolean | null;
  parkId?: number;
  newlyUnlocked: UnlockDTO[];
  xp?: number;
  level?: LevelInfo;
  today?: { distanceM: number; queueSeconds: number; rides: number; steps: number };
}

// ---------------------------------------------------------------------------
// In-module caches (park geo + per-park attraction coords). TTL'd, not
// invalidated — geo/attraction data changes on a monthly cron cadence, so a
// few minutes of staleness is a non-issue.
// ---------------------------------------------------------------------------

export interface CachedPark {
  id: number;
  slug: string;
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
      slug: parks.slug,
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
    .map((r) => ({ ...r, ...geofenceBounds(r, r.boundary ?? null), boundary: r.boundary ?? null }));
  parksCache = { at: Date.now(), data };
  return data;
}

interface CachedAttraction {
  id: number;
  lng: number;
  lat: number;
  /** ATTRACTION | SHOW — settle dispatch: shows bump `shows`, not rides. */
  entityType: string;
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
      entityType: attractions.entityType,
    })
    .from(attractions)
    .where(
      and(
        eq(attractions.parkId, parkId),
        // SHOW entities anchor dwells too (show-goer detection) — settle
        // dispatches on entityType so shows never count as rides.
        inArray(attractions.entityType, ["ATTRACTION", "SHOW"]),
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
    .map((r) => ({ id: r.id, lng: r.longitude, lat: r.latitude, entityType: r.entityType }));
  attractionsCache.set(parkId, { at: Date.now(), data });
  return data;
}

/**
 * Bounds prefilter (see geofenceBounds), then the authoritative test in two
 * tiers: strict polygon containment first, then the GEOFENCE_BUFFER_M grace
 * ring (with a park lacking a polygon gated by its padded bbox on that same
 * weaker tier). Containment must be its own pass: USF and Islands of
 * Adventure's polygons touch along the Hogwarts Express corridor, and in a
 * single pass whichever park lists first would claim the inside of its
 * neighbour via the buffer. Exported for tests.
 */
export function parkForPoint(
  p: LngLat,
  allParks: CachedPark[],
): { id: number; timezone: string } | null {
  const [lng, lat] = p;
  const inBounds = (park: CachedPark) =>
    lat >= park.latMin && lat <= park.latMax && lng >= park.lngMin && lng <= park.lngMax;
  for (const park of allParks) {
    if (inBounds(park) && park.boundary && pointInPolygon(p, park.boundary)) {
      return { id: park.id, timezone: park.timezone };
    }
  }
  for (const park of allParks) {
    if (!inBounds(park)) continue;
    if (park.boundary && distanceToBoundary(p, park.boundary) > GEOFENCE_BUFFER_M) continue;
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

/** One ping's pedometer report: the native session's cumulative step count and
 *  the session's start time (its identity). */
export interface StepReport {
  cum: number;
  sessionMs: number;
}

/** The stored pedometer cursor (user_geo_state) — last consumed cumulative,
 *  keyed by session. Both null until a native session first reports. */
export interface StepCursor {
  sessionMs: number | null;
  cum: number | null;
}

/**
 * Diff a ping's cumulative step report against the stored cursor. This is what
 * makes step credit idempotent: a retried ping re-sends the same cumulative,
 * which diffs to zero — the client keeps no baseline at all.
 *
 * - Same session: delta is the cumulative growth since the cursor. A shrinking
 *   cumulative (shouldn't happen within one session) resyncs downward with no
 *   credit.
 * - Newer session (start time advanced): the counter restarted from zero at
 *   arm, so the whole cumulative is new — credit it and move the cursor.
 * - Older session (a second device flapping against the same account): stale;
 *   no credit, cursor unchanged — the newest session wins rather than letting
 *   two pedometers on one account double-count the same human.
 *
 * Returns the delta plus the cursor to persist. Pure.
 */
export function stepDeltaFromCursor(
  stored: StepCursor,
  report: StepReport | null,
): { delta: number; cursor: StepCursor } {
  if (report == null) return { delta: 0, cursor: stored };
  if (stored.sessionMs != null && report.sessionMs < stored.sessionMs) {
    return { delta: 0, cursor: stored };
  }
  if (stored.sessionMs === report.sessionMs) {
    const prev = stored.cum ?? 0;
    const delta = report.cum >= prev ? report.cum - prev : 0;
    return { delta, cursor: { sessionMs: report.sessionMs, cum: report.cum } };
  }
  // New session — counter restarted at arm; the full cumulative is unconsumed.
  return { delta: report.cum, cursor: { sessionMs: report.sessionMs, cum: report.cum } };
}

/**
 * Steps credited by one ping's pedometer delta: non-negative, and rate-capped
 * against the elapsed time since the previous cursor. Unlike presenceDelta this
 * is NOT gap-bounded: a 2 h backgrounded stretch legitimately carries thousands
 * of steps, and the rate cap alone keeps a spoofed counter humanly plausible.
 * `elapsed` null (first ping ever) allows one interval's worth. Pure.
 *
 * The in-park scoping is best-effort, not by construction: arming tracks the
 * app-OBSERVED geofence state, so a session goes stale when the app closes
 * before park exit (the disarm pings never happen) and keeps counting overnight.
 * ingestPing bounds that leak by absorbing any delta whose window spans a
 * park-local day rollover — see stepsWindowSpansRollover.
 */
export function clampStepsDelta(
  stepsDelta: number | null | undefined,
  elapsed: number | null,
  maxPerS = MAX_STEPS_PER_S,
): number {
  if (stepsDelta == null || !Number.isFinite(stepsDelta) || stepsDelta <= 0) return 0;
  const windowS = elapsed != null && elapsed > 0 ? elapsed : 60;
  return Math.min(Math.round(stepsDelta), Math.round(windowS * maxPerS));
}

/**
 * GPS distance credited for one ping, given pedometer evidence. Without a
 * pedometer reading (web, no sensor, permission denied) GPS distance passes
 * through unchanged. With one, credit is capped at steps × STRIDE_MAX_M —
 * near-zero steps means the meters were a vehicle or queue-jitter drift, not
 * walking, so `distance_m` keeps meaning "meters walked". Never credits MORE
 * than GPS moved: the pedometer corrects false positives only. Pure.
 */
export function creditedDistance(
  gpsMovedM: number,
  clampedSteps: number | null,
  strideM = STRIDE_MAX_M,
): number {
  if (clampedSteps == null) return gpsMovedM;
  return Math.min(gpsMovedM, clampedSteps * strideM);
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

/**
 * Whether a pedometer delta's window (previous ping → this ping) crosses a
 * park-local day rollover. Such a delta is absorbed, never credited: the
 * dominant case is a stale-armed session — the app was closed before park exit,
 * the disarm pings never happened, and the native counter ran all night — so
 * the backlog is resort/overnight walking that must not land on the next
 * morning's park day. The cost is a few real minutes at midnight for a genuine
 * cross-midnight visit (the delta in flight when the day flips), which the iOS
 * reconciliation pass largely repairs from the OS buffer. Pure; exported for
 * tests.
 */
export function stepsWindowSpansRollover(
  prevAt: Date | null | undefined,
  day: string,
  timeZone: string,
): boolean {
  if (prevAt == null) return false;
  return localParts(prevAt, timeZone).day !== day;
}

/** Park-local calendar day + clock time, via Intl (en-CA gives YYYY-MM-DD).
 *  Exported for the activity router's local-day windowing. */
export function localParts(
  now: Date,
  timeZone: string,
): { day: string; hour: number; minute: number } {
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

// Mirrors DEDUPE_WINDOW_MS in rides.ts (which imports this module — keeping
// the constant local avoids an import cycle): a sensor event this close to the
// dwell window is the same physical ride.
const DWELL_EVENT_DEDUPE_MS = 5 * 60 * 1000;

/**
 * The earliest `user_ride_event.riddenAt` that counts as "this dwell's ride":
 * the dwell's start (settle instant minus accrued anchor seconds) minus the
 * dedupe slop. A sensor event at/after this floor means the plugin already
 * wrote the row for this physical ride (`'sensor+dwell'` — see
 * `creditDecision` in rides.ts), so the settle path must not write a second
 * one. Pure; exported for tests.
 */
export function dwellEventFloor(riddenAt: Date, anchorSeconds: number): Date {
  return new Date(riddenAt.getTime() - Math.round(anchorSeconds) * 1000 - DWELL_EVENT_DEDUPE_MS);
}

/** Settle a dwell into today's rollup — shared by the same-park exit case and
 *  the cross-park/left-park case (§ ingestPing steps 4 & 7). ATTRACTION dwells
 *  bump queue_seconds/rides, record the distinct attraction (powers
 *  `attractions_unique`), and log a per-ride `user_ride_event` (source
 *  'dwell') unless a sensor event already covers this ride; SHOW dwells bump
 *  only `shows` — sitting through a performance is not queueing, and shows
 *  must not pollute the ride stats. */
async function settleAnchorRow(
  userId: string,
  parkId: number,
  day: string,
  anchorSeconds: number,
  anchorAt: Date | null,
  attractionId: number,
  entityType: string,
): Promise<void> {
  if (anchorSeconds < QUEUE_MIN_DWELL_S) return;
  if (entityType === "SHOW") {
    await db
      .update(userParkDay)
      .set({ shows: sql`${userParkDay.shows} + 1` })
      .where(
        and(
          eq(userParkDay.userId, userId),
          eq(userParkDay.parkId, parkId),
          eq(userParkDay.day, day),
        ),
      );
    return;
  }
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

  // Per-ride fact row for the dwell (metrics-less). `riddenAt` is the last
  // confirmed anchored ping — when the dwell actually ended — consistent with
  // `settleDay` crediting that instant's local day. Skipped when a sensor
  // event already logged this ride during the dwell window.
  const riddenAt = anchorAt ?? new Date();
  const [sensorRow] = await db
    .select({ id: userRideEvent.id })
    .from(userRideEvent)
    .where(
      and(
        eq(userRideEvent.userId, userId),
        eq(userRideEvent.attractionId, attractionId),
        gte(userRideEvent.riddenAt, dwellEventFloor(riddenAt, anchorSeconds)),
      ),
    )
    .limit(1);
  if (!sensorRow) {
    await db
      .insert(userRideEvent)
      .values({ userId, attractionId, parkId, riddenAt, source: "dwell" });
  }
}

/** Entity type of a cached attraction id — ATTRACTION when unknown (cache
 *  rotation between anchor and settle; the pre-shows behavior). */
function anchorEntityType(list: CachedAttraction[], id: number): string {
  return list.find((a) => a.id === id)?.entityType ?? "ATTRACTION";
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
 *
 * `steps` is the client's raw pedometer report — the native session's
 * cumulative count plus session identity (native only; absent on web). The
 * server diffs it against the cursor persisted in user_geo_state
 * (stepDeltaFromCursor — idempotent under retries), rate-clamps the delta
 * (clampStepsDelta), and lets it cap the GPS distance credit
 * (creditedDistance).
 */
export async function ingestPing(
  userId: string,
  lng: number,
  lat: number,
  accuracyM: number,
  now: Date = new Date(),
  opts: { seededWeather?: boolean; steps?: StepReport | null } = {},
): Promise<IngestResult> {
  if (accuracyM > PING_MAX_ACCURACY_M) {
    return { inPark: null, newlyUnlocked: [] };
  }

  const point: LngLat = [lng, lat];
  const allParks = await getParks();
  const park = parkForPoint(point, allParks);

  const [state] = await db.select().from(userGeoState).where(eq(userGeoState.userId, userId));
  const elapsed = state?.at ? (now.getTime() - state.at.getTime()) / 1000 : null;

  // Consume the pedometer report against the stored cursor up front — BOTH the
  // in-park and out-of-park paths persist the advanced cursor, so out-of-park
  // steps are absorbed (never credited, never carried into the next park entry).
  const stepReport = opts.steps ?? null;
  const { delta: stepDeltaRaw, cursor: stepCursor } = stepDeltaFromCursor(
    { sessionMs: state?.stepSessionMs ?? null, cum: state?.stepsCum ?? null },
    stepReport,
  );

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
        state.at,
        state.anchorAttractionId,
        anchorEntityType(await getAttractions(oldPark.id), state.anchorAttractionId),
      );
    }
  }

  if (!park) {
    // Resort-transit machine (Disney wave 2): out-of-park pings walk the WDW
    // zone graph (TTC, monorail/Skyliner stations, the mid-lagoon ferry
    // waypoint). Steps reuse the same clamped-delta discipline as in-park
    // credit; the cursor above consumed the report either way, so absorbed
    // and credited pings stay equally idempotent.
    const zone = zoneForPoint(point);
    const prevTransit: TransitState = {
      zoneSlug: state?.zoneSlug ?? null,
      zoneAt: state?.zoneAt ?? null,
      zoneSteps: state?.zoneSteps ?? 0,
      transitKind: state?.transitKind ?? null,
      transitAt: state?.transitAt ?? null,
    };
    const { next, credits } = advanceTransitState(
      prevTransit,
      zone?.slug ?? null,
      now,
      clampStepsDelta(stepDeltaRaw, elapsed),
      stepReport != null,
    );
    const cleared = {
      parkId: null,
      lng,
      lat,
      at: now,
      anchorAttractionId: null,
      anchorSince: null,
      anchorSeconds: 0,
      stepSessionMs: stepCursor.sessionMs,
      stepsCum: stepCursor.cum,
      zoneSlug: next.zoneSlug,
      zoneAt: next.zoneAt,
      zoneSteps: next.zoneSteps,
      transitKind: next.transitKind,
      transitAt: next.transitAt,
    };
    await db
      .insert(userGeoState)
      .values({ userId, ...cleared })
      .onConflictDoUpdate({ target: userGeoState.userId, set: cleared });
    if (credits.length > 0) {
      for (const c of credits) await addStat(userId, c, 1);
      const { newlyUnlocked, xp, level } = await evaluateAndUnlock(userId);
      return { inPark: false, newlyUnlocked, xp, level };
    }
    return { inPark: false, newlyUnlocked: [] };
  }

  const { day, hour, minute } = localParts(now, park.timezone);
  const sameParkAsState = state?.parkId === park.id;
  const gpsMoved =
    sameParkAsState &&
    elapsed != null &&
    elapsed <= PING_MAX_GAP_S &&
    state?.lng != null &&
    state?.lat != null
      ? Math.min(distanceMeters([state.lng, state.lat], point), WALK_SPEED_CAP_MS * elapsed)
      : 0;
  // A delta spanning the local-day rollover is absorbed (cursor advances, no
  // credit) — see stepsWindowSpansRollover. For the distance cap it counts as
  // "no pedometer evidence" (null), not "zero steps": GPS still measured real
  // movement in this interval, and zero-clamping it would punish the genuine
  // cross-midnight visitor. (In the stale-overnight case gpsMoved is already 0
  // via the PING_MAX_GAP_S bound, so nothing leaks through this path either.)
  const rollover = stepsWindowSpansRollover(state?.at, day, park.timezone);
  const steps = rollover ? 0 : clampStepsDelta(stepDeltaRaw, elapsed);
  const moved = creditedDistance(gpsMoved, stepReport == null || rollover ? null : steps);
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
      steps,
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
        steps: sql`${userParkDay.steps} + ${steps}`,
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
      await settleAnchorRow(
        userId,
        park.id,
        day,
        priorAnchorSeconds,
        state?.at ?? null,
        priorAnchorId,
        anchorEntityType(attractionsForPark, priorAnchorId),
      );
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

  // A park visit ends any resort-transit journey: zone + dedupe state clears
  // so the next out-of-park leg starts fresh.
  const inParkGeoState = {
    parkId: park.id,
    lng,
    lat,
    at: now,
    anchorAttractionId,
    anchorSince,
    anchorSeconds,
    stepSessionMs: stepCursor.sessionMs,
    stepsCum: stepCursor.cum,
    zoneSlug: null,
    zoneAt: null,
    zoneSteps: 0,
    transitKind: null,
    transitAt: null,
  };
  await db
    .insert(userGeoState)
    .values({ userId, ...inParkGeoState })
    .onConflictDoUpdate({ target: userGeoState.userId, set: inParkGeoState });

  const [todayRow] = await db
    .select({
      distanceM: userParkDay.distanceM,
      queueSeconds: userParkDay.queueSeconds,
      rides: userParkDay.rides,
      steps: userParkDay.steps,
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
    today: todayRow ?? { distanceM: moved, queueSeconds: 0, rides: 0, steps },
  };
}

/** One `user_park_day` row, narrowed to the fields the stat math needs. */
export interface DayStatRow {
  parkId: number;
  day: string; // park-local YYYY-MM-DD
  distanceM: number;
  steps: number;
  presentSeconds: number;
  queueSeconds: number;
  rides: number;
  shows: number;
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
    steps: dayRows.reduce((s, r) => s + r.steps, 0),
    queue_seconds: dayRows.reduce((s, r) => s + r.queueSeconds, 0),
    rides: dayRows.reduce((s, r) => s + r.rides, 0),
    shows_watched: dayRows.reduce((s, r) => s + r.shows, 0),
    rope_drops: dayRows.filter((r) => r.ropeDrop).length,
    night_owls: dayRows.filter((r) => r.nightOwl).length,
    rain_days: dayRows.filter((r) => r.rainy).length,
    best_day_distance_m: dayRows.reduce((m, r) => Math.max(m, r.distanceM), 0),
    best_day_steps: dayRows.reduce((m, r) => Math.max(m, r.steps), 0),
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

/**
 * Per-headliner ride counts from (park slug, attraction slug, rideCount) rows —
 * the cross-table stats behind the "Everest ×10" families. Same slug identity
 * as `countSetMatches`; an unmatched slug (rename drift) yields 0, and
 * duplicate catalog rows for one slug fold via max, never sum. Pure; exported
 * for tests.
 */
export function headlinerCounts(
  ridden: ReadonlyArray<{ park: string; slug: string; rideCount: number }>,
): Partial<Stats> {
  const bySlugPair = new Map<string, number>();
  for (const r of ridden) {
    const k = `${r.park}/${r.slug}`;
    bySlugPair.set(k, Math.max(bySlugPair.get(k) ?? 0, r.rideCount));
  }
  const out: Partial<Stats> = {};
  for (const h of HEADLINERS) {
    out[h.key] = bySlugPair.get(`${h.parkSlug}/${h.attractionSlug}`) ?? 0;
  }
  return out;
}

/** Aggregate every day-row + cross-table count + event counter into the
 *  catalog's stat shape. */
export async function computeStats(userId: string): Promise<Stats> {
  const dayRows = await db
    .select({
      parkId: userParkDay.parkId,
      day: userParkDay.day,
      distanceM: userParkDay.distanceM,
      steps: userParkDay.steps,
      presentSeconds: userParkDay.presentSeconds,
      queueSeconds: userParkDay.queueSeconds,
      rides: userParkDay.rides,
      shows: userParkDay.shows,
      ropeDrop: userParkDay.ropeDrop,
      nightOwl: userParkDay.nightOwl,
      rainy: userParkDay.rainy,
    })
    .from(userParkDay)
    .where(eq(userParkDay.userId, userId));

  const stats = aggregateDayRows(dayRows);

  // Disney-scoped day stats. Park identity resolves by slug at runtime (ids
  // differ per environment); a deployment without the WDW catalog just folds
  // to zeros. Reuses the geofence park cache — the four gates all carry geo.
  const allParks = await getParks();
  const wdwIds = new Set(
    allParks.filter((p) => (WDW_PARK_SLUGS as readonly string[]).includes(p.slug)).map((p) => p.id),
  );
  const epcotId = allParks.find((p) => p.slug === EPCOT_SLUG)?.id ?? null;
  Object.assign(stats, aggregateDisneyDayStats(dayRows, { wdwIds, epcotId }));

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

  // Curated-set completion + biggest single-attraction habit — cross-table
  // like track distance, so both are retroactively correct for rides logged
  // before these stats existed. Identity is (park slug, attraction slug); an
  // unmatched slug (Disney rename) fails soft and simply never counts.
  const riddenPairs = await db
    .select({
      park: parks.slug,
      slug: attractions.slug,
      rideCount: userAttraction.rideCount,
    })
    .from(userAttraction)
    .innerJoin(attractions, eq(attractions.id, userAttraction.attractionId))
    .innerJoin(parks, eq(parks.id, attractions.parkId))
    .where(eq(userAttraction.userId, userId));
  stats.mk_mountains_ridden = countSetMatches(riddenPairs, MOUNTAIN_SET);
  stats.mk_classics_ridden = countSetMatches(riddenPairs, CLASSICS_1971_SET);

  // Per-attraction headliner counts, same (park slug, attraction slug)
  // identity as the curated sets above. Duplicate catalog rows for one slug
  // (ghost-attraction era) fold via max, never sum.
  Object.assign(stats, headlinerCounts(riddenPairs));

  const [maxRideRow] = await db
    .select({ m: sql<number>`coalesce(max(${userAttraction.rideCount}), 0)` })
    .from(userAttraction)
    .where(eq(userAttraction.userId, userId));
  stats.same_ride_max = maxRideRow?.m ?? 0;

  // Client-reported event counters (plus the server-written transit counters —
  // ttc_visits, monorail_rides, … live in user_stat like the sensor stats).
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

/**
 * Reconciliation (iOS): repair a park-day's step total from the OS pedometer's
 * ~7-day historical buffer. The client queries CMPedometer over the day's
 * firstSeen→lastSeen window and reports the total; steps the live session lost
 * (process death, missed pings) come back here. Max-repair only — the
 * accumulated live count never goes down — and capped by the window's duration
 * at the same human rate bound as live deltas, so a spoofed report can't
 * exceed plausibility. Returns null when there's nothing to repair.
 *
 * Live pings race this benignly: a delta that lands between the client's
 * window fetch and this UPDATE covers steps *after* the window's end, and the
 * overwrite drops it — a bounded undercount, not a double count, and the next
 * app-session's reconcile pass (with a later lastSeen) recovers it.
 */
export async function reconcileDaySteps(
  userId: string,
  parkId: number,
  day: string,
  reportedSteps: number,
): Promise<{ newlyUnlocked: UnlockDTO[]; xp: number; level: LevelInfo; steps: number } | null> {
  const [row] = await db
    .select({
      steps: userParkDay.steps,
      firstSeenAt: userParkDay.firstSeenAt,
      lastSeenAt: userParkDay.lastSeenAt,
    })
    .from(userParkDay)
    .where(
      and(eq(userParkDay.userId, userId), eq(userParkDay.parkId, parkId), eq(userParkDay.day, day)),
    );
  if (!row) return null;
  const windowS = Math.max(0, (row.lastSeenAt.getTime() - row.firstSeenAt.getTime()) / 1000);
  const capped = Math.min(Math.round(reportedSteps), Math.round(windowS * MAX_STEPS_PER_S));
  if (capped <= row.steps) return null;
  await db
    .update(userParkDay)
    .set({ steps: capped })
    .where(
      and(eq(userParkDay.userId, userId), eq(userParkDay.parkId, parkId), eq(userParkDay.day, day)),
    );
  const result = await evaluateAndUnlock(userId);
  return { ...result, steps: capped };
}

/** Additive `user_stat` upsert — server-written counters (sensor metrics from
 *  the ride-trace path, transit credits from the zone machine). */
export async function addStat(userId: string, stat: StatKey, by: number): Promise<void> {
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
export async function raiseStat(userId: string, stat: StatKey, to: number): Promise<void> {
  await db
    .insert(userStat)
    .values({ userId, stat, value: to })
    .onConflictDoUpdate({
      target: [userStat.userId, userStat.stat],
      set: { value: sql`GREATEST(${userStat.value}, ${to})`, updatedAt: new Date() },
    });
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
