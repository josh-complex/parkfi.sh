/**
 * The Waits board's derivations: the park strip's pulse, the picks engine
 * behind "Worth walking to right now", and the mover shelves.
 *
 * All of it is pure and client-side on purpose (docs/plans/waits-redesign §5.1):
 * `parks.allRides` is already one payload for the whole page, so the strip's
 * average and the list's rows are computed from the same array and can never
 * disagree about the same number. The only server addition is `parks.movers`,
 * which supplies what a single live snapshot can't know — what the wait *was*
 * half an hour ago.
 */
import { ALL_PARKS, WATER_PARK_SLUGS, formatParkName } from "#/lib/parks.ts";
import { nextShowtime, parseShowtimes, showClock } from "#/lib/showtimes.ts";

import type { TRPCRouter } from "#/integrations/trpc/router.ts";
import type { inferRouterOutputs } from "@trpc/server";

type Outputs = inferRouterOutputs<TRPCRouter>;

/** One attraction row as `parks.allRides` ships it. */
export type Ride = Outputs["parks"]["allRides"][number];
/** One ride that has moved since ~30 min ago. */
export type Mover = Outputs["parks"]["movers"]["movers"][number];
/** A park's hour-over-hour average, for the strip's arrow. */
export type ParkTrend = Outputs["parks"]["movers"]["byPark"][number];

/** Under this many minutes a queue is a walk-on, not a wait (pick rule 1). */
const WALK_ON_MIN = 10;
/** A show has to be starting inside this window to be worth interrupting a day. */
const SHOW_SOON_MIN = 30;
/**
 * Movement smaller than this is noise, not news — the feeds round waits to
 * 5-minute steps, so a ±5 swing is one tick of the smallest unit anyone posts.
 */
const MOVER_FLOOR_MIN = 5;

/* ── The park strip ───────────────────────────────────────────────────────── */

/** The park's own hero photo, as `parks.list` publishes it. */
export interface ParkArt {
  imageUrl: string | null;
  imageAlt: string | null;
  imageThumbhash: string | null;
}

export interface ParkPulse extends ParkArt {
  slug: string;
  /** Display name, operator prefix and "Theme Park" suffix already trimmed. */
  name: string;
  /** Mean standby across the park's open, wait-posting rides; null when shut. */
  avg: number | null;
  /** How many of the park's attractions are OPERATING right now. */
  open: number;
  /** How many attractions the park has at all. */
  total: number;
  /** Hour-over-hour change in that average, from `parks.movers`; null if unknown. */
  delta: number | null;
  /**
   * The park is shut right now. Read off today's calendar (`Ride.parkOpen`),
   * which counts every kind of open window — regular hours, early entry,
   * extended evening, hard-ticket events — and only falls back to "is anything
   * operating" where the schedule feed has nothing to say. See `parkPulses`.
   */
  closed: boolean;
}

/**
 * Canonical strip order: the resorts' own running order (Magic Kingdom first),
 * with the water parks pushed to the tail. They post real waits and belong on
 * the board — open question 2 answered "always shown", because a strip whose
 * card count changes with the season reads like a bug — but a strip that opens
 * on Blizzard Beach reads like a mistake.
 *
 * Keyed by slug, not label: `formatParkName` renders "Universal Studios Florida"
 * as "Universal Studios" where `UOR_PARKS` labels it "Studios", and a name-keyed
 * map would silently miss it. Volcano Bay has no slug in that list (its ticket
 * pricing isn't wired), so it falls through to the tail — which is where a water
 * park belongs anyway.
 */
const PARK_ORDER = new Map(
  [...ALL_PARKS]
    .sort((a, b) => Number(a.water ?? false) - Number(b.water ?? false))
    .flatMap((p, i) => (p.slug ? [[p.slug, i] as const] : [])),
);

/**
 * Where a park sits in the strip. Exported because the board's "Park" sort has
 * to agree with it — sorting the list alphabetically while the strip above runs
 * in resort order would read as two different orderings of the same eight
 * things.
 */
export function parkRank(slug: string): number {
  return PARK_ORDER.get(slug) ?? PARK_ORDER.size;
}

