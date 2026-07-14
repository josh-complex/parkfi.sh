import * as React from "react";

/**
 * Shared ride filter — one source of truth for the map (which ride markers show)
 * and the Waits list. Held in a context mounted at the dashboard shell so both
 * surfaces and the filter drawer stay in lockstep.
 */
/**
 * Optional map overlay layers, separate from the ride filter proper: additive
 * marker layers the map draws on top of its rides (dining venues, shops). Held
 * on the shared filter so the map and its on-map toggles stay in lockstep;
 * ignored by `rideMatchesFilter` (they don't gate the rides).
 */
export interface MapLayers {
  /** Plot bookable dining venues (restaurant_dim) as markers. */
  dining: boolean;
  /** Plot non-bookable walk-up dining — quick-service restaurants and snack
   *  carts/kiosks (restaurant_dim, `bookable = false`) — as markers. */
  quickService: boolean;
  /** Plot shops (shop_dim) as markers. */
  shops: boolean;
  /** Plot guest-service POIs (park_poi, category 'info') as markers. */
  services: boolean;
  /** Plot entertainment POIs (parades/fireworks/shows/character meets) as markers. */
  entertainment: boolean;
  /** Plot events + tours POIs (park_poi, category 'tour') as markers. */
  tours: boolean;
}

export interface RideFilter {
  /** Selected categories; empty set = all categories. */
  categories: Set<string>;
  /** Only rides currently OPERATING. */
  openOnly: boolean;
  /** Only rides whose standby wait is at/below this (minutes); null = no cap. */
  maxWait: number | null;
  /** Only rides with no height requirement (ride-anything-with-the-kids). */
  noHeightReq: boolean;
  /** Optional map overlay layers (map surface only). */
  layers: MapLayers;
}

export const EMPTY_RIDE_FILTER: RideFilter = {
  categories: new Set(),
  openOnly: false,
  maxWait: null,
  noHeightReq: false,
  layers: {
    dining: false,
    quickService: false,
    shops: false,
    services: false,
    entertainment: false,
    tours: false,
  },
};

/** Selectable categories (matches the marker icon set in park-map/shared.tsx). */
export const RIDE_CATEGORIES: ReadonlyArray<{ key: string; label: string; emoji: string }> = [
  { key: "thrill", label: "Thrill", emoji: "🎢" },
  { key: "attraction", label: "Rides", emoji: "🎡" },
  { key: "water", label: "Water", emoji: "💦" },
  { key: "show", label: "Shows", emoji: "🎭" },
  { key: "character", label: "Characters", emoji: "🐭" },
  { key: "dine", label: "Dining", emoji: "🍽️" },
  { key: "shop", label: "Shops", emoji: "🛍️" },
];

/** The standby thresholds offered by the "max wait" control. */
export const MAX_WAIT_OPTIONS: ReadonlyArray<number> = [15, 30, 45, 60];

/** True when any optional POI overlay layer (dining/shops/services/…) is on. */
export function anyMapLayerActive(layers: MapLayers): boolean {
  return (
    layers.dining ||
    layers.quickService ||
    layers.shops ||
    layers.services ||
    layers.entertainment ||
    layers.tours
  );
}

export function rideFilterActive(f: RideFilter): boolean {
  return f.categories.size > 0 || f.openOnly || f.maxWait != null || f.noHeightReq;
}

/** Does a ride pass the filter? Fields are normalized so both the map's
 *  `BoardItem` (meta.heightRequirement) and the Waits list's flat row work.
 *
 *  `emptyCategoriesMatchNone` flips the empty-set meaning: normally an empty
 *  category set means "no category filter, show all" (the Waits list), but on
 *  the map — where the category chips are explicit on/off toggles — deselecting
 *  every group must hide all ride markers rather than reveal them again. */
export function rideMatchesFilter(
  r: {
    category: string | null;
    status: string | null;
    standbyWait: number | null;
    heightRequirement: string | null;
  },
  f: RideFilter,
  opts?: { emptyCategoriesMatchNone?: boolean },
): boolean {
  if (f.categories.size === 0) {
    if (opts?.emptyCategoriesMatchNone) return false;
  } else if (r.category == null || !f.categories.has(r.category)) return false;
  if (f.openOnly && r.status !== "OPERATING") return false;
  if (f.maxWait != null && (r.standbyWait == null || r.standbyWait > f.maxWait)) return false;
  if (f.noHeightReq && r.heightRequirement != null) return false;
  return true;
}

type RideFilterCtx = {
  filter: RideFilter;
  setFilter: React.Dispatch<React.SetStateAction<RideFilter>>;
};
const RideFilterContext = React.createContext<RideFilterCtx | null>(null);

export function RideFilterProvider({ children }: { children: React.ReactNode }) {
  const [filter, setFilter] = React.useState<RideFilter>(EMPTY_RIDE_FILTER);
  const value = React.useMemo(() => ({ filter, setFilter }), [filter]);
  return <RideFilterContext.Provider value={value}>{children}</RideFilterContext.Provider>;
}

export function useRideFilter(): RideFilterCtx {
  const ctx = React.useContext(RideFilterContext);
  if (!ctx) throw new Error("useRideFilter must be used within a RideFilterProvider");
  return ctx;
}
