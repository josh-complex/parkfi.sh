import { Store } from "@tanstack/store";

import {
  DEFAULT_FILTERS,
  type ClientFilters,
  type SortKey,
} from "#/components/dining/dining-filters.ts";

interface DiningState {
  filters: ClientFilters;
  partySize: string;
  sortKey: SortKey;
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

export function clearExtraFilters() {
  diningStore.setState((s) => ({
    ...s,
    filters: {
      ...DEFAULT_FILTERS,
      operator: s.filters.operator,
      parkResort: s.filters.parkResort,
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

export function setSortKey(k: SortKey) {
  diningStore.setState((s) => ({ ...s, sortKey: k, page: 0 }));
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
    page: 0,
    searched: false,
    stuck: false,
  }));
}