/** Mean standby over rides that are open *and* posting a number, rounded. */
export function averageWait(rides: ReadonlyArray<Ride>): number | null {
  const posted = rides.filter((r) => r.status === "OPERATING" && r.standbyWait != null);
  if (posted.length === 0) return null;
  const sum = posted.reduce((s, r) => s + (r.standbyWait ?? 0), 0);
  return Math.round(sum / posted.length);
}

/**
 * One card's worth of state per park.
 *
 * Hard-ticket Halloween Horror Nights houses are left out of the average for
 * the same reason the board shelves them separately: they only run on event
 * nights, and on those nights they're often the only thing posting a wait, so
 * they'd yank the park's headline number around. They still count as
 * attractions in `total`/`open`.
 *
 * `closed` is the park's *calendar*, not its ride count. Counting rides was
 * wrong in both directions on exactly the nights the strip matters most:
 *
 * - Universal Studios on a Horror Nights night runs the houses and nothing
 *   else, and posts no wait at all for the first stretch of the event — a park
 *   with 10,000 people in it reading "Closed".
 * - Magic Kingdom's party evenings, EPCOT After Hours and early entry are the
 *   same shape: the park is open on a ticket, the queues just haven't started
 *   posting yet.
 *
 * The server already decides this (`allRides` forces every ride CLOSED outside
 * the park's windows, which is what stops the overnight feed's stale waits from
 * reading as an open park); `parkOpen` is that same verdict, shipped. The ride
 * count survives only as the fallback for a park the schedule feed doesn't
 * cover, where a posting queue is the only evidence there is.
 */
export function parkPulses(
  rides: ReadonlyArray<Ride>,
  trends: ReadonlyArray<ParkTrend> = [],
  /** slug → hero art from `parks.list`; absent until that query lands. */
  art: ReadonlyMap<string, ParkArt> = new Map(),
): Array<ParkPulse> {
  const trendBySlug = new Map(trends.map((t) => [t.parkSlug, t.delta]));
  const byPark = new Map<string, { name: string; rides: Array<Ride> }>();
  for (const r of rides) {
    const g = byPark.get(r.parkSlug) ?? { name: formatParkName(r.parkName), rides: [] };
    g.rides.push(r);
    byPark.set(r.parkSlug, g);
  }
  return [...byPark.entries()]
    .map(([slug, g]) => {
      const open = g.rides.filter((r) => r.status === "OPERATING").length;
      // Every row of a park carries that park's verdict, so the first one is
      // the park's — `find` only to skip a `null` from a park the feed hasn't
      // scheduled, which is the case the `?? open > 0` fallback is for.
      const parkOpen = g.rides.find((r) => r.parkOpen != null)?.parkOpen ?? null;
      const photo = art.get(slug);
      return {
        slug,
        name: g.name,
        avg: averageWait(g.rides.filter((r) => !r.hauntedHouse)),
        open,
        total: g.rides.length,
        delta: trendBySlug.get(slug) ?? null,
        closed: parkOpen == null ? open === 0 : !parkOpen,
        imageUrl: photo?.imageUrl ?? null,
        imageAlt: photo?.imageAlt ?? null,
        imageThumbhash: photo?.imageThumbhash ?? null,
      };
    })
    .sort((a, b) => parkRank(a.slug) - parkRank(b.slug) || a.name.localeCompare(b.name));
}

/* ── The picks engine (§6) ────────────────────────────────────────────────── */

export type PickRule = "walk-on" | "biggest-drop" | "below-usual" | "starting-soon";

export interface Pick {
  ride: Ride;
  rule: PickRule;
  /** The one-line "why" printed under the name. Never empty. */
  reason: string;
}

/** The hour a reading `minutesAgo` old fell in, park-local: "2 PM". */
function clockHour(nowMs: number, minutesAgo: number, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", hour12: true }).format(
    new Date(nowMs - minutesAgo * 60_000),
  );
}

/** Is this row something a guest can walk up to and do right now? */
function isRideable(r: Ride): boolean {
  return r.status === "OPERATING" && !r.hauntedHouse;
}

/**
 * What this ride normally makes people wait at this hour — the one popularity
 * signal the payload carries, and a fair one: a headliner's normal is 45 minutes
 * and a kiddie spinner's is five. Null until `parks.hourlyProfiles` lands, or
 * for a ride with too little history to have a profile.
 */
