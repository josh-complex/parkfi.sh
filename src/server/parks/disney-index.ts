import {
  disneyAccessibilityLabels,
  disneyFacetLabels,
  disneyFacetTags,
  disneyHeightsFromFacets,
  heightRequirementLabel,
} from "./codes.ts";
import type { DisneyAttractionEntity, DisneyAttractionList } from "./schemas.ts";
import type { ParkPoiShowtime } from "#/db/schema.ts";

/**
 * Merge layer for the Disney destination-wide attractions/entertainment catalog
 * (research/disney-content-parity.md). Pure functions over an already-fetched
 * payload — the geo cron owns the fetching and the writes — mirroring
 * `universal-index.ts` on the other operator.
 *
 * What this feed is for: the typed facet slugs Disney publishes but the park
 * map markers only carry as prose (accessibility, thrill factors, heights),
 * plus a marker coordinate for entities `/children` never geocoded and today's
 * performance times for the entertainment POI layer.
 *
 * What it is deliberately NOT for: Lightning Lane and single rider. Both are
 * already derived from live queue capability, which agrees with these facets on
 * every joinable ride and also carries state and price. See §3.1 of the doc —
 * reading them from here would replace a live signal with a staler one.
 */

/** Every entity keyed the two ways we can join it, plus the label dictionary. */
export interface DisneyEntityIndex {
  /** Disney's numeric facility id — the durable join (see `external_ids`). */
  byFacilityId: Map<string, DisneyAttractionEntity>;
  /** Normalized display name — the fallback until facility ids are persisted. */
  byName: Map<string, DisneyAttractionEntity>;
  /** Facet slug -> guest-facing label, from the feed's own `flatFacets`. */
  labels: Map<string, string>;
}

/**
 * Loose join key for a Disney entity name. The feed decorates live names in
 * ways our board rows never carry, and each of these cost a real join in the
 * measured run:
 *  - trademark marks (`Indiana Jones™`)
 *  - a trailing newness flag (`Zootopia: Better Zoogether! - NEW!`,
 *    `Rock 'n' Roller Coaster Starring The Muppets — New!`)
 *  - a sponsor tail (`Test Track Presented by Chevrolet`), which our row may
 *    carry and the feed's may not, or the reverse
 * Seasonal re-skins (`Jingle Cruise`, `Soarin' Across America`) are genuinely
 * different names and stay unmatched — correctly, since their attributes differ.
 */
export function disneyJoinKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/[®™©]/g, "")
    .replace(/\s*[-–—]\s*new!?\s*$/i, "")
    .replace(/\s+presented by\b.*$/i, "")
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}

export function buildDisneyEntityIndex(list: DisneyAttractionList): DisneyEntityIndex {
  const byFacilityId = new Map<string, DisneyAttractionEntity>();
  const byName = new Map<string, DisneyAttractionEntity>();
  for (const entity of list.results) {
    if (entity.facilityId) byFacilityId.set(entity.facilityId, entity);
    const key = entity.name ? disneyJoinKey(entity.name) : "";
    // First writer wins: the feed carries a handful of near-duplicate names
    // (a show and its "…- NEW!" listing) that collapse to one key.
    if (key && !byName.has(key)) byName.set(key, entity);
  }
  return {
    byFacilityId,
    byName,
    labels: disneyFacetLabels(list.filters?.flatFacets),
  };
}

/** Facility id first (durable), display name second (best-effort). */
export function resolveDisneyEntity(
  index: DisneyEntityIndex,
  facilityId: string | null | undefined,
  name: string | null | undefined,
): DisneyAttractionEntity | null {
  if (facilityId) {
    const byId = index.byFacilityId.get(facilityId);
    if (byId) return byId;
  }
  if (name) {
    const byName = index.byName.get(disneyJoinKey(name));
    if (byName) return byName;
  }
  return null;
}

/** The `attraction_meta` fields this feed is authoritative for. */
export interface DisneyEntityAttrs {
  accessibility: Array<string>;
  tags: Array<string>;
  minHeightIn: number | null;
  maxHeightIn: number | null;
  /** Regenerated prose, used ONLY to fill a row the marker sweep left null. */
  heightRequirement: string | null;
  imageAlt: string | null;
}

export function disneyEntityAttrs(
  entity: DisneyAttractionEntity,
  labels: Map<string, string>,
): DisneyEntityAttrs {
  const facets = entity.facets ?? null;
  const { min, max } = disneyHeightsFromFacets(facets?.height);
  const media = entity.media?.finderStandardThumb ?? entity.media?.mapBubbleThumbLarge;
  return {
    accessibility: disneyAccessibilityLabels(facets, labels),
    tags: disneyFacetTags(facets, labels),
    minHeightIn: min,
    maxHeightIn: max,
    heightRequirement: heightRequirementLabel(min, max),
    imageAlt: media?.alt?.trim() || null,
  };
}

/** The entity's map point, when it publishes one. */
export function disneyEntityPoint(
  entity: DisneyAttractionEntity,
): { lat: number; lng: number } | null {
  const lat = entity.marker?.lat;
  const lng = entity.marker?.lng;
  return lat != null && lng != null && Number.isFinite(lat) && Number.isFinite(lng)
    ? { lat, lng }
    : null;
}

/** The marker's physical `point-of-interest` id — `park_poi.poi_id`'s key. */
export function disneyEntityPoiId(entity: DisneyAttractionEntity): string | null {
  return entity.marker?.id?.split(";")[0] || null;
}

/**
 * Today's performance times for `park_poi.schedule`. Entries with no start are
 * dropped (a closed day publishes the row with empty times), and an entity with
 * nothing left returns null so the upsert's coalesce keeps the last good list
 * rather than blanking a parade's times out on a fetch that raced midnight.
 */
export function disneyEntityShowtimes(
  entity: DisneyAttractionEntity,
): Array<ParkPoiShowtime> | null {
  const out: Array<ParkPoiShowtime> = [];
  for (const s of entity.schedule?.schedules ?? []) {
    if (s.isClosed || !s.startTime) continue;
    out.push({
      type: s.type ?? null,
      date: s.date ?? null,
      start: s.startTime,
      end: s.endTime ?? null,
    });
  }
  return out.length > 0 ? out : null;
}
