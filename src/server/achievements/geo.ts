/**
 * Achievements — pure geometry, no I/O.
 *
 * A deliberately separate, tiny copy of the same math in
 * `src/server/living/geofence.ts` — achievements must stay 100% independent of
 * the Living Layer, so we reimplement rather than import. Coordinates follow
 * the project's GeoJSON convention: [lng, lat] (see `GeoPolygon` in db/schema.ts).
 */
import type { GeoPolygon } from "#/db/schema.ts";

export type LngLat = [number, number];

/**
 * Ray-casting point-in-polygon for a single linear ring ([lng,lat] pairs).
 * Returns true if the point is inside the ring (edges count as inside).
 */
export function pointInRing(point: LngLat, ring: ReadonlyArray<LngLat>): boolean {
  const [x, y] = point;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const intersects = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

/**
 * Point-in-polygon against a GeoJSON Polygon or MultiPolygon. Uses the first
 * ring of each polygon as the outer boundary (holes ignored — park lands don't
 * have holes in practice, and ignoring them only ever over-includes).
 */
export function pointInPolygon(point: LngLat, geo: GeoPolygon | null | undefined): boolean {
  if (!geo) return false;
  return outerRings(geo).some((ring) => pointInRing(point, ring));
}

/** The outer boundary ring of each polygon (holes ignored, like pointInPolygon). */
export function outerRings(geo: GeoPolygon): ReadonlyArray<ReadonlyArray<LngLat>> {
  if (geo.type === "Polygon") return geo.coordinates.length > 0 ? [geo.coordinates[0]] : [];
  return geo.coordinates.filter((poly) => poly.length > 0).map((poly) => poly[0]);
}

/** Tight lat/lng bounds over a polygon's outer rings; null for empty geometry. */
export function polygonBbox(
  geo: GeoPolygon | null | undefined,
): { latMin: number; latMax: number; lngMin: number; lngMax: number } | null {
  if (!geo) return null;
  let latMin = Infinity,
    latMax = -Infinity,
    lngMin = Infinity,
    lngMax = -Infinity;
  for (const ring of outerRings(geo)) {
    for (const [lng, lat] of ring) {
      latMin = Math.min(latMin, lat);
      latMax = Math.max(latMax, lat);
      lngMin = Math.min(lngMin, lng);
      lngMax = Math.max(lngMax, lng);
    }
  }
  return Number.isFinite(latMin) ? { latMin, latMax, lngMin, lngMax } : null;
}

/**
 * Minimum distance in meters from a point to a polygon's outer-ring edges
 * (equirectangular around the point, like distanceMeters — fine at park scale).
 * Infinity for empty geometry. Note this is distance to the *edge*: it's large
 * for a point deep inside the polygon too, so pair it with pointInPolygon.
 */
export function distanceToBoundary(point: LngLat, geo: GeoPolygon | null | undefined): number {
  if (!geo) return Infinity;
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const [lng, lat] = point;
  const k = Math.cos(toRad(lat)); // lng→meters shrink at this latitude
  const px = toRad(lng) * k * R;
  const py = toRad(lat) * R;
  let best = Infinity;
  for (const ring of outerRings(geo)) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const ax = toRad(ring[j][0]) * k * R;
      const ay = toRad(ring[j][1]) * R;
      const bx = toRad(ring[i][0]) * k * R;
      const by = toRad(ring[i][1]) * R;
      const dx = bx - ax;
      const dy = by - ay;
      const len2 = dx * dx + dy * dy;
      const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
      best = Math.min(best, Math.hypot(px - (ax + t * dx), py - (ay + t * dy)));
    }
  }
  return best;
}

/** Equirectangular-approx distance in meters — fine at theme-park scale. */
export function distanceMeters(a: LngLat, b: LngLat): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const [lng1, lat1] = a;
  const [lng2, lat2] = b;
  const x = toRad(lng2 - lng1) * Math.cos(toRad((lat1 + lat2) / 2));
  const y = toRad(lat2 - lat1);
  return Math.sqrt(x * x + y * y) * R;
}