function usualWait(r: Ride, usualByRide?: ReadonlyMap<number, number>): number | null {
  return usualByRide?.get(r.id) ?? null;
}

/**
 * Minutes a walk-on actually saves: how far under its own normal this queue is
 * standing. A slide or a spinner that never has a queue saves nothing by having
 * none now, so it sorts below a headliner sitting at ten minutes — "worth
 * walking to" has to mean something was gained by walking there.
 *
 * Zero when the ride has no profile, which parks unknowns at the bottom of the
 * lane without removing them: they still fill the panel when nothing better is
 * on offer, and if the profiles query fails outright every candidate scores zero
 * and the lane falls back to the shortest-wait order it used before.
 */
function walkOnValue(r: Ride, usualByRide?: ReadonlyMap<number, number>): number {
  const usual = usualWait(r, usualByRide);
  if (usual == null || r.standbyWait == null) return 0;
  return Math.max(0, Math.round(usual - r.standbyWait));
}

/**
 * How many picks the panel holds. The four rules fire once each in priority
 * order first (that ordering is the whole point); only then do their runner-ups
 * fill the rest, round-robin, so a fifth slot is the *second*-best walk-on
 * rather than the fourth-best of whichever rule happened to be richest.
 */
const PICK_LIMIT = 5;

/** One rule's candidates, best first — a lane the backfill can draw from. */
interface Lane {
  rule: PickRule;
  rides: Array<{ ride: Ride; reason: string }>;
}

/**
 * Up to {@link PICK_LIMIT} picks, one reason each, from the four rules of §6 —
 * walk-on, biggest drop, below its usual, starting soon. The first pass takes
 * the best candidate from each rule in that priority order; the passes after it
 * take each rule's next-best in the same order, until the panel is full or the
 * lanes run dry. A ride never appears twice, and ties break to the shorter wait.
 *
 * A rule that finds nothing yields nothing, and a short panel stays short: every
 * pick — backfilled or not — carries a reason we can actually print, which is
 * the line between a fifth pick and a filler one.
 */
