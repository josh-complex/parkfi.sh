/**
 * Pure filter/sort/derivation helpers for the Dining board. The board fetches
 * the full priority restaurant set plus a single availability snapshot, so all
 * narrowing, sorting, and paging happen client-side over that data.
 */

import {
  isOpenLate,
  isOpenNow,
  servesBreakfast,
  type HoursFilter,
  type HoursMap,
} from "#/components/dining/dining-hours.ts";

// Operator/source ids (mirror of `Source` in src/server/parks/codes.ts; kept
// local so this client module never reaches across the server boundary).
const SOURCE_DISNEY = 3;
const SOURCE_UNIVERSAL = 4;

export interface Restaurant {
  facilityId: string;
  name: string;
  cuisine: string | null;
  experienceType: string | null;
  priceRange: string | null;
  parkResort: string | null;
  imageUrl: string | null;
  detailUrl: string | null;
  source: number;
  // Catalog attribute flags (DISNEY_DIRECT only; UOR rows are all false).
  walkupWaitList: boolean;
  mobileOrder: boolean;
  characterDining: boolean;
  fineDining: boolean;
  annualPassDiscount: boolean;
  disneyVisaDiscount: boolean;
  diningPlanQs: boolean;
  diningPlanTs: boolean;
  hasMenu: boolean;
  dinnerShow: boolean;
  requiresParkTicket: boolean;
}

/** Catalog-attribute toggles. Selecting several narrows to venues with ALL of them. */
export type FeatureKey =
  | "walkup"
  | "mobile"
  | "character"
  | "fine"
  | "annualPass"
  | "disneyVisa"
  | "planQs"
  | "planTs";

export const FEATURE_FILTERS: Array<{
  key: FeatureKey;
  label: string;
  has: (r: Restaurant) => boolean;
}> = [
  { key: "walkup", label: "No reservation needed", has: (r) => r.walkupWaitList },
  { key: "mobile", label: "Mobile order", has: (r) => r.mobileOrder },
  { key: "character", label: "Character dining", has: (r) => r.characterDining },
  { key: "fine", label: "Signature dining", has: (r) => r.fineDining },
  { key: "annualPass", label: "Passholder discount", has: (r) => r.annualPassDiscount },
  { key: "disneyVisa", label: "Disney Visa", has: (r) => r.disneyVisaDiscount },
  { key: "planQs", label: "Dining Plan (QS)", has: (r) => r.diningPlanQs },
  { key: "planTs", label: "Dining Plan (TS)", has: (r) => r.diningPlanTs },
];

const FEATURE_LABEL: Record<FeatureKey, string> = Object.fromEntries(
  FEATURE_FILTERS.map((f) => [f.key, f.label]),
) as Record<FeatureKey, string>;

const FEATURE_HAS: Record<FeatureKey, (r: Restaurant) => boolean> = Object.fromEntries(
  FEATURE_FILTERS.map((f) => [f.key, f.has]),
) as Record<FeatureKey, (r: Restaurant) => boolean>;

export interface DayEntry {
  date: string;
  available: boolean;
  offerCount: number;
  mealPeriods: string[];
  observedAt: string;
}

export interface AvailabilityEntry {
  facilityId: string;
  name: string;
  days: Array<DayEntry>;
}

export type AvailabilityMap = Map<string, AvailabilityEntry>;

export type SortKey = "park" | "name" | "availability" | "price";

export const SORT_LABELS: Record<SortKey, string> = {
  park: "Park / Resort",
  availability: "Soonest availability",
  name: "Name (A–Z)",
  price: "Price (low to high)",
};

export type Operator = "ALL" | "disney" | "universal";

export const OPERATOR_LABELS: Record<Operator, string> = {
  ALL: "All operators",
  disney: "Disney",
  universal: "Universal",
};

export type AvailabilityFilter = "ALL" | "today" | "window";

export const AVAILABILITY_LABELS: Record<AvailabilityFilter, string> = {
  ALL: "Any availability",
  today: "Open today",
  window: "Open in window",
};

/** Client-side narrowing state (party size + window drive the query separately). */
export interface ClientFilters {
  search: string;
  parkResort: string; // "ALL" or an exact park_resort value
  cuisine: string; // "ALL" or an exact cuisine value
  experienceType: string; // "ALL" or an exact experience_type value
  operator: Operator;
  prices: string[]; // selected price tiers ("$", "$$", …); empty = all
  availability: AvailabilityFilter;
  features: FeatureKey[]; // catalog attribute flags; AND semantics, empty = all
  hours: HoursFilter; // operating-hours narrowing (open now / breakfast / late)
}

export const DEFAULT_FILTERS: ClientFilters = {
  search: "",
  parkResort: "ALL",
  cuisine: "ALL",
  experienceType: "ALL",
  operator: "ALL",
  prices: [],
  availability: "ALL",
  features: [],
  hours: "ALL",
};

export interface FilterOptions {
  parks: string[];
  cuisines: string[];
  experiences: string[];
  prices: string[];
}

/** Leading `$` run of a price-range string ("$$ ($15–$34.99)") → "$$". */
export function priceTier(priceRange: string | null): string | null {
  if (!priceRange) return null;
  const m = /^\$+/.exec(priceRange.trim());
  return m ? m[0] : null;
}

