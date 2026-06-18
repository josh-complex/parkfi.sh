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