export function buildPicks(input: {
  /** The rides in scope — every park, or just the selected ones. */
  rides: ReadonlyArray<Ride>;
  /** Movers for the same scope. */
  movers: ReadonlyArray<Mover>;
  /** ride id → this ride's 30-day average standby for the current local hour. */
  usualByRide?: ReadonlyMap<number, number>;
  /** The board's park filter, empty for "every park" — see the water-park rule. */
  selectedParks?: ReadonlySet<string>;
  nowMs: number;
  limit?: number;
}): Array<Pick> {
  const { rides, movers, usualByRide, selectedParks, nowMs, limit = PICK_LIMIT } = input;

  // A water park's attractions are only candidates when the reader asked for
  // one. A slide with no queue is the *normal* state of a slide, so on any warm
  // afternoon Typhoon Lagoon and Volcano Bay would take every walk-on slot on
  // the panel and push the theme parks — what someone on this page is almost
  // always planning around — off it entirely. Selecting a water park in the
  // strip puts its slides straight back.
  const waterAsked = selectedParks
    ? [...selectedParks].some((slug) => WATER_PARK_SLUGS.has(slug))
    : false;
  const open = rides.filter(
    (r) => isRideable(r) && (waterAsked || !WATER_PARK_SLUGS.has(r.parkSlug)),
  );
  const byId = new Map(open.map((r) => [r.id, r]));

  // 1 · Walk-ons, best value first: how far under its own normal each queue is
  // standing, not how short it is in absolute terms. Sorting by the bare wait
  // handed the top of the panel to whatever never has a queue — the walkthrough,
  // the carousel — while a headliner sitting at ten minutes, the genuinely
  // remarkable thing, waited below it.
  //
  // The distance clause ("3 minutes away") waits on a live fix and a route;
  // until then the reason is the fact on its own, which is still true.
  const walkOn: Lane = {
    rule: "walk-on",
    rides: open
      .filter((r) => r.standbyWait != null && r.standbyWait <= WALK_ON_MIN)
      .map((ride) => ({ ride, value: walkOnValue(ride, usualByRide) }))
      .sort(
        (a, b) =>
          b.value - a.value ||
          (a.ride.standbyWait ?? 0) - (b.ride.standbyWait ?? 0) ||
          a.ride.name.localeCompare(b.ride.name),
      )
      .map(({ ride }) => ({ ride, reason: "walk-on" })),
  };

  // 2 · The queues that have fallen furthest in the last half hour.
  const drops: Lane = {
    rule: "biggest-drop",
    rides: movers
      .filter((m) => m.delta < 0 && byId.has(m.rideId))
      .sort((a, b) => a.delta - b.delta || a.waitMin - b.waitMin)
      .flatMap((m) => {
        const ride = byId.get(m.rideId);
        if (!ride) return [];
        const since = clockHour(nowMs, 30, ride.parkTimezone);
        return [{ ride, reason: `dropped ${Math.abs(m.delta)} min since ${since}` }];
      }),
  };

  // 3 · Furthest below its own normal for this hour. Needs the profiles rollup;
  // without it the lane is simply empty and the panel is one pick shorter.
  const belowUsual: Lane = {
    rule: "below-usual",
    rides: open
      .flatMap((r) => {
        const usual = r.standbyWait == null ? null : usualByRide?.get(r.id);
        if (usual == null || r.standbyWait == null) return [];
        const under = Math.round(usual - r.standbyWait);
        return under < WALK_ON_MIN ? [] : [{ ride: r, under }];
      })
      .sort((a, b) => b.under - a.under)
      .map(({ ride, under }) => ({
        ride,
        reason: `${under} under its usual for ${clockHour(nowMs, 0, ride.parkTimezone)}`,
      })),
  };

  // 4 · Shows about to start. Ordinary rides never carry showtimes, so this
  // needs no category test — having a next performance *is* the test.
  const startingSoon: Lane = {
    rule: "starting-soon",
    rides: open
      .flatMap((r) => {
        if (r.showtimes.length === 0) return [];
        const next = nextShowtime(parseShowtimes(r.showtimes), nowMs);
        if (!next || next.ms - nowMs > SHOW_SOON_MIN * 60_000) return [];
        return [{ ride: r, ms: next.ms, iso: next.iso }];
      })
      .sort((a, b) => a.ms - b.ms)
      .map(({ ride, iso }) => ({
        ride,
        reason: `next show ${showClock(iso, ride.parkTimezone)}`,
      })),
  };

  const lanes = [walkOn, drops, belowUsual, startingSoon];
  const cursors = lanes.map(() => 0);
  const taken = new Set<number>();
  const picks: Array<Pick> = [];

  // Round-robin over the lanes: pass 1 is one pick per rule in priority order,
  // every pass after it is that rule's next-best. A lane whose head is already
  // spent (the walk-on that was also the biggest drop) is advanced, not skipped.
  for (let pass = 0; picks.length < limit; pass++) {
    let progressed = false;
    for (const [i, lane] of lanes.entries()) {
      if (picks.length >= limit) break;
      while (cursors[i] < lane.rides.length && taken.has(lane.rides[cursors[i]].ride.id)) {
        cursors[i] += 1;
      }
      const candidate = lane.rides[cursors[i]];
      if (!candidate) continue;
      cursors[i] += 1;
      taken.add(candidate.ride.id);
      picks.push({ ride: candidate.ride, rule: lane.rule, reason: candidate.reason });
      progressed = true;
    }
    if (!progressed) break;
  }
  return picks;
}

/* ── The mover shelves ────────────────────────────────────────────────────── */

export interface MoverRow extends Mover {
  /** The matching `allRides` row, when the mover is in the current scope. */
  ride: Ride | undefined;
}

/**
 * The biggest falls and the biggest climbs, largest swing first. Both are
 * floored at `MOVER_FLOOR_MIN` so a shelf never fills itself with one tick of
 * feed rounding — a short shelf is honest, a padded one isn't.
 */
export function splitMovers(
  movers: ReadonlyArray<Mover>,
  byId: ReadonlyMap<number, Ride>,
  limit = 3,
): { dropping: Array<MoverRow>; climbing: Array<MoverRow> } {
  const rows = movers.map((m) => ({ ...m, ride: byId.get(m.rideId) }));
  return {
    dropping: rows
      .filter((m) => m.delta <= -MOVER_FLOOR_MIN)
      .sort((a, b) => a.delta - b.delta)
      .slice(0, limit),
    climbing: rows
      .filter((m) => m.delta >= MOVER_FLOOR_MIN)
      .sort((a, b) => b.delta - a.delta)
      .slice(0, limit),
  };
}

