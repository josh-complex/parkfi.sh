/**
 * Disney-scoped achievement logic: park/attraction identity by slug, curated
 * attraction sets, and the WDW resort-transit zone machine.
 *
 * Everything here is pure data + pure functions — no DB imports. The engine
 * (`engine.ts`) resolves slugs → ids at query time and feeds rows through
 * these helpers, so the whole module unit-tests without a database.
 *
 * Identity is by (park slug, attraction slug), both verified against the
 * production catalog on 2026-07-19. Slugs come from `slugify(name)` at ingest
 * (`src/server/parks/ingest.ts`), so a Disney rename can drift a slug — the
 * sets fail soft (an unmatched slug just never counts) and the monthly geo
 * cron is the natural moment to re-verify.
 */
import { distanceMeters, type LngLat } from "./geo.ts";

// ---------------------------------------------------------------------------
// Park identity.
// ---------------------------------------------------------------------------

/** The four WDW theme parks (water parks deliberately excluded — a "four park
 *  day" means the four gates, and `wdw_parks_unique` matches that promise). */
export const WDW_PARK_SLUGS = [
  "magic-kingdom",
  "epcot",
  "animal-kingdom",
  "hollywood-studios",
] as const;

export const EPCOT_SLUG = "epcot";

// ---------------------------------------------------------------------------
// Curated attraction sets (cross-table stats — matched against the user's
// `user_attraction` rows joined to slugs).
// ---------------------------------------------------------------------------

export type SlugPair = readonly [park: string, attraction: string];

/** The WDW mountain range: the canonical four. (Seven Dwarfs is a mine train —
 *  the miners would want it noted.) */
export const MOUNTAIN_SET: readonly SlugPair[] = [
  ["magic-kingdom", "space-mountain"],
  ["magic-kingdom", "big-thunder-mountain-railroad"],
  ["magic-kingdom", "tiana-s-bayou-adventure"],
  ["animal-kingdom", "expedition-everest-legend-of-the-forbidden-mountain"],
];

/**
 * Magic Kingdom attractions operating on October 1, 1971 and still standing
 * (under current names — Country Bear Musical Jamboree is the Jamboree's 2024
 * refresh, Prince Charming Regal Carrousel was Cinderella's Golden Carrousel,
 * Tomorrowland Speedway was the Grand Prix Raceway, the Tiki Room was the
 * Tropical Serenade). The WDW Railroad is excluded on purpose: it maps to two
 * station entities and a rider only anchors at one, which would make the set
 * uncompletable-looking for half of riders.
 */
export const CLASSICS_1971_SET: readonly SlugPair[] = [
  ["magic-kingdom", "jungle-cruise"],
  ["magic-kingdom", "haunted-mansion"],
  ["magic-kingdom", "it-s-a-small-world"],
  ["magic-kingdom", "peter-pan-s-flight"],
  ["magic-kingdom", "dumbo-the-flying-elephant"],
  ["magic-kingdom", "mad-tea-party"],
  ["magic-kingdom", "prince-charming-regal-carrousel"],
  ["magic-kingdom", "swiss-family-treehouse"],
  ["magic-kingdom", "the-hall-of-presidents"],
  ["magic-kingdom", "country-bear-musical-jamboree"],
  ["magic-kingdom", "tomorrowland-speedway"],
  ["magic-kingdom", "walt-disney-s-enchanted-tiki-room"],
];

/** How many of `set`'s (park, attraction) pairs appear in `ridden`. Pure. */
export function countSetMatches(
  ridden: ReadonlyArray<{ park: string; slug: string }>,
  set: readonly SlugPair[],
): number {
  const have = new Set(ridden.map((r) => `${r.park}/${r.slug}`));
  let n = 0;
  for (const [park, slug] of set) if (have.has(`${park}/${slug}`)) n++;
  return n;
}

// ---------------------------------------------------------------------------
// Day-derived Disney stats.
// ---------------------------------------------------------------------------

/** Park ids the day-stat fold needs, resolved from slugs by the engine. */
export interface DisneyParkIdent {
  /** Ids of the four WDW theme parks present in this deployment's catalog. */
  wdwIds: ReadonlySet<number>;
  epcotId: number | null;
}

export interface DisneyDayRow {
  parkId: number;
  day: string; // park-local YYYY-MM-DD
  distanceM: number;
  steps: number;
}

