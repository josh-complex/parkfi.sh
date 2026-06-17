/**
 * OpenStreetMap theme-park boundary polygons, via the Overpass API. Used by the
 * monthly geo cron to outline the *actual* park area on the map — the OSM raster
 * basemap bakes in the whole Walt Disney World property line, which we can't
 * strip, so we draw our own per-park polygons on top to focus on the parks.
 *
 * One bbox query returns every `tourism=theme_park` way/relation around Orlando
 * (including the unwanted "Walt Disney World" property relation). We key the
 * results by name and let the cron match each park to its own polygon, so the
 * property-wide element is simply never selected.
 */
import { config } from "../config.ts";

import type { GeoPolygon } from "#/db/schema.ts";

import { UpstreamError } from "./themeparks.ts";

type LngLat = [number, number];

/** A point as Overpass returns it inside `geometry`. */
interface OverpassPt {
  lat: number;
  lon: number;
}
interface OverpassWay {
  type: "way";
  id: number;
  tags?: Record<string, string>;
  geometry?: Array<OverpassPt>;
}
interface OverpassRelMember {
  type: string;
  role?: string;
  geometry?: Array<OverpassPt>;
}
interface OverpassRelation {
  type: "relation";
  id: number;
  tags?: Record<string, string>;
  members?: Array<OverpassRelMember>;
}
type OverpassElement = OverpassWay | OverpassRelation;

const ROUND = 1e6; // ~0.1 m — plenty for a park outline; keeps the JSON small.
function pt(p: OverpassPt): LngLat {
  return [Math.round(p.lon * ROUND) / ROUND, Math.round(p.lat * ROUND) / ROUND];
}

/** Close a ring (first point repeated last) if it isn't already closed. */
function closeRing(ring: Array<LngLat>): Array<LngLat> {
  if (ring.length < 3) return ring;
  const a = ring[0];
  const b = ring[ring.length - 1];
  if (a[0] !== b[0] || a[1] !== b[1]) ring.push([a[0], a[1]]);
  return ring;
}

/** Endpoint key for stitching way segments into rings (rounded coords). */
function key(p: LngLat): string {
  return `${p[0]},${p[1]}`;
}

/**
 * Stitch a set of open/closed way segments into closed rings by joining shared
 * endpoints — the standard OSM multipolygon assembly. Segments that can't be
 * closed into a ring are dropped (a park boundary's outer members always close).
 */
function stitchRings(segments: Array<Array<LngLat>>): Array<Array<LngLat>> {
  const remaining = segments.filter((s) => s.length >= 2).map((s) => [...s]);
  const rings: Array<Array<LngLat>> = [];
  while (remaining.length > 0) {
    let ring = remaining.shift()!;
    let extended = true;
    while (extended && key(ring[0]) !== key(ring[ring.length - 1])) {
      extended = false;
      for (let i = 0; i < remaining.length; i++) {
        const seg = remaining[i];
        const tail = ring[ring.length - 1];
        if (key(seg[0]) === key(tail)) {
          ring = ring.concat(seg.slice(1));
        } else if (key(seg[seg.length - 1]) === key(tail)) {
          ring = ring.concat([...seg].reverse().slice(1));
        } else {
          continue;
        }
        remaining.splice(i, 1);
        extended = true;
        break;
      }
    }
    if (ring.length >= 4 && key(ring[0]) === key(ring[ring.length - 1])) rings.push(ring);
  }
  return rings;
}

/** Convert one Overpass element (way or relation) to a GeoJSON geometry. */
function toGeometry(el: OverpassElement): GeoPolygon | null {
  if (el.type === "way") {
    if (!el.geometry || el.geometry.length < 3) return null;
    return { type: "Polygon", coordinates: [closeRing(el.geometry.map(pt))] };
  }
  // Relation = multipolygon: stitch outer members into rings, inner into holes,
  // then pair each hole to the (first) outer ring — good enough for park shapes.
  const outerSegs: Array<Array<LngLat>> = [];
  const innerSegs: Array<Array<LngLat>> = [];
  for (const m of el.members ?? []) {
    if (m.type !== "way" || !m.geometry || m.geometry.length < 2) continue;
    (m.role === "inner" ? innerSegs : outerSegs).push(m.geometry.map(pt));
  }
  const outer = stitchRings(outerSegs);
  const inner = stitchRings(innerSegs);
  if (outer.length === 0) return null;
  const polys: Array<Array<Array<LngLat>>> = outer.map((ring) => [ring]);
  // Attach all holes to the first outer ring (parks don't have nested holes).
  if (inner.length > 0) polys[0].push(...inner);
  return polys.length === 1
    ? { type: "Polygon", coordinates: polys[0] }
    : { type: "MultiPolygon", coordinates: polys };
}

/** Normalize a park name for matching (lowercase, drop punctuation/possessives). */
export function normalizeParkName(name: string): string {
  return name
    .toLowerCase()
    .replace(/['’]s\b/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Fetch every `tourism=theme_park` boundary in `bbox` ([s,w,n,e]) and return a
 * map of normalized name -> GeoJSON geometry. `out geom` gives ways their ring
 * coords and relations their member geometries in one round-trip.
 */
export async function fetchThemeParkBoundaries(
  bbox: [number, number, number, number],
  signal: AbortSignal,
): Promise<Map<string, GeoPolygon>> {
  const [s, w, n, e] = bbox;
  const query = `[out:json][timeout:90];
(
  way["tourism"="theme_park"](${s},${w},${n},${e});
  relation["tourism"="theme_park"](${s},${w},${n},${e});
);
out geom;`;
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
  const json = (await res.json()) as { elements?: Array<OverpassElement> };

  const out = new Map<string, GeoPolygon>();
  for (const el of json.elements ?? []) {
    const name = el.tags?.name ?? el.tags?.["name:en"];
    if (!name) continue;
    const geom = toGeometry(el);
    if (!geom) continue;
    const k = normalizeParkName(name);
    // A relation (assembled multipolygon) is more authoritative than a stray way
    // of the same name; keep the one with more coordinates.
    const existing = out.get(k);
    if (!existing || coordCount(geom) > coordCount(existing)) out.set(k, geom);
  }
  return out;
}

function coordCount(g: GeoPolygon): number {
  return g.type === "Polygon"
    ? g.coordinates.reduce((n, r) => n + r.length, 0)
    : g.coordinates.reduce((n, p) => n + p.reduce((m, r) => m + r.length, 0), 0);
}