/* ── "Shortest later" (§6, W5) ────────────────────────────────────────────── */

/** One ride's best remaining window today, from `parks.hourlyProfiles`. */
export interface LaterWindow {
  waitMin: number;
  /** Park-local clock for the start of that hour, e.g. "8 PM". */
  at: string;
}

/**
 * The later column's one line. Printed only when the window is meaningfully
 * better than standing here now — under that bar the honest answer is that
 * there isn't one, which is itself useful.
 */
export function formatLaterWindow(
  now: number | null,
  later: LaterWindow | null | undefined,
): string | null {
  if (now == null || !later) return null;
  if (now - later.waitMin < WALK_ON_MIN) return null;
  return `${later.waitMin} min at ${later.at}`;
}

/* ── Hourly profiles (§6, W5) ─────────────────────────────────────────────── */

/** One attraction's 30-day average standby for one park-local hour of day. */
export interface HourProfile {
  rideId: number;
  /** 0–23, in the *park's* timezone. */
  hour: number;
  usual: number;
}

/** "8 PM" from a local hour number — already local, so no timezone math. */
function hourLabel(hour: number): string {
  return `${hour % 12 || 12} ${hour < 12 ? "AM" : "PM"}`;
}

/** The current hour of day (0–23) in a given zone. */
function localHour(nowMs: number, timeZone: string): number {
  return Number(
    new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", hourCycle: "h23" }).format(
      new Date(nowMs),
    ),
  );
}

/**
 * Turn the flat profile payload into the two lookups the board actually reads:
 * what each queue *usually* runs at right now (pick rule 3), and the best hour
 * it has left today (the "Shortest later" column).
 *
 * "Later" means strictly after the current park-local hour and strictly before
 * today's close (`Ride.closeHour`, from `parks.allRides`).
 *
 * That closing bound is load-bearing, and the absence of it was a real bug.
 * The profile is a 30-day average *by hour of day*, so it long outlives the
 * schedule that produced it: when Epic Universe moved its close from 9 PM to
 * 8 PM on 1 Sep 2026, the 8 PM row — built entirely from the sixteen late-
 * August nights that ran an hour longer, and averaging that hour's end-of-night
 * drain-down — kept advertising "31 min at 8 PM" to readers of a park that now
 * shuts at 8. Roughly a fifth of all profile hours sat past their park's close
 * the day this bound was added.
 *
 * A ride whose park has no `closeHour` today (no OPERATING window in the feed)
 * keeps the old unbounded behaviour rather than losing the column outright.
 */
export function buildProfileLookups(input: {
  profiles: ReadonlyArray<HourProfile>;
  rides: ReadonlyArray<Ride>;
  nowMs: number;
}): { usualByRide: Map<number, number>; laterById: Map<number, LaterWindow> } {
  const usualByRide = new Map<number, number>();
  const laterById = new Map<number, LaterWindow>();
  if (input.profiles.length === 0) return { usualByRide, laterById };

  // Every park is America/New_York today; resolving per zone anyway costs one
  // `Intl` call per distinct zone and keeps the day a resort in another one
  // opens from being a silent hour-shift bug.
  const hourByZone = new Map<string, number>();
  const zoneHour = (tz: string) => {
    let h = hourByZone.get(tz);
    if (h == null) {
      h = localHour(input.nowMs, tz);
      hourByZone.set(tz, h);
    }
    return h;
  };
  const rideById = new Map(input.rides.map((r) => [r.id, r]));

  for (const p of input.profiles) {
    const ride = rideById.get(p.rideId);
    if (!ride) continue;
    const now = zoneHour(ride.parkTimezone);
    if (p.hour === now) usualByRide.set(p.rideId, p.usual);
    if (p.hour <= now) continue;
    if (ride.closeHour != null && p.hour >= ride.closeHour) continue;
    const best = laterById.get(p.rideId);
    if (!best || p.usual < best.waitMin) {
      laterById.set(p.rideId, { waitMin: p.usual, at: hourLabel(p.hour) });
    }
  }
  return { usualByRide, laterById };
}
