import { Store } from "@tanstack/store";

import {
  DEFAULT_FILTERS,
  type ClientFilters,
  type SortKey,
} from "#/components/dining/dining-filters.ts";
import type { SortDir } from "#/components/ui/sort-menu.tsx";

interface DiningState {
  filters: ClientFilters;
  partySize: string;
  sortKey: SortKey;
  sortDir: SortDir;
  page: number;
  searched: boolean;
  stuck: boolean;
}

const PARTY_SIZE_KEY = "parkfi:dining:party-size";
const DEFAULT_PARTY_SIZE = "2";

/** Read the remembered party size from localStorage, falling back to the default. */
function readStoredPartySize(): string {
  if (typeof window === "undefined") return DEFAULT_PARTY_SIZE;
  try {
    const v = window.localStorage.getItem(PARTY_SIZE_KEY);
    if (v && /^[1-8]$/.test(v)) return v;
  } catch {
    /* private mode / disabled storage — fall through to default */
  }
  return DEFAULT_PARTY_SIZE;
}

export const diningStore = new Store<DiningState>({
  filters: DEFAULT_FILTERS,
  // Always start from the default so server and first client render match; the
  // remembered value is hydrated post-mount via `hydratePartySize`.
  partySize: DEFAULT_PARTY_SIZE,
  sortKey: "park",
  sortDir: "asc",
  page: 0,
  searched: false,
  stuck: false,
});

/** Client-only: pull the remembered party size into the store after hydration. */
export function hydratePartySize() {
  const v = readStoredPartySize();
  if (v !== diningStore.state.partySize) {
    diningStore.setState((s) => ({ ...s, partySize: v }));
  }
}

export function patchFilters(patch: Partial<ClientFilters>) {
  diningStore.setState((s) => ({ ...s, filters: { ...s.filters, ...patch }, page: 0 }));
}

/**
 * Overwrite the URL-backed slice of state (filters + searched + sort + page) in
 * one shot — used to hydrate the board from the route's search params. Leaves
 * party size (localStorage-backed) and the sticky-bar flag untouched.
 */
export function applySearch(state: {
  filters: ClientFilters;
  searched: boolean;
  sortKey: SortKey;
  sortDir: SortDir;
  page: number;
}) {
  diningStore.setState((s) => ({
    ...s,
    filters: state.filters,
    searched: state.searched,
    sortKey: state.sortKey,
    sortDir: state.sortDir,
    page: state.page,
  }));
}

/**
 * Reset the extended (drawer/modal) filters back to defaults, preserving the
 * facets promoted into the search pill (operator / park / cuisine). Pass
 * `includePark` on mobile, where the park selector lives *in* the drawer, so its
 * "Clear all" also drops the park.
 */
export function clearExtraFilters(opts?: { includePark?: boolean }) {
  diningStore.setState((s) => ({
    ...s,
    filters: {
      ...DEFAULT_FILTERS,
      operator: s.filters.operator,
      parkResort: opts?.includePark ? DEFAULT_FILTERS.parkResort : s.filters.parkResort,
      cuisine: s.filters.cuisine,
    },
    page: 0,
  }));
}

export function commitSearch() {
  diningStore.setState((s) => ({ ...s, searched: true, page: 0 }));
}

export function setPage(p: number) {
  diningStore.setState((s) => ({ ...s, page: p }));
}

export function setSort(key: SortKey, dir: SortDir) {
  diningStore.setState((s) => ({ ...s, sortKey: key, sortDir: dir, page: 0 }));
}

export function setPartySize(v: string) {
  diningStore.setState((s) => ({ ...s, partySize: v, page: 0 }));
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(PARTY_SIZE_KEY, v);
    } catch {
      /* storage unavailable — selection still lives in memory for the session */
    }
  }
}

export function setStuck(v: boolean) {
  diningStore.setState((s) => ({ ...s, stuck: v }));
}

export function resetDiningStore() {
  diningStore.setState(() => ({
    filters: DEFAULT_FILTERS,
    // Kept in localStorage; re-hydrated on the next mount via hydratePartySize.
    partySize: DEFAULT_PARTY_SIZE,
    sortKey: "park",
    sortDir: "asc",
    page: 0,
    searched: false,
    stuck: false,
  }));
}
