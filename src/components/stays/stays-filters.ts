import type { ResortTier } from "#/server/stays/resort-catalog.generated.ts";

/** Display metadata per Disney resort tier, in the order browse sections render. */
export const TIER_META: Array<{
  key: ResortTier;
  label: string;
  /** Section heading + blurb for the pre-search browse rows. */
  heading: string;
  blurb: string;
}> = [
  {
    key: "deluxe",
    label: "Deluxe",
    heading: "Iconic Deluxe Resorts",
    blurb: "Monorail views, signature dining, and the shortest walks to the parks.",
  },
  {
    key: "villa",
    label: "Deluxe Villas",
    heading: "Disney Vacation Club Villas",
    blurb: "Roomy villas and cabins with kitchens — great for longer family stays.",
  },
  {
    key: "moderate",
    label: "Moderate",
    heading: "Moderate Resorts",
    blurb: "Themed grounds and table-service dining at a friendlier nightly rate.",
  },
  {
    key: "value",
    label: "Value",
    heading: "Value Resorts",
    blurb: "Bold, larger-than-life theming and the most wallet-friendly rooms on property.",
  },
  {
    key: "campground",
    label: "Campsites",
    heading: "The Great Outdoors",
    blurb: "Tent, RV, and full-hookup campsites tucked into the pines at Fort Wilderness.",
  },
];

export const TIER_LABEL: Record<ResortTier, string> = Object.fromEntries(
  TIER_META.map((t) => [t.key, t.label]),
) as Record<ResortTier, string>;

/** Short chip labels for the catalog's `area` strings — trims the "Resort Area" suffix. */
const AREA_LABEL: Record<string, string> = {
  "Magic Kingdom Resort Area": "Magic Kingdom",
  "EPCOT Resort Area": "EPCOT",
  "Disney's Animal Kingdom Resort Area": "Animal Kingdom",
  "Disney Springs Resort Area": "Disney Springs",
  "Wide World of Sports Resort Area": "Wide World of Sports",
};

/** Chip label for a resort `area` value, falling back to a suffix trim for unmapped areas. */
export function areaLabel(area: string): string {
  return AREA_LABEL[area] ?? area.replace(/\s+Resort Area$/, "");
}

const AREA_EMOJI: Record<string, string> = {
  "Magic Kingdom Resort Area": "🏰",
  "EPCOT Resort Area": "🌐",
  "Disney's Animal Kingdom Resort Area": "🦁",
  "Disney Springs Resort Area": "🛍️",
  "Wide World of Sports Resort Area": "🏟️",
};

/** Best-effort emoji for a resort `area` value; falls back to a pin glyph. */
export function areaEmoji(area: string): string {
  return AREA_EMOJI[area] ?? "📍";
}

/**
 * Distinct resort areas present in the catalog, most-populous first (ties
 * alphabetical) — mirrors the dining cuisine-chip ordering so the busiest
 * areas surface first as quick-filter chips.
 */
export function deriveAreas(catalog: Array<{ area: string | null }>): Array<string> {
  const counts = new Map<string, number>();
  for (const r of catalog) {
    if (r.area) counts.set(r.area, (counts.get(r.area) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([a]) => a);
}

/**
 * The "Where" segment scopes Stays by hotel operator, not by park — guests pick
 * a resort by who runs it, not its position relative to the theme parks. Only
 * Disney is bookable today; Universal is listed but disabled until its catalog
 * lands.
 */
export const STAY_OPERATORS: Array<{ key: string; label: string; available: boolean }> = [
  { key: "disney", label: "Disney", available: true },
  { key: "universal", label: "Universal", available: false },
];

/** Human-readable copy for Disney's `reasonsUnavailable` codes. */
export function reasonLabel(code: string | null): string {
  if (!code) return "Not available";
  if (code.includes("UNAVAILABLEROOMS")) return "Sold out for these dates";
  return "Not available";
}

/** Rate-shaping toggles that re-run the availability query when changed. */
export interface StayFilters {
  /** Surface Florida-resident nightly rates (uses a default WDW-area ZIP). */
  floridaResident: boolean;
  /** Limit to rooms with accessibility features. */
  accessible: boolean;
}

export const EMPTY_FILTERS: StayFilters = {
  floridaResident: false,
  accessible: false,
};

/** How many rate filters are active (drives the mobile badge / clear button). */
export function activeFilterCount(f: StayFilters): number {
  return (f.floridaResident ? 1 : 0) + (f.accessible ? 1 : 0);
}

export type StaySortKey = "recommended" | "price-asc" | "price-desc" | "name";

export const STAY_SORT_LABELS: Record<StaySortKey, string> = {
  recommended: "Recommended",
  "price-asc": "Price (low to high)",
  "price-desc": "Price (high to low)",
  name: "Name (A–Z)",
};

/** A sortable resort offer (structural subset of the availability result). */
interface SortableOffer {
  available: boolean;
  pricePerNight: number | null;
  name: string;
}

/**
 * Sort offers for the results grid. Unavailable resorts always sink to the
 * bottom; `recommended` keeps the server order (cheapest-available first).
 */
export function sortOffers<T extends SortableOffer>(offers: Array<T>, key: StaySortKey): Array<T> {
  if (key === "recommended") return offers;
  const arr = [...offers];
  const byName = (a: T, b: T) => a.name.localeCompare(b.name);
  const availFirst = (a: T, b: T) => (a.available === b.available ? 0 : a.available ? -1 : 1);
  switch (key) {
    case "price-asc":
      arr.sort(
        (a, b) =>
          availFirst(a, b) ||
          (a.pricePerNight ?? Infinity) - (b.pricePerNight ?? Infinity) ||
          byName(a, b),
      );
      break;
    case "price-desc":
      arr.sort(
        (a, b) =>
          availFirst(a, b) ||
          (b.pricePerNight ?? -Infinity) - (a.pricePerNight ?? -Infinity) ||
          byName(a, b),
      );
      break;
    case "name":
      arr.sort(byName);
      break;
  }
  return arr;
}