export interface DisneyDayStats {
  four_park_days: number;
  wdw_parks_unique: number;
  epcot_steps: number;
  epcot_best_day_distance_m: number;
  home_park_days: number;
}

/**
 * Fold day rows into the Disney-scoped day stats. A "four park day" requires
 * all four WDW ids on one calendar `day` string — day keys are park-local, and
 * the four parks share a timezone, so the day boundary is coherent. Pure.
 */
export function aggregateDisneyDayStats(
  dayRows: readonly DisneyDayRow[],
  ident: DisneyParkIdent,
): DisneyDayStats {
  const wdwSeen = new Set<number>();
  const byDay = new Map<string, Set<number>>();
  const perPark = new Map<number, number>();
  let epcotSteps = 0;
  let epcotBestDistance = 0;

  for (const r of dayRows) {
    perPark.set(r.parkId, (perPark.get(r.parkId) ?? 0) + 1);
    if (ident.wdwIds.has(r.parkId)) {
      wdwSeen.add(r.parkId);
      const set = byDay.get(r.day) ?? new Set<number>();
      set.add(r.parkId);
      byDay.set(r.day, set);
    }
    if (ident.epcotId != null && r.parkId === ident.epcotId) {
      epcotSteps += r.steps;
      epcotBestDistance = Math.max(epcotBestDistance, r.distanceM);
    }
  }

  const fourParkDays =
    ident.wdwIds.size === 4
      ? [...byDay.values()].filter((s) => s.size === ident.wdwIds.size).length
      : 0;

  return {
    four_park_days: fourParkDays,
    wdw_parks_unique: wdwSeen.size,
    epcot_steps: epcotSteps,
    epcot_best_day_distance_m: epcotBestDistance,
    home_park_days: Math.max(0, ...perPark.values()),
  };
}

// ---------------------------------------------------------------------------
// Resort-transit zones. Hand-seeded circles, coordinates from OSM (station
// nodes, 2026-07-19). Circles instead of polygons: stations are point-like,
// and a center+radius is verifiable at a glance against a map.
// ---------------------------------------------------------------------------

export type ZoneKind = "monorail" | "skyliner" | "waypoint";

export interface ResortZone {
  slug: string;
  name: string;
  kind: ZoneKind;
  lat: number;
  lng: number;
  radiusM: number;
}

export const RESORT_ZONES: readonly ResortZone[] = [
  // Monorail system (Express + Resort + EPCOT lines). TTC and MK get wider
  // radii to also cover their ferry docks (~130 m from the station platform),
  // so ferry riders enter the same endpoint zones as monorail riders — the
  // mid-lagoon waypoint is what tells the two trips apart.
  {
    slug: "ttc",
    name: "Transportation & Ticket Center",
    kind: "monorail",
    lat: 28.40563,
    lng: -81.57949,
    radiusM: 180,
  },
  {
    slug: "mk",
    name: "Magic Kingdom station",
    kind: "monorail",
    lat: 28.41595,
    lng: -81.58225,
    radiusM: 180,
  },
  {
    slug: "epcot-monorail",
    name: "EPCOT monorail station",
    kind: "monorail",
    lat: 28.37683,
    lng: -81.54962,
    radiusM: 120,
  },
  {
    slug: "contemporary",
    name: "Disney's Contemporary Resort",
    kind: "monorail",
    lat: 28.41479,
    lng: -81.57458,
    radiusM: 110,
  },
  {
    slug: "polynesian",
    name: "Disney's Polynesian Village Resort",
    kind: "monorail",
    lat: 28.40501,
    lng: -81.58518,
    radiusM: 110,
  },
  {
    slug: "grand-floridian",
    name: "Disney's Grand Floridian Resort",
    kind: "monorail",
    lat: 28.41085,
    lng: -81.58815,
    radiusM: 110,
  },
  // Ferry disambiguator: the ferry sails through the middle of Seven Seas
  // Lagoon; the Express beam hugs the eastern shore and the Resort beam the
  // western resorts, so neither monorail line clips this circle.
  {
    slug: "seven-seas-lagoon",
    name: "Seven Seas Lagoon",
    kind: "waypoint",
    lat: 28.4106,
    lng: -81.5804,
    radiusM: 250,
  },
  // Disney Skyliner. The unnamed turn station on the Hollywood Studios line is
  // deliberately NOT a zone — it sits beside the Friendship-boat canal, and a
  // boat pinging there would read as a gondola leg. The Studios station circle
  // intentionally also covers the HS Friendship dock (~105 m away); the
  // epcot↔hs direct-pair rule below is what keeps boat trips uncredited.
  {
    slug: "skyliner-epcot",
    name: "EPCOT Skyliner station",
    kind: "skyliner",
    lat: 28.37011,
    lng: -81.5534,
    radiusM: 110,
  },
  {
    slug: "skyliner-hs",
    name: "Hollywood Studios Skyliner station",
    kind: "skyliner",
    lat: 28.35908,
    lng: -81.55712,
    radiusM: 110,
  },
  {
    slug: "skyliner-caribbean-beach",
    name: "Caribbean Beach Skyliner hub",
    kind: "skyliner",
    lat: 28.35913,
    lng: -81.5447,
    radiusM: 110,
  },
  {
    slug: "skyliner-riviera",
    name: "Riviera Resort Skyliner station",
    kind: "skyliner",
    lat: 28.36558,
    lng: -81.54405,
    radiusM: 110,
  },
  {
    slug: "skyliner-pop-aoa",
    name: "Pop Century / Art of Animation Skyliner station",
    kind: "skyliner",
    lat: 28.35058,
    lng: -81.54567,
    radiusM: 110,
  },
];

