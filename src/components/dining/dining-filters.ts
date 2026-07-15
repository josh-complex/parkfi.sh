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
import type { SortDir, SortOption } from "#/components/ui/sort-menu.tsx";

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
  imageThumbhash: string | null;
  detailUrl: string | null;
  source: number;
  // Catalog attribute flags (DISNEY_DIRECT only; UOR rows are all false).
  walkupWaitList: boolean;
  mobileOrder: boolean;
  characterDining: boolean;
  fineDining: boolean;
  diningPackage: boolean;
  annualPassDiscount: boolean;
  disneyVisaDiscount: boolean;
  diningPlanQs: boolean;
  diningPlanTs: boolean;
  hasMenu: boolean;
  dinnerShow: boolean;
  requiresParkTicket: boolean;
  // True only for priority && bookable venues (the availability sweep set). When
  // false the venue is a cart / quick-service spot: the card shows a mobile-order
  // badge instead of a reservation grid.
  availabilityEligible: boolean;
  bookable: boolean;
}

/** Catalog-attribute toggles. Selecting several narrows to venues with ALL of them. */
export type FeatureKey =
  | "parkTicket"
  | "character"
  | "show"
  | "package"
  | "walkup"
  | "mobile"
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
  { key: "parkTicket", label: "Needs Park Entry", has: (r) => r.requiresParkTicket },
  { key: "character", label: "Character dining", has: (r) => r.characterDining },
  { key: "show", label: "Dinner show", has: (r) => r.dinnerShow },
  { key: "package", label: "Dining package", has: (r) => r.diningPackage },
  { key: "walkup", label: "No reservation needed", has: (r) => r.walkupWaitList },
  { key: "mobile", label: "Mobile order", has: (r) => r.mobileOrder },
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

/** Direction-neutral criterion labels — the arrow (or the direction toggle on
 *  desktop) conveys asc/desc. */
export const SORT_LABELS: Record<SortKey, string> = {
  park: "Park / Resort",
  availability: "Availability",
  name: "Name",
  price: "Price",
};

/** Drawer rows for the shared sort menu — each criterion is directional. */
export const SORT_OPTIONS: ReadonlyArray<SortOption<SortKey>> = [
  {
    key: "park",
    label: "Park / Resort",
    directional: true,
    defaultDir: "asc",
    ascHint: "A–Z",
    descHint: "Z–A",
  },
  {
    key: "availability",
    label: "Availability",
    directional: true,
    defaultDir: "asc",
    ascHint: "soonest first",
    descHint: "latest first",
  },
  {
    key: "name",
    label: "Name",
    directional: true,
    defaultDir: "asc",
    ascHint: "A–Z",
    descHint: "Z–A",
  },
  {
    key: "price",
    label: "Price",
    directional: true,
    defaultDir: "asc",
    ascHint: "low to high",
    descHint: "high to low",
  },
];

export type Operator = "ALL" | "disney" | "universal";

export const OPERATOR_LABELS: Record<Operator, string> = {
  ALL: "All",
  disney: "Disney",
  universal: "Universal",
};

export type AvailabilityFilter = "ALL" | "today" | "window";

export const AVAILABILITY_LABELS: Record<AvailabilityFilter, string> = {
  ALL: "Any availability",
  today: "Open today",
  window: "Open in window",
};

/**
 * Human labels for the `dining_interests` / `disney_favorites` taxonomy slugs
 * the finder tags venues with (the same slugs the `dining.picks` shelves group
 * on). Used to render taxonomy chips on the venue detail page. Unknown slugs are
 * dropped rather than shown raw.
 */
export const TAXONOMY_LABELS: Record<string, string> = {
  // diningInterests
  "character-dining-rec": "Character Dining",
  "fine-signature-dining-rec": "Signature & Fine Dining",
  "dining-events-rec": "Dining Events",
  // disneyFavorites (franchise affinity)
  "star-wars-rec": "Star Wars",
  "disney-princesses-rec": "Disney Princesses",
  "mickey-friends-rec": "Mickey & Friends",
  "pixar-rec": "Pixar",
};

/** Prettify a taxonomy slug, or null if we don't have a label for it. */
export function taxonomyLabel(slug: string): string | null {
  return TAXONOMY_LABELS[slug] ?? null;
}

/** Client-side narrowing state (party size + window drive the query separately). */
export interface ClientFilters {
  search: string;
  parkResort: string; // "ALL" or an exact park_resort value
  cuisine: string; // "ALL" or one core cuisine (matched within the venue's comma-separated list)
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
  /** Parks grouped by operator so the Park segment narrows to the chosen operator (`ALL` = every park). */
  parksByOperator: Record<Operator, string[]>;
  cuisines: string[];
  experiences: string[];
  prices: string[];
}

/**
 * Catalog `cuisine` values are comma-separated composites ("American, Seafood,
 * Steakhouse") drawn from a consistent core vocabulary. Split them so filter
 * options and matching work on the individual cuisines, not the composites.
 */
export function cuisineList(cuisine: string | null): Array<string> {
  if (!cuisine) return [];
  return cuisine
    .split(",")
    .map((c) => c.trim())
    .filter(Boolean);
}

/**
 * Keyword → emoji map for cuisine chips. Ordered: the first substring match wins,
 * so more specific / collision-prone terms ("barbecue" before "bar", "ice cream"
 * before "cream") come first. National cuisines get flags, dishes get food glyphs.
 */
