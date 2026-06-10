/**
 * Pure filter/sort/derivation helpers for the Dining board. The board fetches
 * the full priority restaurant set plus a single availability snapshot, so all
 * narrowing, sorting, and paging happen client-side over that data.
 */

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
}

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
}

export const DEFAULT_FILTERS: ClientFilters = {
  search: "",
  parkResort: "ALL",
  cuisine: "ALL",
  experienceType: "ALL",
  operator: "ALL",
  prices: [],
  availability: "ALL",
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
  return n;
}

export function filterRestaurants(
  restaurants: Array<Restaurant>,
  availability: AvailabilityMap,
  f: ClientFilters,
  todayStr: string,
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
    if (f.availability !== "ALL") {
      const a = availability.get(r.facilityId);
      if (f.availability === "today") {
        const td = a?.days.find((d) => d.date === todayStr);
        if (!td?.available) return false;
      } else if (!a?.days.some((d) => d.available)) {
        return false;
      }
    }
    return true;
  });
}

/** Soonest available service date on/after today, or a sentinel that sorts last. */
function nextAvailableDate(r: Restaurant, availability: AvailabilityMap, todayStr: string): string {
  const a = availability.get(r.facilityId);
  const d = a?.days.find((x) => x.available && x.date >= todayStr);
  return d?.date ?? "9999-99-99";
}

export function sortRestaurants(
  list: Array<Restaurant>,
  availability: AvailabilityMap,
  sortKey: SortKey,
  todayStr: string,
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
        const cmp = nextAvailableDate(a, availability, todayStr).localeCompare(
          nextAvailableDate(b, availability, todayStr),
        );
        return cmp || byName(a, b);
      });
      break;
    default:
      arr.sort((a, b) => (a.parkResort ?? "~").localeCompare(b.parkResort ?? "~") || byName(a, b));
  }
  return arr;
}

/** Shared props for the desktop filter bar and the mobile control drawers. */
export interface DiningControlsProps {
  filters: ClientFilters;
  onFilters: (patch: Partial<ClientFilters>) => void;
  options: FilterOptions;
  sortKey: SortKey;
  onSortKey: (k: SortKey) => void;
  partySize: string;
  onPartySize: (v: string) => void;
  days: string;
  onDays: (v: string) => void;
  activeCount: number;
  onClear: () => void;
}

export const DAYS_OPTIONS = [
  { value: "7", label: "7d" },
  { value: "14", label: "14d" },
  { value: "30", label: "30d" },
];
