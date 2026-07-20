/**
 * Debug-panel park-day spoofer (owner-only; see the `adminSpoof*` procedures).
 *
 * Writes `user_park_day` / `user_attraction` / `user_ride_event` rows DIRECTLY
 * — no ping replay — so a design tester can summon any recap state on demand:
 * a chosen time-of-day phase (via the day's last-seen hour), hop chains,
 * flags, headliner coins, and freshly "leveled up today" badges. Purely a test
 * aid; every write lands on the caller's own account and is undone by the
 * existing `devReset`.
 */
import { and, eq, inArray, sql } from "drizzle-orm";

import { db } from "#/db/index.ts";
import {
  attractions,
  parks,
  userAchievement,
  userAttraction,
  userParkDay,
  userRideEvent,
} from "#/db/schema.ts";
import type { RideMetrics } from "#/lib/ride-metrics.ts";
import { HEADLINERS } from "#/lib/headliners.ts";
import { evaluateAndUnlock } from "./engine.ts";
import { zonedWallToUtc } from "./scenarios.ts";

/** Preset lifetime ride counts for the headliner coins (varied so the strip +
 *  "+N all" overflow both render). Keyed by HEADLINERS[].key. */
const HEADLINER_SEED: Record<string, number> = {
  hl_everest: 12,
  hl_rise: 8,
  hl_space_mountain: 6,
  hl_tron: 5,
  hl_veloci: 3,
  hl_passage: 4,
  hl_guardians: 2,
  hl_slinky: 2,
};

export interface SpoofDayOpts {
  parkId: number;
  secondParkId?: number | null;
  /** 0 = today (phase then follows the live clock), 1 = yesterday, … */
  dayOffset: number;
  /** Park-local hour the day "ends" at — forces the phase for a past day. */
  phaseHour: number;
  steps: number;
  distanceM: number;
  queueSeconds: number;
  rides: number;
  ropeDrop: boolean;
  nightOwl: boolean;
  rainy: boolean;
  /** Seed the lifetime headliner ride counts (idempotent — sets, not adds). */
  seedHeadliners: boolean;
  /** Seed a handful of ride events on this day for the timeline. */
  seedTimeline: boolean;
}

/** YYYY-MM-DD for an instant in a timezone (en-CA renders ISO order). */
function localDay(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(instant);
}

async function seedHeadlinerAttractions(userId: string, at: Date): Promise<void> {
  const pairs = HEADLINERS.filter((h) => HEADLINER_SEED[h.key] != null);
  const rows = await db
    .select({
      id: attractions.id,
      parkId: attractions.parkId,
      slug: attractions.slug,
      park: parks.slug,
    })
    .from(attractions)
    .innerJoin(parks, eq(parks.id, attractions.parkId))
    .where(
      inArray(
        sql`(${parks.slug}, ${attractions.slug})`,
        pairs.map((h) => sql`(${h.parkSlug}, ${h.attractionSlug})`),
      ),
    );
  const bySlug = new Map(rows.map((r) => [`${r.park}/${r.slug}`, r]));
  for (const h of pairs) {
    const row = bySlug.get(`${h.parkSlug}/${h.attractionSlug}`);
    if (!row) continue;
    const count = HEADLINER_SEED[h.key];
    await db
      .insert(userAttraction)
      .values({
        userId,
        attractionId: row.id,
        parkId: row.parkId,
        rideCount: count,
        firstRiddenAt: at,
        lastRiddenAt: at,
      })
      .onConflictDoUpdate({
        target: [userAttraction.userId, userAttraction.attractionId],
        set: { rideCount: count, lastRiddenAt: at },
      });
  }
}

function fakeMetrics(startedAt: Date): RideMetrics {
  return {
    startedAt: startedAt.toISOString(),
    endedAt: new Date(startedAt.getTime() + 120_000).toISOString(),
    durationS: 120,
    dropCount: 3,
    airtimeS: 6.4,
    maxG: 4.1,
    inversions: 2,
    verticalM: 180,
    maxDropM: 40,
    estTopSpeedKmh: 96,
    baroAvailable: true,
    gyroAvailable: true,
    confidence: 0.9,
  };
}

async function seedTimelineEvents(
  userId: string,
  parkId: number,
  day: string,
  timeZone: string,
): Promise<void> {
  const [y, m, d] = day.split("-").map(Number);
  const rows = await db
    .select({ id: attractions.id, name: attractions.name })
    .from(attractions)
    .where(
      and(
        eq(attractions.parkId, parkId),
        eq(attractions.active, true),
        eq(attractions.entityType, "ATTRACTION"),
      ),
    )
    .limit(5);
  if (rows.length === 0) return;
  const hours = [10, 12, 14, 16, 19];
  await db.insert(userRideEvent).values(
    rows.map((r, i) => {
      const riddenAt = zonedWallToUtc(y, m, d, hours[i % hours.length], 15, timeZone);
      const sensor = i === 0; // one sensor row so the recap line renders
      return {
        userId,
        attractionId: r.id,
        parkId,
        riddenAt,
        source: sensor ? "sensor" : "dwell",
        metrics: sensor ? fakeMetrics(riddenAt) : null,
      };
    }),
  );
}

/**
 * Write one spoofed park-day (optionally a two-park hop), seed the requested
 * lifetime/timeline extras, then re-evaluate unlocks and RE-STAMP whatever this
 * call newly unlocked onto the day — so its "Badges leveled up today" renders
 * even though the day is in the past. Returns the day + how many badges it owns.
 */