const CUISINE_EMOJI: Array<readonly [string, string]> = [
  ["american", "🇺🇸"],
  ["italian", "🇮🇹"],
  ["mexican", "🇲🇽"],
  ["cuban", "🇨🇺"],
  ["chinese", "🇨🇳"],
  ["japanese", "🇯🇵"],
  ["korean", "🇰🇷"],
  ["thai", "🇹🇭"],
  ["indian", "🇮🇳"],
  ["french", "🇫🇷"],
  ["irish", "🇮🇪"],
  ["british", "🇬🇧"],
  ["english", "🇬🇧"],
  ["german", "🇩🇪"],
  ["spanish", "🇪🇸"],
  ["greek", "🇬🇷"],
  ["african", "🌍"],
  ["caribbean", "🏝️"],
  ["hawaiian", "🌺"],
  ["mediterranean", "🫒"],
  ["latin", "🌮"],
  ["sushi", "🍣"],
  ["seafood", "🦞"],
  ["steak", "🥩"],
  ["barbecue", "🍖"],
  ["bbq", "🍖"],
  ["pizza", "🍕"],
  ["burger", "🍔"],
  ["bakery", "🥐"],
  ["ice cream", "🍦"],
  ["dessert", "🍰"],
  ["coffee", "☕"],
  ["tea", "🍵"],
  ["café", "☕"],
  ["cafe", "☕"],
  ["sandwich", "🥪"],
  ["deli", "🥪"],
  ["buffet", "🍽️"],
  ["vegan", "🥗"],
  ["vegetarian", "🥗"],
  ["asian", "🥢"],
  ["pub", "🍺"],
  ["lounge", "🍸"],
  ["bar", "🍸"],
  ["grill", "🔥"],
];

/** Best-effort emoji for a cuisine label; falls back to a plate glyph. */
export function cuisineEmoji(cuisine: string): string {
  const key = cuisine.toLowerCase();
  for (const [needle, emoji] of CUISINE_EMOJI) {
    if (key.includes(needle)) return emoji;
  }
  return "🍽️";
}

/**
 * Best-effort deep link to Disney Mobile Order for a venue. Disney exposes no
 * public per-facility mobile-order URL — ordering lives in the My Disney
 * Experience app — so we link to the venue's official page, which hosts the
 * "Order Food" CTA that hands off to the app / web order flow. Returns null when
 * we have no detail URL (e.g. Universal venues).
 */
export function mobileOrderUrl(r: Pick<Restaurant, "detailUrl">): string | null {
  return r.detailUrl ?? null;
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
  const disneyParks = new Set<string>();
  const universalParks = new Set<string>();
  const cuisineCounts = new Map<string, number>();
  const experiences = new Set<string>();
  const prices = new Set<string>();
  for (const r of restaurants) {
    if (r.parkResort) {
      parks.add(r.parkResort);
      (operatorOf(r.source) === "universal" ? universalParks : disneyParks).add(r.parkResort);
    }
    for (const c of cuisineList(r.cuisine)) cuisineCounts.set(c, (cuisineCounts.get(c) ?? 0) + 1);
    if (r.experienceType) experiences.add(r.experienceType);
    const t = priceTier(r.priceRange);
    if (t) prices.add(t);
  }
  const sorted = (s: Set<string>) => [...s].sort((a, b) => a.localeCompare(b));
  return {
    parks: sorted(parks),
    parksByOperator: {
      ALL: sorted(parks),
      disney: sorted(disneyParks),
      universal: sorted(universalParks),
    },
    // Most-common cuisine first (ties broken alphabetically) so the quick-filter
    // chips surface the highest-signal options and the dropdown leads with them.
    cuisines: [...cuisineCounts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([c]) => c),
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
 * Active count for the post-search "extended filters" only — excludes the
 * facets promoted into the search pill (`operator`, `parkResort`, `cuisine`), so
 * the Filters badge reflects just what the drawer/controls own. Service
 * (`experienceType`) lives in the drawer now, so it counts here.
 */
export function countExtraFilters(f: ClientFilters): number {
  let n = 0;
  if (f.search.trim()) n++;
  if (f.experienceType !== "ALL") n++;
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
    if (f.cuisine !== "ALL" && !cuisineList(r.cuisine).includes(f.cuisine)) return false;
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
  sortDir: SortDir,
  referenceDate: string,
): Array<Restaurant> {
  const byName = (a: Restaurant, b: Restaurant) => a.name.localeCompare(b.name);
  const arr = [...list];
  // Flip the primary comparator for descending; the name tiebreak stays A–Z so
  // equal-key rows read consistently regardless of direction.
  const mul = sortDir === "desc" ? -1 : 1;
  switch (sortKey) {
    case "name":
      arr.sort((a, b) => mul * byName(a, b));
      break;
    case "price":
      arr.sort((a, b) => {
        const ra = priceTier(a.priceRange)?.length ?? 99;
        const rb = priceTier(b.priceRange)?.length ?? 99;
        return mul * (ra - rb) || byName(a, b);
      });
      break;
    case "availability":
      arr.sort((a, b) => {
        const cmp = nextAvailableDate(a, availability, referenceDate).localeCompare(
          nextAvailableDate(b, availability, referenceDate),
        );
        return mul * cmp || byName(a, b);
      });
      break;
    default:
      arr.sort(
        (a, b) => mul * (a.parkResort ?? "~").localeCompare(b.parkResort ?? "~") || byName(a, b),
      );
  }
  return arr;
}
