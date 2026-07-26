import {
  heightRequirementLabel,
  normalizeUniversalName,
  universalAccessibilityLabels,
  universalTypeLabels,
  UNIVERSAL_POI_BUCKETS,
  type PoiCategory,
} from "./codes.ts";
import type { UniversalTileInfo, UniversalRideFacts } from "./sources/universal-content.ts";
import type {
  UniversalPoi,
  UniversalPoiFeed,
  UniversalPoiRide,
  UniversalVenue,
} from "./schemas.ts";
import type { GeoPolygon, ParkPoiShowtime } from "#/db/schema.ts";

/**
 * Merge layer for the three Universal content feeds
 * (research/universal-content-parity.md). Pure functions over already-fetched
 * payloads — the geo cron owns the fetching and the writes; everything here is
 * unit-testable in isolation.
 *
 * Three sources, deliberately different jobs:
 *   • mobile POI feed — typed numeric attributes and the amenity/entertainment
 *     buckets. Covers USF/IOA/Volcano Bay fully; publishes NOTHING for Epic
 *     Universe beyond names and coords.
 *   • per-ride contentdata pages — the guest-facing attribute strip. The only
 *     Epic Universe source, and the most accurate height source everywhere
 *     (it distinguishes "No Minimum Height" from an unpublished field).
 *   • `filtersdata` tiles — card copy, real alt text and the interest/age
 *     taxonomy. No numeric attributes are taken from it (see universal-content.ts).
 *
 * The join is Universal's own display name, normalized — the same key the
 * existing places-feed enrichment uses. Our board carries standalone
 * "<Ride> Single Rider" rows that no feed has, so they resolve to their base
 * ride's attributes (and are flagged single-rider).
 */

/** Our park slug -> the mobile feed's numeric `VenueId`. */
export const UNIVERSAL_VENUE_ID_BY_SLUG: Record<string, number> = {
  "universal-studios-florida": 10010,
  "islands-of-adventure": 10000,
  "epic-universe": 24000,
  "volcano-bay": 13801,
};

/** Venue ids that are in-park (the only ones `park_poi` can take — it's NOT NULL
 *  on `park_id`), keyed the other way for the POI pass. */
export const UNIVERSAL_SLUG_BY_VENUE_ID: Record<number, string> = Object.fromEntries(
  Object.entries(UNIVERSAL_VENUE_ID_BY_SLUG).map(([slug, id]) => [id, slug]),
);

/**
 * Venues whose POI records actually carry ride ATTRIBUTES. Epic Universe is
 * deliberately absent: its records exist with names, coords and images, but the
 * attribute fields were never populated — every EU ride reports no height and
 * `false` for Express and child swap, including ones whose own page advertises
 * both. So EU's `false` is a default, not a fact, and only positives (from
 * either source) are believed there. Verified live 2026-07-25:
 * Express true on 1/12 EU rides in this feed vs 10/12 on their pages.
 */
const POI_ATTRIBUTE_VENUES = new Set([10010, 10000, 13801]);

const SINGLE_RIDER_SUFFIX = /\s+single\s+rider$/i;

/** Join key: normalized name, with our synthetic "Single Rider" suffix removed. */
export function rideJoinKey(name?: string | null): string {
  return normalizeUniversalName((name ?? "").replace(SINGLE_RIDER_SUFFIX, ""));
}

export interface UniversalContentIndex {
  /** venue id -> (join key -> ride/show record). */
  ridesByVenue: Map<number, Map<string, UniversalPoiRide>>;
  /** join key -> tile info (resort-wide; tiles carry their own venue keys). */
  tiles: Map<string, UniversalTileInfo>;
  /** join key -> per-ride page facts (resort-wide; ride names are unique). */
  rideFacts: Map<string, UniversalRideFacts>;
  /** Every POI record we might plot, bucketed by our own poi_type. */
  poisByVenue: Map<number, Array<TypedUniversalPoi>>;
  /** Numeric land id -> display name, for POI/land labels. */
  landById: Map<number, string>;
}