/** Nearest zone whose radius contains the point, or null. Pure. */
export function zoneForPoint(
  p: LngLat,
  zones: readonly ResortZone[] = RESORT_ZONES,
): ResortZone | null {
  let best: { zone: ResortZone; d: number } | null = null;
  for (const z of zones) {
    const d = distanceMeters(p, [z.lng, z.lat]);
    if (d <= z.radiusM && (!best || d < best.d)) best = { zone: z, d };
  }
  return best?.zone ?? null;
}

// ---------------------------------------------------------------------------
// Trip classification.
// ---------------------------------------------------------------------------

/** Longest plausible zone-to-zone leg (ferry ≈ 12 min, gondola line ≈ 15). */
export const MAX_TRANSIT_S = 25 * 60;
/** One physical journey credits once per kind within this window — a resort-
 *  loop monorail ride settles at three stations but counts one ride. */
export const TRANSIT_DEDUPE_S = 30 * 60;
/** At or under this many steps between zones, the user rode. (Station
 *  concourses cost a couple hundred steps even on a ride.) */
export const RIDE_MAX_STEPS = 350;
/** At or over this many steps between the EPCOT and Studios Skyliner zones,
 *  the user walked Crescent Lake (~2 km ≈ 2 800 steps). */
export const CRESCENT_MIN_STEPS = 1500;

export type TransitStatKey =
  | "ttc_visits"
  | "monorail_rides"
  | "ferry_rides"
  | "skyliner_rides"
  | "crescent_walks";

const MONORAIL_SLUGS = new Set(
  RESORT_ZONES.filter((z) => z.kind === "monorail").map((z) => z.slug),
);
const SKYLINER_SLUGS = new Set(
  RESORT_ZONES.filter((z) => z.kind === "skyliner").map((z) => z.slug),
);

/** Unordered pair key. */
function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/**
 * Monorail-station pairs that are also walkable on foot (resort walkways).
 * These credit a monorail ride only with pedometer proof of a low-step
 * transit; without step evidence (web, denied permission) they credit nothing
 * rather than mint rides for walkers.
 */
const WALKABLE_MONORAIL_PAIRS = new Set([
  pairKey("ttc", "polynesian"),
  pairKey("polynesian", "grand-floridian"),
  pairKey("grand-floridian", "mk"),
  pairKey("contemporary", "mk"),
  pairKey("polynesian", "mk"), // via the GF walkway, skipping the GF zone
]);

/**
 * Classify one zone transition into a trip credit (or null). `steps` is the
 * pedometer total accumulated between the zones; `hasStepEvidence` is false on
 * web / denied-permission devices, where ride-vs-walked can't be told apart —
 * then only pairs with no walking path at all may credit. Pure.
 *
 * Ferry legs ride the mid-lagoon waypoint: entering the waypoint is silent
 * (mid-trip), and waypoint → dock is the crossing. Skyliner: every EPCOT↔
 * Studios journey changes cabins at Caribbean Beach, so a *direct* epcot↔hs
 * transition never came by gondola — high steps is the Crescent Lake walk,
 * low steps is the Friendship boat (no family; uncredited) or a GPS gap.
 */