export async function spoofActivityDay(
  userId: string,
  opts: SpoofDayOpts,
): Promise<{ day: string; newlyUnlocked: number }> {
  const [park] = await db
    .select({ id: parks.id, slug: parks.slug, timezone: parks.timezone })
    .from(parks)
    .where(eq(parks.id, opts.parkId));
  if (!park) throw new Error("Park not found");
  const second = opts.secondParkId
    ? (
        await db
          .select({ id: parks.id, timezone: parks.timezone })
          .from(parks)
          .where(eq(parks.id, opts.secondParkId))
      )[0]
    : null;

  const ref = new Date(Date.now() - opts.dayOffset * 24 * 60 * 60 * 1000);
  const day = localDay(ref, park.timezone);
  const [y, m, d] = day.split("-").map(Number);
  // Open at most an hour before the phase hour (so an early "dawn" close still
  // reads as dawn — a 7 AM end can't open at 10 AM), floored at 5 AM.
  const openHour = Math.max(5, Math.min(opts.ropeDrop ? 8 : 10, opts.phaseHour - 1));
  const firstSeen = zonedWallToUtc(y, m, d, openHour, 0, park.timezone);
  const closeHour = Math.min(23, Math.max(openHour + 1, opts.phaseHour));
  const lastSeen = zonedWallToUtc(y, m, d, closeHour, 30, park.timezone);

  // Hop: split the day's numbers across the two parks; the second park carries
  // the later firstSeen (so the recap's arrival-ordered chain reads A → B) and
  // the phase-defining lastSeen.
  const split = second ? 0.6 : 1;
  const midday = zonedWallToUtc(
    y,
    m,
    d,
    Math.min(closeHour - 1, Math.max(openHour + 1, 14)),
    0,
    park.timezone,
  );

  const writeDay = async (
    pid: number,
    frac: number,
    fSeen: Date,
    lSeen: Date,
    flags: { ropeDrop: boolean; nightOwl: boolean; rainy: boolean },
  ) => {
    const row = {
      userId,
      parkId: pid,
      day,
      firstSeenAt: fSeen,
      lastSeenAt: lSeen,
      steps: Math.round(opts.steps * frac),
      distanceM: opts.distanceM * frac,
      presentSeconds: Math.round((lSeen.getTime() - fSeen.getTime()) / 1000),
      queueSeconds: Math.round(opts.queueSeconds * frac),
      rides: Math.round(opts.rides * frac),
      shows: 0,
      ...flags,
    };
    await db
      .insert(userParkDay)
      .values(row)
      .onConflictDoUpdate({
        target: [userParkDay.userId, userParkDay.parkId, userParkDay.day],
        set: row,
      });
  };

  await writeDay(park.id, split, firstSeen, second ? midday : lastSeen, {
    ropeDrop: opts.ropeDrop,
    nightOwl: second ? false : opts.nightOwl,
    rainy: opts.rainy,
  });
  if (second) {
    await writeDay(second.id, 1 - split, midday, lastSeen, {
      ropeDrop: false,
      nightOwl: opts.nightOwl,
      rainy: opts.rainy,
    });
  }

  if (opts.seedHeadliners) await seedHeadlinerAttractions(userId, lastSeen);
  if (opts.seedTimeline) await seedTimelineEvents(userId, park.id, day, park.timezone);

  const { newlyUnlocked } = await evaluateAndUnlock(userId);
  if (newlyUnlocked.length > 0) {
    await db
      .update(userAchievement)
      .set({ unlockedAt: lastSeen })
      .where(
        and(
          eq(userAchievement.userId, userId),
          inArray(
            userAchievement.achievementId,
            newlyUnlocked.map((u) => u.id),
          ),
        ),
      );
  }
  return { day, newlyUnlocked: newlyUnlocked.length };
}

/**
 * One-click design coverage: four past days, one landing in each phase
 * (dawn/day/dusk/night), the most-recent a two-park hop mirroring the mock,
 * plus seeded headliner coins. Processed oldest → newest so each day's
 * cumulative-stat crossings light up ITS "leveled up today" section.
 */
export async function seedActivityPhases(
  userId: string,
  parkId: number,
  secondParkId?: number | null,
): Promise<{ days: number }> {
  // Ordered oldest → newest (largest offset first).
  const configs: Array<Omit<SpoofDayOpts, "parkId" | "secondParkId">> = [
    {
      dayOffset: 4,
      phaseHour: 7, // dawn
      steps: 5200,
      distanceM: 3800,
      queueSeconds: 1500,
      rides: 3,
      ropeDrop: true,
      nightOwl: false,
      rainy: false,
      seedHeadliners: false,
      seedTimeline: false,
    },
    {
      dayOffset: 3,
      phaseHour: 14, // day
      steps: 9800,
      distanceM: 7200,
      queueSeconds: 4200,
      rides: 5,
      ropeDrop: false,
      nightOwl: false,
      rainy: true,
      seedHeadliners: false,
      seedTimeline: true,
    },
    {
      dayOffset: 2,
      phaseHour: 18, // dusk
      steps: 14200,
      distanceM: 9800,
      queueSeconds: 6300,
      rides: 7,
      ropeDrop: false,
      nightOwl: false,
      rainy: false,
      seedHeadliners: false,
      seedTimeline: true,
    },
    {
      dayOffset: 1,
      phaseHour: 22, // night — the hop-day headliner (mirrors the mock)
      steps: 19847,
      distanceM: 13500,
      queueSeconds: 10260,
      rides: 11,
      ropeDrop: true,
      nightOwl: true,
      rainy: false,
      seedHeadliners: true,
      seedTimeline: true,
    },
  ];

  let n = 0;
  for (const c of configs) {
    await spoofActivityDay(userId, {
      ...c,
      parkId,
      // Only the last (night, most-recent) day is a hop.
      secondParkId: c.dayOffset === 1 ? secondParkId : null,
    });
    n++;
  }
  return { days: n };
}
