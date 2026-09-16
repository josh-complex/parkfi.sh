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
  /**
   * Selected park slugs; empty set = every park. Written by both faces of the
   * same control — the Waits band's park strip and the filter rail's Parks
   * checkboxes (docs/plans/waits-redesign §2.2) — so pressing a card in the
   * strip and ticking its box in the rail are literally the same state change.
   *
   * The map ignores it: that surface is already scoped to one park, so a park
   * filter there is either a no-op or a way to blank the map.
   */
  parks: Set<string>;
  /**
   * Free-text name search, trimmed but not lower-cased (the test does that).
   * Empty string = no search. The map never sets it, so the test is inert
   * there — the header's omnisearch is that surface's find-a-ride.
   */
  query: string;
  /** Selected categories; empty set = all categories. */
  categories: Set<string>;
  /** Only rides currently OPERATING. */
  openOnly: boolean;
  /** Only rides whose standby wait is at/below this (minutes); null = no cap. */
  maxWait: number | null;
  /** Only rides with no height requirement (ride-anything-with-the-kids). */
  noHeightReq: boolean;
  /**
   * "What can a rider this tall get on" — inches. Mutually exclusive with
   * `noHeightReq` in the UI (that's just the 0" case, phrased for parents of
   * toddlers). Rides whose minimum height we don't know are excluded rather
   * than assumed rideable.
   */
  heightBand: number | null;
  /** Only rides that accept Universal Express Pass. */
  expressPass: boolean;
  /** Only rides with a single rider line. */
  singleRider: boolean;
  /** Only rides that offer child swap / rider switch. */
  childSwap: boolean;
  /** Optional map overlay layers (map surface only). */
  layers: MapLayers;
}

export const EMPTY_RIDE_FILTER: RideFilter = {
  parks: new Set(),
  query: "",
  categories: new Set(),
  openOnly: false,
  maxWait: null,
  noHeightReq: false,
  heightBand: null,
  expressPass: false,
  singleRider: false,
  childSwap: false,
  layers: {
    dining: false,
    quickService: false,
    shops: false,
    services: false,
    entertainment: false,
    tours: false,
  },
};

/** Selectable categories (matches the marker icon set in park-map/shared.tsx).
 *  `house` is the one key that isn't a stored `category` — see `rideTypeKey`. */
export const RIDE_CATEGORIES: ReadonlyArray<{ key: string; label: string; emoji: string }> = [
  { key: "thrill", label: "Thrill", emoji: "🎢" },
  { key: "attraction", label: "Rides", emoji: "🎡" },
  { key: "water", label: "Water", emoji: "💦" },
  { key: "house", label: "Houses", emoji: "🏚️" },
  { key: "show", label: "Shows", emoji: "🎭" },
  { key: "character", label: "Characters", emoji: "🐭" },
  { key: "dine", label: "Dining", emoji: "🍽️" },
  { key: "shop", label: "Shops", emoji: "🛍️" },
];

/**
 * The type a row *reads* as, which is its stored `category` except for a
 * Halloween Horror Nights house. Universal files its event mazes as ordinary
 * `attraction` rows and separates them only with a tag (`HAUNTED_HOUSE_TAG`),
 * so a board with the event standing showed ten rows all typed "Rides" — the
 * one fact a guest holding an event ticket already knew. A house is its own
 * type here and nowhere else: nothing is written back, the ingest keeps its
 * vocabulary, and a row whose surface doesn't carry the tag (the map's
 * `BoardItem`) just falls through to its category.
 *
 * It is also why picking "Rides" no longer returns houses — they aren't rides,
 * they run on event nights only, and every park average already excludes them.
 */
export function rideTypeKey(r: {
  category: string | null;
  hauntedHouse?: boolean | null;
}): string | null {
  return r.hauntedHouse === true ? "house" : r.category;
}

/** The standby thresholds offered by the "max wait" control. */
export const MAX_WAIT_OPTIONS: ReadonlyArray<number> = [15, 30, 45, 60];

/** Rider heights (inches) offered by the height-band control — the operators'
 *  own published bands, so each one is a real cut-off somewhere. */
export const HEIGHT_BAND_OPTIONS: ReadonlyArray<number> = [36, 40, 42, 44, 48, 52];

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
  return (
    f.parks.size > 0 ||
    f.query.trim().length > 0 ||
    f.categories.size > 0 ||
    f.openOnly ||
    f.maxWait != null ||
    f.noHeightReq ||
    f.heightBand != null ||
    f.expressPass ||
    f.singleRider ||
    f.childSwap
  );
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
    /** Absent on rows that have no name to search — the test is skipped. */
    name?: string;
    category: string | null;
    status: string | null;
    standbyWait: number | null;
    heightRequirement: string | null;
    /** Absent on the map's `BoardItem` — see `RideFilter.parks`. */
    parkSlug?: string | null;
    minHeightIn?: number | null;
    expressPass?: boolean | null;
    singleRider?: boolean | null;
    childSwap?: boolean | null;
    /** Absent on the map's `BoardItem`, which doesn't carry the tag — such a
     *  row simply types as its category (see `rideTypeKey`). */
    hauntedHouse?: boolean | null;
  },
  f: RideFilter,
  opts?: { emptyCategoriesMatchNone?: boolean },
): boolean {
  // A row with no park slug (the map's items) can't be park-filtered; an empty
  // set means "every park" on both surfaces.
  if (f.parks.size > 0 && r.parkSlug != null && !f.parks.has(r.parkSlug)) return false;
  const q = f.query.trim().toLowerCase();
  if (q.length > 0 && r.name != null && !r.name.toLowerCase().includes(q)) return false;
  if (f.categories.size === 0) {
    if (opts?.emptyCategoriesMatchNone) return false;
  } else {
    const type = rideTypeKey(r);
    if (type == null || !f.categories.has(type)) return false;
  }
  if (f.openOnly && r.status !== "OPERATING") return false;
  if (f.maxWait != null && (r.standbyWait == null || r.standbyWait > f.maxWait)) return false;
  // `minHeightIn` is the answer whenever we have it — including the explicit 0
  // that Disney publishes as the prose "Any Height", which the old
  // `heightRequirement != null` test wrongly read as *having* a requirement.
  // Rides with neither field fall back to the old behaviour (treated as no
  // requirement) so nothing that used to show up disappears.
  if (f.noHeightReq) {
    const known = r.minHeightIn ?? null;
    if (known != null ? known > 0 : r.heightRequirement != null) return false;
  }
  // Height bands are the opposite: an unknown minimum is excluded rather than
  // presented to a parent as "your 42-incher can ride this".
  if (f.heightBand != null && (r.minHeightIn == null || r.minHeightIn > f.heightBand)) return false;
  // The operator-attribute chips only ever narrow to a published `true`.
  if (f.expressPass && r.expressPass !== true) return false;
  if (f.singleRider && r.singleRider !== true) return false;
  if (f.childSwap && r.childSwap !== true) return false;
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