export function classifyTransition(
  from: string,
  to: string,
  steps: number,
  hasStepEvidence: boolean,
): TransitStatKey | null {
  const rode = !hasStepEvidence || steps <= RIDE_MAX_STEPS;

  // Ferry: mid-lagoon → either dock zone. (Dock → lagoon is mid-trip, silent.)
  if (from === "seven-seas-lagoon") {
    return (to === "ttc" || to === "mk") && rode ? "ferry_rides" : null;
  }
  if (to === "seven-seas-lagoon") return null;

  if (MONORAIL_SLUGS.has(from) && MONORAIL_SLUGS.has(to)) {
    if (hasStepEvidence && steps > RIDE_MAX_STEPS) return null; // walked
    if (WALKABLE_MONORAIL_PAIRS.has(pairKey(from, to)) && !hasStepEvidence) return null;
    return "monorail_rides";
  }

  if (SKYLINER_SLUGS.has(from) && SKYLINER_SLUGS.has(to)) {
    if (pairKey(from, to) === pairKey("skyliner-epcot", "skyliner-hs")) {
      return hasStepEvidence && steps >= CRESCENT_MIN_STEPS ? "crescent_walks" : null;
    }
    // Every other pair implies a real gondola leg — but ground paths exist
    // between all of them, so demand step proof of riding.
    return hasStepEvidence && steps <= RIDE_MAX_STEPS ? "skyliner_rides" : null;
  }

  return null;
}

// ---------------------------------------------------------------------------
// The state machine (pure; persisted in user_geo_state by the engine).
// ---------------------------------------------------------------------------

export interface TransitState {
  zoneSlug: string | null;
  zoneAt: Date | null;
  zoneSteps: number;
  transitKind: string | null;
  transitAt: Date | null;
}

export const EMPTY_TRANSIT_STATE: TransitState = {
  zoneSlug: null,
  zoneAt: null,
  zoneSteps: 0,
  transitKind: null,
  transitAt: null,
};

/**
 * Advance the transit state with one out-of-park ping. `zoneNow` is the zone
 * containing the fix (or null between zones); `stepDelta` is this ping's
 * clamped pedometer delta. Returns the state to persist plus zero, one, or two
 * stat credits (a ferry arrival at the TTC is both a crossing and a TTC visit).
 *
 * Rules: while between zones the anchor freezes and steps accumulate; re-
 * entering the same zone refreshes it (no credit — kills GPS flapping);
 * entering a different zone within MAX_TRANSIT_S classifies the leg. Trip
 * kinds dedupe over TRANSIT_DEDUPE_S with the window *refreshed* on each
 * suppressed leg, so a multi-stop journey stays one credit for as long as it
 * keeps moving. TTC entries dedupe naturally through the same-zone rule.
 */
export function advanceTransitState(
  prev: TransitState,
  zoneNow: string | null,
  now: Date,
  stepDelta: number,
  hasStepEvidence: boolean,
): { next: TransitState; credits: TransitStatKey[] } {
  if (zoneNow == null) {
    return { next: { ...prev, zoneSteps: prev.zoneSteps + stepDelta }, credits: [] };
  }
  if (zoneNow === prev.zoneSlug) {
    return { next: { ...prev, zoneAt: now, zoneSteps: 0 }, credits: [] };
  }

  const credits: TransitStatKey[] = [];
  if (zoneNow === "ttc") credits.push("ttc_visits");

  let { transitKind, transitAt } = prev;
  const elapsedS = prev.zoneAt != null ? (now.getTime() - prev.zoneAt.getTime()) / 1000 : null;
  if (prev.zoneSlug != null && elapsedS != null && elapsedS >= 0 && elapsedS <= MAX_TRANSIT_S) {
    const steps = prev.zoneSteps + stepDelta;
    const kind = classifyTransition(prev.zoneSlug, zoneNow, steps, hasStepEvidence);
    if (kind != null) {
      const continuing =
        transitKind === kind &&
        transitAt != null &&
        now.getTime() - transitAt.getTime() <= TRANSIT_DEDUPE_S * 1000;
      if (!continuing) credits.push(kind);
      transitKind = kind;
      transitAt = now;
    }
  }

  return {
    next: { zoneSlug: zoneNow, zoneAt: now, zoneSteps: 0, transitKind, transitAt },
    credits,
  };
}
