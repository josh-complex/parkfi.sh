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

export const diningStore = new Store<DiningState>({
  filters: DEFAULT_FILTERS,
  partySize: "2",
  sortKey: "park",
  page: 0,
  searched: false,
  stuck: false,
});

export function patchFilters(patch: Partial<ClientFilters>) {
  diningStore.setState((s) => ({ ...s, filters: { ...s.filters, ...patch }, page: 0 }));
}

export function clearExtraFilters() {
  diningStore.setState((s) => ({
    ...s,
    filters: {
      ...DEFAULT_FILTERS,
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
}

export function setStuck(v: boolean) {
  diningStore.setState((s) => ({ ...s, stuck: v }));
}

export function resetDiningStore() {
  diningStore.setState(() => ({
    filters: DEFAULT_FILTERS,
    partySize: "2",
    sortKey: "park",
    page: 0,
    searched: false,
    stuck: false,
  }));
}