export interface TypedUniversalPoi {
  poi: UniversalPoi;
  poiType: string;
  category: PoiCategory;
}

/**
 * `Weather Shelter at …` entries live in the feed's `Events` bucket alongside
 * long-expired concert listings. They're a real in-park amenity, so they're
 * re-typed as one; the stale concerts are dropped rather than published as a
 * tours layer that would show 2024 dates (the doc's §3 "20 Events with
 * ticketing flags" is, live, 10 expired concerts + these 10 shelters).
 */
const WEATHER_SHELTER = /^weather shelter\b/i;

function isFutureEvent(poi: UniversalPoi): boolean {
  const dates = (poi as { Dates?: Array<{ StartDate?: string | null }> }).Dates ?? [];
  const now = Date.now();
  return dates.some((d) => {
    const t = d.StartDate ? Date.parse(d.StartDate) : Number.NaN;
    return Number.isFinite(t) && t > now;
  });
}

export function buildUniversalContentIndex(input: {
  pois: UniversalPoiFeed | null;
  tiles: Array<UniversalTileInfo>;
  rideFacts: Array<UniversalRideFacts>;
  lands: Array<{ id: number; name: string }>;
}): UniversalContentIndex {
  const ridesByVenue = new Map<number, Map<string, UniversalPoiRide>>();
  const poisByVenue = new Map<number, Array<TypedUniversalPoi>>();
  const tiles = new Map<string, UniversalTileInfo>();
  const rideFacts = new Map<string, UniversalRideFacts>();
  const landById = new Map<number, string>();

  for (const land of input.lands) landById.set(land.id, land.name);
  for (const tile of input.tiles) {
    if (tile.heading) tiles.set(rideJoinKey(tile.heading), tile);
  }
  for (const facts of input.rideFacts) {
    if (facts.heading) rideFacts.set(rideJoinKey(facts.heading), facts);
  }

  const feed = input.pois;
  if (feed) {
    // Rides + Shows + Parades all enrich attractions (our board carries UOR
    // shows as SHOW-type attractions); Shows/Parades that match no attraction
    // become the entertainment layer instead, decided by the caller.
    for (const record of [...feed.Rides, ...feed.Shows, ...feed.Parades]) {
      const venue = record.VenueId;
      const key = rideJoinKey(record.MblDisplayName);
      if (venue == null || !key) continue;
      let byName = ridesByVenue.get(venue);
      if (!byName) ridesByVenue.set(venue, (byName = new Map()));
      byName.set(key, record as UniversalPoiRide);
    }

    const push = (poi: UniversalPoi, poiType: string, category: PoiCategory) => {
      const venue = poi.VenueId;
      if (venue == null) return;
      let list = poisByVenue.get(venue);
      if (!list) poisByVenue.set(venue, (list = []));
      list.push({ poi, poiType, category });
    };

    for (const [bucket, mapping] of Object.entries(UNIVERSAL_POI_BUCKETS)) {
      for (const poi of (feed as unknown as Record<string, Array<UniversalPoi>>)[bucket] ?? []) {
        push(poi, mapping.poiType, mapping.category);
      }
    }
    for (const event of feed.Events) {
      if (WEATHER_SHELTER.test(event.MblDisplayName ?? "")) push(event, "weather-shelter", "info");
      else if (isFutureEvent(event)) push(event, "events-tours", "tour");
    }
  }

  return { ridesByVenue, tiles, rideFacts, poisByVenue, landById };
}

