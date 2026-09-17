export interface ParkListEntry {
  code: string;
  label: string;
  slug: string | null;
  /** Water parks price flat single-day tickets, not the demand-priced admission. */
  water?: boolean;
}

export const WDW_PARKS: Array<ParkListEntry> = [
  { code: "MK", label: "Magic Kingdom", slug: "magic-kingdom" },
  { code: "EP", label: "EPCOT", slug: "epcot" },
  { code: "HS", label: "Hollywood Studios", slug: "hollywood-studios" },
  { code: "AK", label: "Animal Kingdom", slug: "animal-kingdom" },
  { code: "TL", label: "Typhoon Lagoon", slug: "typhoon-lagoon", water: true },
  { code: "BB", label: "Blizzard Beach", slug: "blizzard-beach", water: true },
];

/** Codes of the flat-priced Disney water parks (matches `product_dim.park_scope`). */
export const WDW_WATER_PARK_CODES = new Set(WDW_PARKS.filter((p) => p.water).map((p) => p.code));

export const UOR_PARKS: Array<ParkListEntry> = [
  { code: "USF", label: "Studios", slug: "universal-studios-florida" },
  { code: "UIOA", label: "Islands of Adventure", slug: "islands-of-adventure" },
  { code: "EPIC", label: "Epic Universe", slug: "epic-universe" },
  // Volcano Bay is a DB-seeded park (waits/map/park page come from `parks.list`),
  // but stays slug-less here so it's excluded from the ticket-pricing surfaces
  // that iterate this list — Volcano Bay pricing (TapuTapu, no Express) is a
  // separate design. Give it a slug here once that pricing is wired.
  { code: "UVB", label: "Volcano Bay", slug: null, water: true },
];

export type Resort = "WDW" | "UOR";

export interface ParkEntry {
  code: string;
  label: string;
  slug: string | null;
  resort: Resort;
  water?: boolean;
}

/** Every park across both resorts, resort-tagged — for the combined park picker. */
export const ALL_PARKS: Array<ParkEntry> = [
  ...WDW_PARKS.map((p) => ({ ...p, resort: "WDW" as const })),
  ...UOR_PARKS.map((p) => ({ ...p, resort: "UOR" as const })),
];

/**
 * Park slugs whose attractions are water-park attractions, across both resorts.
 * Keyed by slug because the live surfaces (waits, picks, map) only ever hold a
 * park's slug; `ALL_PARKS` is keyed by code and leaves Volcano Bay slug-less for
 * the ticket-pricing surfaces, so that one is named here.
 */
export const WATER_PARK_SLUGS: ReadonlySet<string> = new Set([
  ...ALL_PARKS.flatMap((p) => (p.water && p.slug ? [p.slug] : [])),
  "volcano-bay",
]);

/** Default park slug to use for resort-level crowd/weather when no park is selected. */
export const RESORT_DEFAULT_SLUG: Record<string, string> = {
  WDW: "magic-kingdom",
  UOR: "universal-studios-florida",
};

/**
 * The park page's hero subtitle. Also baked into the map's park-badge flight
 * seed (`parkFlightSeed`), so the seeded hero and the loaded page paint the
 * same line and nothing re-lays-out when the queries land.
 */
export const PARK_TAGLINE = "Live wait times, ride status, and Lightning Lane availability.";

/**
 * Display name for a park, trimmed of the operator prefix and the redundant
 * "Theme Park" / "Water Park" / "Park" suffix the source feeds tack on — e.g.
 * "Disney's Animal Kingdom Theme Park" → "Animal Kingdom", "Disney's Blizzard
 * Beach Water Park" → "Blizzard Beach", "Magic Kingdom Park" → "Magic Kingdom",
 * "Universal Islands of Adventure" → "Islands of Adventure", "Universal Volcano
 * Bay" → "Volcano Bay", "Universal Studios Florida" → "Universal Studios". The
 * operator name reads as a redundant repeat next to the park identity. Exception:
 * a bare "Universal Studios" keeps its prefix — "Studios" alone doesn't parse as
 * a park name. Shared by every surface that shows a park name.
 */
export function formatParkName(name: string): string {
  return (
    name
      .replace(/^(?:Disney|Universal)['’]s\s+/i, "")
      // Non-possessive "Universal " prefix (Universal's parks), but not "Universal
      // Studios" — there "Universal" is load-bearing, not an operator tag.
      .replace(/^Universal\s+(?!Studios\b)/i, "")
      // "Universal Studios Florida" → "Universal Studios": the state suffix is a
      // location tag, not part of the park identity.
      .replace(/^(Universal Studios)\s+Florida$/i, "$1")
      .replace(/\s+(?:Theme|Water)\s+Park$/i, "")
      .replace(/\s+Park$/i, "")
      .trim()
  );
}

/**
 * A park name reduced to what the feeds agree on: no operator prefix, no
 * trailing "theme park" / "park" / "resort", no trademark glyphs, no
 * punctuation. "Magic Kingdom Park" and "Magic Kingdom" both key to
 * `magic kingdom`; "Disney's Hollywood Studios" keys to `hollywood studios`.
 *
 * `dining.byPark` runs the SQL twin of this — change one and change the other.
 */
export function parkLocationKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/[™®©'’]/g, "")
    .replace(/^(walt disney world|disneys|disney|universal)\s+/, "")
    .replace(/\s+(theme park|water park|park|resort)$/, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Loose match between a park's own name and the name a feed files a venue (or
 * any other facility) under: both sides lose what the feeds disagree about,
 * then one has to contain the other — a venue's location is never a *different*
 * park's name.
 */
export function samePark(facilityLocation: string | null | undefined, parkName: string): boolean {
  if (!facilityLocation) return false;
  const a = parkLocationKey(facilityLocation);
  const b = parkLocationKey(parkName);
  if (!a || !b) return false;
  return a === b || a.includes(b) || b.includes(a);
}
