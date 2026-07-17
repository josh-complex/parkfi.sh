/**
 * Time-warp scenario runner (device-test-tooling Layer B).
 *
 * Replays a scripted sequence of location pings through the *real* `ingestPing`
 * pipeline with an injected clock, so a six-hour park day — rope drop, queue
 * dwells, night-owl close-out, a 7-day streak, the cross-midnight regression —
 * executes in well under a second and produces exactly the rows a real day
 * produces (dwell settles, park-day flags, presence deltas, `user_attraction`
 * rows, streak-able day keys). Nothing here is reachable from the public `ping`
 * procedure: the injectable clock lives only behind `adminSimulateScenario`.
 *
 * The pure builders (`buildScenario`, the zoned-time helpers) are exported for
 * unit testing without a DB; `runScenario` and `loadSimPark` touch the DB.
 */
import { and, eq, isNotNull } from "drizzle-orm";

import { db } from "#/db/index.ts";
import { attractions, parks, weatherObs } from "#/db/schema.ts";
import type { LevelInfo } from "#/lib/achievements.ts";
import { Source } from "#/server/parks/codes.ts";
import { evaluateAndUnlock, ingestPing, type UnlockDTO } from "./engine.ts";
import type { LngLat } from "./geo.ts";

// Well under PING_MAX_ACCURACY_M (150) so scripted pings are never dropped as noisy.
const SIM_ACCURACY_M = 10;
// Ping cadence inside a dwell. Under PING_MAX_GAP_S (300) so presence/queue accrue.
const DWELL_STEP_S = 60;
// A dwell long enough to clear QUEUE_MIN_DWELL_S (480 s) with margin ⇒ +1 ride.
const DWELL_MINUTES = 10;
// Latitude nudge (~166 m) used to "walk out" of a dwell so the queue settles
// regardless of park geometry, and to leave the park entirely at scenario end.
const TRANSIT_NUDGE_DEG = 0.0015;
const EXIT_NUDGE_DEG = 0.02; // ~2.2 km — unambiguously outside any park

// ---------------------------------------------------------------------------
// Zoned-time helpers (pure). Convert a park-local wall clock to a UTC instant
// without a tz library, using Intl to read the zone's offset at an instant.
// ---------------------------------------------------------------------------

/** The zone's offset (ms) at `instant`: (wall-clock as-if-UTC) − actual UTC. */
export function tzOffsetMs(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instant);
  const m: Record<string, number> = {};
  for (const p of parts) if (p.type !== "literal") m[p.type] = Number(p.value);
  const asUTC = Date.UTC(m.year, m.month - 1, m.day, m.hour % 24, m.minute, m.second);
  return asUTC - instant.getTime();
}

/** UTC instant for a park-local wall clock (two passes handle DST edges). */
export function zonedWallToUtc(
  y: number,
  mo: number,
  d: number,
  h: number,
  mi: number,
  timeZone: string,
): Date {
  const wallUtc = Date.UTC(y, mo - 1, d, h, mi);
  let guess = wallUtc;
  for (let i = 0; i < 2; i++) guess = wallUtc - tzOffsetMs(new Date(guess), timeZone);
  return new Date(guess);
}

/** Park-local civil date (UTC-midnight marker) + weekday for `instant`. */
function localCivilDate(instant: Date, timeZone: string): Date {
  const off = tzOffsetMs(instant, timeZone);
  const local = new Date(instant.getTime() + off);
  return new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()));
}

function addDays(civil: Date, n: number): Date {
  return new Date(civil.getTime() + n * 86_400_000);
}

// ---------------------------------------------------------------------------
// Targets — a park + a spread of anchorable attractions.
// ---------------------------------------------------------------------------

export interface SimAttraction {
  id: number;
  name: string;
  lng: number;
  lat: number;
}

export interface SimPark {
  id: number;
  slug: string;
  name: string;
  timezone: string;
  /** Geocoded park centroid — the client "entrance" teleport target. */
  entrance: LngLat | null;
  /** Anchorable attractions (active, geocoded, non-ghost) for queue dwells. */
  attractions: SimAttraction[];
}

