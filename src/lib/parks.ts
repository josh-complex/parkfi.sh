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
  { code: "UVB", label: "Volcano Bay", slug: null },
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

/** Default park slug to use for resort-level crowd/weather when no park is selected. */
export const RESORT_DEFAULT_SLUG: Record<string, string> = {
  WDW: "magic-kingdom",
  UOR: "universal-studios-florida",
};

/**
 * Display name for a park, trimmed of the redundant "Theme Park" / "Water Park"
 * / "Park" suffix the source feeds tack on (e.g. "Disney's Animal Kingdom Theme
 * Park", "Disney's Blizzard Beach Water Park", "Magic Kingdom Park"), which
 * otherwise reads as a redundant repeat next to the park identity.
 */
export function formatParkName(name: string): string {
  return name
    .replace(/\s+(?:Theme|Water)\s+Park$/i, "")
    .replace(/\s+Park$/i, "")
    .trim();
}