/** Everything the geo cron writes onto one UOR attraction's `attraction_meta`. */
export interface UniversalRideAttrs {
  heightRequirement: string | null;
  minHeightIn: number | null;
  maxHeightIn: number | null;
  expressPass: boolean | null;
  singleRider: boolean | null;
  childSwap: boolean | null;
  virtualLine: boolean | null;
  accessibility: Array<string>;
  funFact: string | null;
  tags: Array<string>;
  description: string | null;
  imageAlt: string | null;
  imageThumbUrl: string | null;
  imageHeroUrl: string | null;
  land: string | null;
  /** False when no feed knew this attraction — the caller then writes nothing. */
  matched: boolean;
}

/**
 * Resolve one attraction's Universal attributes.
 *
 * Height precedence is the ride page first: it's the only source that states
 * "No Minimum Height" explicitly, and it's right where the others disagree
 * (Punga Racers is 42" on its page and unset in the POI feed; Caro-Seuss-el is
 * "No Minimum Height" on its page and carries a bogus 34" bucket in
 * `filtersdata`). When a ride was found in a feed but NEITHER source names a
 * height, that's a published "no requirement", not an unknown — both sources
 * carry the field whenever one exists — so it resolves to 0. An attraction no
 * feed knows resolves to `matched: false` and is left untouched.
 */
export function resolveUniversalRideAttrs(
  index: UniversalContentIndex,
  venueId: number | null,
  attractionName: string,
): UniversalRideAttrs {
  const key = rideJoinKey(attractionName);
  const poi = venueId != null ? index.ridesByVenue.get(venueId)?.get(key) : undefined;
  const facts = index.rideFacts.get(key);
  const tile = index.tiles.get(key);
  const isSingleRiderRow = SINGLE_RIDER_SUFFIX.test(attractionName);

  const empty: UniversalRideAttrs = {
    heightRequirement: null,
    minHeightIn: null,
    maxHeightIn: null,
    expressPass: null,
    singleRider: null,
    childSwap: null,
    virtualLine: null,
    accessibility: [],
    funFact: null,
    tags: [],
    description: null,
    imageAlt: null,
    imageThumbUrl: null,
    imageHeroUrl: null,
    land: null,
    matched: false,
  };
  if (!poi && !facts && !tile) return empty;

  // Whether this venue's POI record can be read as a statement about
  // attributes at all (see POI_ATTRIBUTE_VENUES).
  const poiTrusted = venueId != null && POI_ATTRIBUTE_VENUES.has(venueId);

  /**
   * A published `true` from either source is believed. A `false` is only
   * believed from a POI record on a venue that populates attributes — a ride
   * page simply omitting a feature is weak evidence, and Epic Universe's POI
   * `false` is a default. Everything else stays `null` = not published, so the
   * UI can say nothing instead of asserting "no".
   */
  const flag = (poiValue: boolean | null | undefined, pageValue?: boolean): boolean | null => {
    if (poiValue === true || pageValue === true) return true;
    if (poiTrusted && poiValue === false) return false;
    return null;
  };

  // Only rides/shows carry heights; a tile-only match (a shop, a dining venue
  // that shares a name) must not be read as "no height requirement". Same for
  // an Epic Universe record with no page: the POI feed carries no height field
  // there at all, so its absence says nothing.
  // Shows and parades are the exception to the Epic Universe caveat: no
  // theatre show or street parade carries a height requirement, so the record
  // existing is itself the answer.
  const isShowRecord = poi?.Category === "Shows" || poi?.Category === "Parades";
  const heightKnown = facts != null || (poi != null && (poiTrusted || isShowRecord));
  const minHeightIn = heightKnown ? (facts?.minHeightIn ?? poi?.MinHeightInInches ?? 0) : null;
  const maxHeightIn = poi?.MaxHeightInInches ?? null;

  const tags = [
    ...universalTypeLabels(poi?.RideTypes ?? (poi as { ShowTypes?: Array<string> })?.ShowTypes),
    ...(facts?.rideTypes ?? []),
    ...(tile?.interests ?? []),
  ];

  return {
    heightRequirement: heightRequirementLabel(minHeightIn, maxHeightIn),
    minHeightIn,
    maxHeightIn,
    expressPass: flag(poi?.ExpressPassAccepted, facts?.expressPass),
    // A standalone "<Ride> Single Rider" board row IS the single-rider queue —
    // stronger evidence than either feed, which under-report it.
    singleRider: isSingleRiderRow ? true : flag(poi?.HasSingleRiderLine, facts?.singleRider),
    childSwap: flag(poi?.HasChildSwap, facts?.childSwap),
    virtualLine: flag(poi?.VirtualLine),
    accessibility: universalAccessibilityLabels(poi?.AccessibilityOptions),
    funFact: poi?.FunFact?.trim() || null,
    tags: [...new Set(tags)],
    // Tile copy is the marketing description; the POI feed's is the app blurb.
    // Prefer the longer of the two, matching the places-feed rule.
    description:
      [tile?.description, poi?.MblLongDescription, poi?.MblShortDescription]
        .map((d) => d?.trim() || null)
        .filter((d): d is string => d != null)
        .sort((a, b) => b.length - a.length)[0] ?? null,
    // Real alt text at last — 338/339 tiles carry it, where every other UOR
    // feed falls back to repeating the venue name.
    imageAlt: tile?.imageAlt ?? null,
    imageThumbUrl: poi?.ListImage ?? poi?.ThumbnailImage ?? tile?.imageTile ?? null,
    imageHeroUrl: tile?.imageHero ?? poi?.DetailImages?.[0] ?? null,
    land: tile?.land ?? (poi?.LandId != null ? (index.landById.get(poi.LandId) ?? null) : null),
    matched: true,
  };
}