/** Load a park + up to `limit` anchorable attractions for scenario/sim use. */
export async function loadSimPark(parkId: number, limit = 8): Promise<SimPark | null> {
  const [park] = await db
    .select({
      id: parks.id,
      slug: parks.slug,
      name: parks.name,
      timezone: parks.timezone,
      lat: parks.latitude,
      lng: parks.longitude,
    })
    .from(parks)
    .where(eq(parks.id, parkId));
  if (!park) return null;

  const rows = await db
    .select({
      id: attractions.id,
      name: attractions.name,
      lat: attractions.latitude,
      lng: attractions.longitude,
    })
    .from(attractions)
    .where(
      and(
        eq(attractions.parkId, parkId),
        eq(attractions.entityType, "ATTRACTION"),
        eq(attractions.active, true),
        isNotNull(attractions.category), // drop un-enriched ghost duplicates
        isNotNull(attractions.latitude),
        isNotNull(attractions.longitude),
      ),
    )
    .orderBy(attractions.name)
    .limit(limit);

  return {
    id: park.id,
    slug: park.slug,
    name: park.name,
    timezone: park.timezone,
    entrance: park.lat != null && park.lng != null ? [park.lng, park.lat] : null,
    attractions: rows
      .filter(
        (r): r is { id: number; name: string; lat: number; lng: number } =>
          r.lat != null && r.lng != null,
      )
      .map((r) => ({ id: r.id, name: r.name, lng: r.lng, lat: r.lat })),
  };
}

// ---------------------------------------------------------------------------
// Script building (pure).
// ---------------------------------------------------------------------------

export interface ScriptPing {
  lng: number;
  lat: number;
  accuracy: number;
  at: Date;
}

export const SCENARIO_PRESETS = [
  "fullParkDay",
  "parkHopDay",
  "weekendPair",
  "streak",
  "crossMidnightDwell",
] as const;
export type ScenarioPreset = (typeof SCENARIO_PRESETS)[number];

interface BuildCtx {
  park: SimPark;
  secondPark?: SimPark;
  /** Streak length for `streak`; defaults to 7. */
  days?: number;
  /** Reference instant scenarios anchor to (defaults to real now). */
  reference?: Date;
}

/** Emit a dwell: 30-min-ish of 1-Hz-ish pings at an attraction so the queue
 *  machine anchors and settles a ride, plus a "walk out" transit ping. */
function dwell(out: ScriptPing[], park: SimPark, aIdx: number, start: Date, minutes: number): void {
  const a = park.attractions[aIdx % park.attractions.length];
  const steps = Math.ceil((minutes * 60) / DWELL_STEP_S);
  for (let i = 0; i <= steps; i++) {
    out.push({
      lng: a.lng,
      lat: a.lat,
      accuracy: SIM_ACCURACY_M,
      at: new Date(start.getTime() + i * DWELL_STEP_S * 1000),
    });
  }
  // Walk ~166 m off the attraction so the dwell settles (or leaves the park).
  out.push({
    lng: a.lng,
    lat: a.lat + TRANSIT_NUDGE_DEG,
    accuracy: SIM_ACCURACY_M,
    at: new Date(start.getTime() + (minutes * 60 + DWELL_STEP_S) * 1000),
  });
}

/** A single in-park ping (used to stamp a time-of-day flag like night owl). */
function stamp(out: ScriptPing[], park: SimPark, aIdx: number, at: Date): void {
  const a = park.attractions[aIdx % park.attractions.length];
  out.push({ lng: a.lng, lat: a.lat, accuracy: SIM_ACCURACY_M, at });
}

/** Wall-clock instant for hour:min on a given park-local civil date. */
function at(park: SimPark, civil: Date, h: number, mi: number): Date {
  return zonedWallToUtc(
    civil.getUTCFullYear(),
    civil.getUTCMonth() + 1,
    civil.getUTCDate(),
    h,
    mi,
    park.timezone,
  );
}

/**
 * Turn a preset into a concrete ping script. Throws for structurally impossible
 * requests (no attractions to anchor to, park-hop without a second park).
 */