function operatorOf(source: number): Operator {
  if (source === SOURCE_UNIVERSAL) return "universal";
  if (source === SOURCE_DISNEY) return "disney";
  return "disney";
}

/** Distinct, sorted option lists for the filter controls, derived from data. */
export function deriveOptions(restaurants: Array<Restaurant>): FilterOptions {
  const parks = new Set<string>();
  const cuisines = new Set<string>();
  const experiences = new Set<string>();
  const prices = new Set<string>();
  for (const r of restaurants) {
    if (r.parkResort) parks.add(r.parkResort);
    if (r.cuisine) cuisines.add(r.cuisine);
    if (r.experienceType) experiences.add(r.experienceType);
    const t = priceTier(r.priceRange);
    if (t) prices.add(t);
  }
  return {
    parks: [...parks].sort((a, b) => a.localeCompare(b)),
    cuisines: [...cuisines].sort((a, b) => a.localeCompare(b)),
    experiences: [...experiences].sort((a, b) => a.localeCompare(b)),
    prices: [...prices].sort((a, b) => a.length - b.length),
  };
}

export function countActiveFilters(f: ClientFilters): number {
  let n = 0;
  if (f.search.trim()) n++;
  if (f.parkResort !== "ALL") n++;
  if (f.cuisine !== "ALL") n++;
  if (f.experienceType !== "ALL") n++;
  if (f.operator !== "ALL") n++;
  if (f.prices.length) n++;
  if (f.availability !== "ALL") n++;
  if (f.features.length) n++;
  if (f.hours !== "ALL") n++;
  return n;
}

/**
 * Active count for the post-search "extended filters" only — excludes the three
 * facets promoted into the search pill (`parkResort`, `cuisine`, `experienceType`),
 * so the Filters badge reflects just what the drawer/controls own.
 */
export function countExtraFilters(f: ClientFilters): number {
  let n = 0;
  if (f.search.trim()) n++;
  if (f.operator !== "ALL") n++;
  if (f.prices.length) n++;
  if (f.availability !== "ALL") n++;
  if (f.features.length) n++;
  if (f.hours !== "ALL") n++;
  return n;
}

export function filterRestaurants(
  restaurants: Array<Restaurant>,
  availability: AvailabilityMap,
  f: ClientFilters,
  referenceDate: string,
  hours: HoursMap,
  nowMin: number,
): Array<Restaurant> {
  const q = f.search.trim().toLowerCase();
  return restaurants.filter((r) => {
    if (q && !r.name.toLowerCase().includes(q)) return false;
    if (f.parkResort !== "ALL" && r.parkResort !== f.parkResort) return false;
    if (f.cuisine !== "ALL" && r.cuisine !== f.cuisine) return false;
    if (f.experienceType !== "ALL" && r.experienceType !== f.experienceType) return false;
    if (f.operator !== "ALL" && operatorOf(r.source) !== f.operator) return false;
    if (f.prices.length) {
      const t = priceTier(r.priceRange);
      if (!t || !f.prices.includes(t)) return false;
    }
    if (f.features.length && !f.features.every((k) => FEATURE_HAS[k](r))) return false;
    if (f.hours !== "ALL") {
      const sched = hours.get(r.facilityId);
      if (!sched) return false;
      if (f.hours === "now" && !isOpenNow(sched, nowMin)) return false;
      if (f.hours === "breakfast" && !servesBreakfast(sched)) return false;
      if (f.hours === "late" && !isOpenLate(sched)) return false;
    }
    if (f.availability !== "ALL") {
      const a = availability.get(r.facilityId);
      if (f.availability === "today") {
        const td = a?.days.find((d) => d.date === referenceDate);
        if (!td?.available) return false;
      } else if (!a?.days.some((d) => d.available)) {
        return false;
      }
    }
    return true;
  });
}

/** Human labels for the active feature/hours filters (for summary chips). */
export function featureLabels(keys: Array<FeatureKey>): Array<string> {
  return keys.map((k) => FEATURE_LABEL[k]);
}

/** Soonest available service date on/after the reference day, or a sentinel that sorts last. */
function nextAvailableDate(
  r: Restaurant,
  availability: AvailabilityMap,
  referenceDate: string,
): string {
  const a = availability.get(r.facilityId);
  const d = a?.days.find((x) => x.available && x.date >= referenceDate);
  return d?.date ?? "9999-99-99";
}

export function sortRestaurants(
  list: Array<Restaurant>,
  availability: AvailabilityMap,
  sortKey: SortKey,
  referenceDate: string,
): Array<Restaurant> {
  const byName = (a: Restaurant, b: Restaurant) => a.name.localeCompare(b.name);
  const arr = [...list];
  switch (sortKey) {
    case "name":
      arr.sort(byName);
      break;
    case "price":
      arr.sort((a, b) => {
        const ra = priceTier(a.priceRange)?.length ?? 99;
        const rb = priceTier(b.priceRange)?.length ?? 99;
        return ra - rb || byName(a, b);
      });
      break;
    case "availability":
      arr.sort((a, b) => {
        const cmp = nextAvailableDate(a, availability, referenceDate).localeCompare(
          nextAvailableDate(b, availability, referenceDate),
        );
        return cmp || byName(a, b);
      });
      break;
    default:
      arr.sort((a, b) => (a.parkResort ?? "~").localeCompare(b.parkResort ?? "~") || byName(a, b));
  }
  return arr;
}
