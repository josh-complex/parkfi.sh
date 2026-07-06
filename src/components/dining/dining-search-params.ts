/**
 * URL <-> store bridge for the Dining board. The board's working state lives in
 * `diningStore`, but the *committed* search (quick cuisine chips, the search
 * pill, the filter drawer) is mirrored into the `/dining` route's search params
 * so it survives navigation: tap a chip → open a restaurant → Back returns to
 * the filtered results, not the browse home. It also makes a filtered search a
 * shareable/bookmarkable link.
 */

import {
  DEFAULT_FILTERS,
  FEATURE_FILTERS,
  OPERATOR_LABELS,
  type AvailabilityFilter,
  type ClientFilters,
  type FeatureKey,
  type Operator,
  type SortKey,
} from "#/components/dining/dining-filters.ts";
import type { HoursFilter } from "#/components/dining/dining-hours.ts";

/** The slice of board state that round-trips through the URL. */
export interface DiningSearchState {
  filters: ClientFilters;
  searched: boolean;
  sortKey: SortKey;
  page: number;
}

/** Validated `/dining` search params. Defaults are omitted rather than encoded. */
export interface DiningSearch {
  q?: string;
  park?: string;
  cuisine?: string;
  experience?: string;
  operator?: Exclude<Operator, "ALL">;
  prices?: string[];
  avail?: Exclude<AvailabilityFilter, "ALL">;
  features?: FeatureKey[];
  hours?: Exclude<HoursFilter, "ALL">;
  sort?: Exclude<SortKey, "park">;
  page?: number;
  /** Set once the user commits a search — distinguishes "browse home" from a
   *  committed search that happens to have no active narrowing. */
  s?: boolean;
}

const FEATURE_KEYS = new Set<string>(FEATURE_FILTERS.map((f) => f.key));

function isFeatureKey(v: string): v is FeatureKey {
  return FEATURE_KEYS.has(v);
}

/** Coerce raw (untrusted) URL search into a typed `DiningSearch`. */
export function validateDiningSearch(search: Record<string, unknown>): DiningSearch {
  const str = (v: unknown): string | undefined =>
    typeof v === "string" && v.length ? v : undefined;
  const strArray = (v: unknown): string[] | undefined => {
    const arr = Array.isArray(v) ? v : typeof v === "string" && v ? [v] : [];
    const out = arr.filter((x): x is string => typeof x === "string" && x.length > 0);
    return out.length ? out : undefined;
  };

  const operator =
    search.operator === "disney" || search.operator === "universal" ? search.operator : undefined;
  const avail = search.avail === "today" || search.avail === "window" ? search.avail : undefined;
  const hours =
    search.hours === "now" || search.hours === "breakfast" || search.hours === "late"
      ? search.hours
      : undefined;
  const sort =
    search.sort === "name" || search.sort === "availability" || search.sort === "price"
      ? search.sort
      : undefined;

  let page: number | undefined;
  if (typeof search.page === "number" && Number.isInteger(search.page) && search.page > 0) {
    page = search.page;
  } else if (typeof search.page === "string" && /^\d+$/.test(search.page)) {
    const n = Number(search.page);
    page = n > 0 ? n : undefined;
  }

  const features = strArray(search.features)?.filter(isFeatureKey);
  const truthy = search.s === true || search.s === "true" || search.s === 1 || search.s === "1";

  return {
    q: str(search.q),
    park: str(search.park),
    cuisine: str(search.cuisine),
    experience: str(search.experience),
    operator,
    prices: strArray(search.prices),
    avail,
    features: features?.length ? features : undefined,
    hours,
    sort,
    page,
    s: truthy ? true : undefined,
  };
}

/** Board state → URL search. Returns `{}` (a clean `/dining`) before any search. */
export function stateToSearch(state: DiningSearchState): DiningSearch {
  if (!state.searched) return {};
  const f = state.filters;
  const out: DiningSearch = { s: true };
  const q = f.search.trim();
  if (q) out.q = q;
  if (f.parkResort !== "ALL") out.park = f.parkResort;
  if (f.cuisine !== "ALL") out.cuisine = f.cuisine;
  if (f.experienceType !== "ALL") out.experience = f.experienceType;
  if (f.operator !== "ALL") out.operator = f.operator;
  if (f.prices.length) out.prices = f.prices;
  if (f.availability !== "ALL") out.avail = f.availability;
  if (f.features.length) out.features = f.features;
  if (f.hours !== "ALL") out.hours = f.hours;
  if (state.sortKey !== "park") out.sort = state.sortKey;
  if (state.page > 0) out.page = state.page;
  return out;
}

/** URL search → board state, filling defaults for anything absent. */
export function searchToState(search: DiningSearch): DiningSearchState {
  const filters: ClientFilters = {
    ...DEFAULT_FILTERS,
    search: search.q ?? "",
    parkResort: search.park ?? "ALL",
    cuisine: search.cuisine ?? "ALL",
    experienceType: search.experience ?? "ALL",
    operator: search.operator ?? "ALL",
    prices: search.prices ?? [],
    availability: search.avail ?? "ALL",
    features: search.features ?? [],
    hours: search.hours ?? "ALL",
  };
  return {
    filters,
    searched: !!search.s,
    sortKey: search.sort ?? "park",
    page: search.page ?? 0,
  };
}

/**
 * Human-readable breadcrumb trail for a committed search — the primary "where
 * you are in dining" facets (operator → park → cuisine → service), in order.
 * Drawer refinements (price, hours, features…) stay in the carried link so a
 * crumb tap restores them, but are left out of the trail to keep it legible.
 */
export function diningTrail(search: DiningSearch): string[] {
  const f = searchToState(search).filters;
  const out: string[] = [];
  if (f.operator !== "ALL") out.push(OPERATOR_LABELS[f.operator]);
  if (f.parkResort !== "ALL") out.push(f.parkResort);
  if (f.cuisine !== "ALL") out.push(f.cuisine);
  if (f.experienceType !== "ALL") out.push(f.experienceType);
  return out;
}

/** Order-stable key for comparing two `DiningSearch` values (loop-guard). */
export function diningSearchKey(s: DiningSearch): string {
  return JSON.stringify([
    s.q ?? "",
    s.park ?? "",
    s.cuisine ?? "",
    s.experience ?? "",
    s.operator ?? "",
    s.prices ?? [],
    s.avail ?? "",
    s.features ?? [],
    s.hours ?? "",
    s.sort ?? "",
    s.page ?? 0,
    !!s.s,
  ]);
}