// --- showtimes ------------------------------------------------------------

/**
 * Today's performances for a Universal show/parade POI, in the shared
 * `park_poi.schedule` shape. The feed publishes the same list twice —
 * `StartDateTimes` as dated ISO strings and `StartTimes` as bare wall clocks —
 * so we prefer the dated form and fall back to the other. No end times: the
 * mobile feed's `EndDateTimes` is empty in practice for the show buckets, and a
 * continuous act ("until park close") has no meaningful one.
 *
 * Null when nothing is published, so the POI upsert's coalesce keeps the last
 * good list rather than blanking a parade's times out.
 */
export function universalShowtimes(poi: UniversalPoi): Array<ParkPoiShowtime> | null {
  const record = poi as { StartDateTimes?: Array<string>; StartTimes?: Array<string> };
  const out: Array<ParkPoiShowtime> = [];
  for (const raw of record.StartDateTimes ?? []) {
    const [date, time] = raw.split("T");
    if (!time) continue;
    out.push({ type: "Performance Time", date: date || null, start: time.slice(0, 8), end: null });
  }
  if (out.length === 0) {
    for (const time of record.StartTimes ?? []) {
      if (!time.trim()) continue;
      out.push({ type: "Performance Time", date: null, start: time.trim(), end: null });
    }
  }
  return out.length > 0 ? out : null;
}

// --- venue geometry -------------------------------------------------------

/**
 * A venue's `GpsBoundary` ring -> a GeoJSON Polygon in `[lng, lat]` order, ring
 * closed.
 *
 * FALLBACK ONLY — this is a coarse containing hull (4–9 vertices per park),
 * not a traced perimeter, so it must never overwrite an OSM outline (which
 * runs 100–350 points). See `ingestUniversalVenueGeo`. Null for a venue
 * publishing fewer than three points.
 */
export function venueBoundary(
  venue: UniversalVenue,
): Extract<GeoPolygon, { type: "Polygon" }> | null {
  const ring = (venue.GpsBoundary ?? []).map((p) => [p.Longitude, p.Latitude] as [number, number]);
  if (ring.length < 3) return null;
  const [first] = ring;
  const last = ring[ring.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) ring.push([first[0], first[1]]);
  return { type: "Polygon", coordinates: [ring] };
}
