/**
 * In-park amenities from OpenStreetMap, via the same Overpass API the boundary
 * query uses (research/disney-content-parity.md §4).
 *
 * Why this exists: neither operator publishes amenities per location. Disney's
 * finder plots ONE representative marker per service entity per park — every
 * `info` entity name in `park_poi` appears exactly six times, so Magic Kingdom
 * has a single restroom pin standing in for the whole park — and Epic Universe
 * publishes no amenities at all. OSM maps them individually: 30 toilets inside
 * Magic Kingdom alone, 213 across the WDW property, 44 around the UOR parks.
 *
 * Rows land under `Source.OSM` so the (park_id, source)-scoped soft-delete can
 * never let a community-mapped pin overwrite an operator-published one, and
 * each keeps its OSM element id so a re-run is idempotent.
 *
 * Licensing: OSM data is ODbL — attribution is required wherever these render,
 * the same obligation the boundary polygons already carry.
 */
import { osmPoiName, osmPoiType } from "../codes.ts";
import { config } from "../config.ts";

import { UpstreamError } from "./themeparks.ts";

export interface OsmAmenity {
  /** Stable across runs: `osm.node/123456`, the `park_poi.poi_id` we write. */
  id: string;
  poiType: string;
  name: string;
  lat: number;
  lng: number;
}

interface OverpassAmenityElement {
  type: string;
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

/** The tag set `osmPoiType` understands, as an Overpass regex alternation. */
const AMENITY_TAGS = [
  "toilets",
  "drinking_water",
  "water_point",
  "atm",
  "bank",
  "bureau_de_change",
  "first_aid",
  "charging_station",
  "locker",
  "smoking_area",
  "baby_hatch",
  "nursery",
].join("|");

/**
 * Every mappable amenity in `bbox` ([s,w,n,e]). One query for the whole resort
 * area — the caller assigns each node to a park by point-in-polygon against the
 * stored boundary, because a bbox around a park inevitably swallows its
 * neighbours (an Epic Universe bbox drawn a few hundredths of a degree wrong
 * returns SeaWorld's restrooms).
 *
 * `out tags center` gives ways and relations a centroid, so a mapped restroom
 * BUILDING is as usable as a mapped restroom node.
 */
export async function fetchOsmAmenities(
  bbox: [number, number, number, number],
  signal: AbortSignal,
): Promise<Array<OsmAmenity>> {
  const [s, w, n, e] = bbox;
  const query = `[out:json][timeout:90];
(
  nwr["amenity"~"^(${AMENITY_TAGS})$"](${s},${w},${n},${e});
  nwr["healthcare"="first_aid"](${s},${w},${n},${e});
);
out tags center;`;
  const res = await fetch(config.overpassBase, {
    method: "POST",
    signal,
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "user-agent": config.userAgent,
    },
    body: `data=${encodeURIComponent(query)}`,
  });
  if (!res.ok) throw new UpstreamError(`Overpass -> ${res.status}`, res.status);
  const json = (await res.json()) as { elements?: Array<OverpassAmenityElement> };

  const out: Array<OsmAmenity> = [];
  for (const el of json.elements ?? []) {
    const poiType = osmPoiType(el.tags);
    if (!poiType) continue;
    const lat = el.lat ?? el.center?.lat;
    const lng = el.lon ?? el.center?.lon;
    if (lat == null || lng == null) continue;
    out.push({
      id: `osm.${el.type}/${el.id}`,
      poiType,
      name: osmPoiName(poiType, el.tags),
      lat,
      lng,
    });
  }
  return out;
}

/**
 * Point-in-polygon (ray casting) against a stored `parks.boundary` GeoJSON
 * geometry, in [lng,lat] order. Holes count as outside, which is what we want:
 * a restroom in a courtyard cut out of the park outline isn't in the park.
 */
export function pointInGeometry(
  point: { lat: number; lng: number },
  geometry: {
    type: "Polygon" | "MultiPolygon";
    coordinates: Array<Array<[number, number]>> | Array<Array<Array<[number, number]>>>;
  },
): boolean {
  const polygons = (
    geometry.type === "Polygon"
      ? [geometry.coordinates as Array<Array<[number, number]>>]
      : (geometry.coordinates as Array<Array<Array<[number, number]>>>)
  ).filter((p) => p.length > 0);
  for (const rings of polygons) {
    if (!inRing(point, rings[0])) continue;
    // Inside the outer ring — only counts if it's in none of the holes.
    if (rings.slice(1).some((hole) => inRing(point, hole))) continue;
    return true;
  }
  return false;
}

function inRing(point: { lat: number; lng: number }, ring: Array<[number, number]>): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const intersects =
      yi > point.lat !== yj > point.lat &&
      point.lng < ((xj - xi) * (point.lat - yi)) / (yj - yi || Number.EPSILON) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}
