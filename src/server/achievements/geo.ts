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
  if (geo.type === "Polygon") {
    return geo.coordinates.length > 0 && pointInRing(point, geo.coordinates[0]);
  }
  return geo.coordinates.some((poly) => poly.length > 0 && pointInRing(point, poly[0]));
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