export function buildScenario(preset: ScenarioPreset, ctx: BuildCtx): ScriptPing[] {
  const { park } = ctx;
  if (park.attractions.length === 0) {
    throw new Error(`${park.name} has no geocoded attractions to anchor a dwell.`);
  }
  const ref = ctx.reference ?? new Date();
  const today = localCivilDate(ref, park.timezone);
  const out: ScriptPing[] = [];

  switch (preset) {
    case "fullParkDay": {
      // Rope drop → three queued rides → night-owl close-out (⇒ full day too).
      dwell(out, park, 0, at(park, today, 9, 0), DWELL_MINUTES);
      dwell(out, park, 1, at(park, today, 11, 30), DWELL_MINUTES);
      dwell(out, park, 2, at(park, today, 14, 0), DWELL_MINUTES);
      stamp(out, park, 0, at(park, today, 22, 15));
      break;
    }
    case "parkHopDay": {
      const b = ctx.secondPark;
      if (!b) throw new Error("Park hop needs a second park with attractions.");
      if (b.attractions.length === 0) {
        throw new Error(`${b.name} has no geocoded attractions to anchor a dwell.`);
      }
      dwell(out, park, 0, at(park, today, 9, 30), DWELL_MINUTES);
      // Same park-local day, afternoon, in the second park.
      const bToday = localCivilDate(ref, b.timezone);
      dwell(out, b, 0, at(b, bToday, 15, 0), DWELL_MINUTES);
      break;
    }
    case "weekendPair": {
      // Most recent Saturday on/before today, then the following Sunday.
      const dow = today.getUTCDay(); // 0=Sun..6=Sat
      const sat = addDays(today, dow === 6 ? 0 : -(dow + 1));
      const sun = addDays(sat, 1);
      dwell(out, park, 0, at(park, sat, 10, 0), DWELL_MINUTES);
      dwell(out, park, 1, at(park, sun, 10, 0), DWELL_MINUTES);
      break;
    }
    case "streak": {
      const n = Math.max(2, Math.min(30, ctx.days ?? 7));
      // n consecutive local days ending today, one queued ride each.
      for (let i = n - 1; i >= 0; i--) {
        dwell(out, park, i, at(park, addDays(today, -i), 12, 0), DWELL_MINUTES);
      }
      break;
    }
    case "crossMidnightDwell": {
      // §0 regression: a dwell that begins before and settles after the local
      // day rollover. Ends by leaving the park (far ping) to run the left-park
      // anchor-settle path.
      dwell(out, park, 0, at(park, today, 23, 52), 16);
      break;
    }
  }

  // Always end outside every park so any still-open anchor settles cleanly.
  const last = out.at(-1);
  if (last) {
    out.push({
      lng: last.lng,
      lat: last.lat + EXIT_NUDGE_DEG,
      accuracy: SIM_ACCURACY_M,
      at: new Date(last.at.getTime() + 60_000),
    });
  }
  // Replay in chronological order (park-hop / streak build out of order).
  out.sort((x, y) => x.at.getTime() - y.at.getTime());
  return out;
}

// ---------------------------------------------------------------------------
// Runner (DB).
// ---------------------------------------------------------------------------

export interface ScenarioResult {
  pings: number;
  newlyUnlocked: UnlockDTO[];
  xp: number;
  level: LevelInfo;
}

/**
 * Replay a script through the real `ingestPing` with the injected clock,
 * accumulating every newly-unlocked tier across the run (deduped) so the caller
 * can fire the whole batch through the toast/haptic funnel in one session.
 */
export async function runScenario(userId: string, script: ScriptPing[]): Promise<ScenarioResult> {
  const unlocked = new Map<string, UnlockDTO>();
  for (const p of script) {
    const r = await ingestPing(userId, p.lng, p.lat, p.accuracy, p.at);
    for (const u of r.newlyUnlocked) unlocked.set(u.id, u);
  }
  // The final evaluation also sweeps up anything credited by a path that skips
  // evaluation — e.g. a ride settled by the script's trailing park-exit ping —
  // so merge its unlocks too, or they'd only surface via the pendingUnlocks
  // replay on next app open instead of the live toast funnel.
  const final = await evaluateAndUnlock(userId);
  for (const u of final.newlyUnlocked) unlocked.set(u.id, u);
  return {
    pings: script.length,
    newlyUnlocked: [...unlocked.values()],
    xp: final.xp,
    level: final.level,
  };
}

/**
 * Insert a synthetic "it's raining right now" observation for a park so
 * `isRainyNow` flips on the next ping. Stamped at `now`, it self-expires via the
 * engine's 2 h window — no cleanup needed. Uses the MANUAL_SEED source and an
 * ACTUAL kind so it never collides with the OpenWeather cron's rows.
 */
export async function setSyntheticWeather(parkId: number, now = new Date()): Promise<void> {
  await db
    .insert(weatherObs)
    .values({
      parkId,
      kind: "ACTUAL",
      observedAt: now,
      precipMm: 2.5,
      condition: "Rain",
      source: Source.MANUAL_SEED,
    })
    .onConflictDoUpdate({
      target: [weatherObs.parkId, weatherObs.kind, weatherObs.observedAt],
      set: { precipMm: 2.5, condition: "Rain", source: Source.MANUAL_SEED },
    });
}
