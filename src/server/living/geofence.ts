/**
 * Living Layer — pure geofence/geometry helpers.
 *
 * No I/O, no DB, no device APIs — every function here is a pure transform so it
 * can be unit-tested at the desk (geofence.test.ts). Coordinates follow the
 * project's GeoJSON convention: [lng, lat] (see `GeoPolygon` in db/schema.ts).
 */
import type { GeoPolygon } from "#/db/schema.ts";

export type LngLat = [number, number];

/** Party-eligibility tier for a companion given where the warden is ([05]). */
export type ProximityTier = "home" | "guest" | "away";

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
 * ring of each polygon as the outer boundary (holes are ignored — park lands
 * don't have holes in practice, and ignoring them only ever over-includes).
 */
export function pointInPolygon(point: LngLat, geo: GeoPolygon | null | undefined): boolean {
  if (!geo) return false;
  if (geo.type === "Polygon") {
    return geo.coordinates.length > 0 && pointInRing(point, geo.coordinates[0]);
  }
  // MultiPolygon
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

export interface RealmLike {
  id: number;
  boundary?: GeoPolygon | null;
  /** Optional centroid fallback when no boundary polygon exists yet. */
  centroid?: LngLat | null;
}

/**
 * Which realm contains the point. Prefers a true polygon hit; falls back to the
 * nearest realm centroid within `fallbackRadiusM` when boundaries are absent
 * (e.g. before the geo cron has seeded polygons). Returns null if none match.
 */
export function realmForPoint(
  point: LngLat,
  realms: ReadonlyArray<RealmLike>,
  fallbackRadiusM = 75,
): number | null {
  for (const r of realms) {
    if (pointInPolygon(point, r.boundary)) return r.id;
  }
  let bestId: number | null = null;
  let bestDist = fallbackRadiusM;
  for (const r of realms) {
    if (!r.centroid) continue;
    const d = distanceMeters(point, r.centroid);
    if (d < bestDist) {
      bestDist = d;
      bestId = r.id;
    }
  }
  return bestId;
}

/**
 * Proximity tier for a companion ([05] — companions-and-proximity):
 *  - home:  warden is in the companion's home realm
 *  - guest: warden is elsewhere in the same park
 *  - away:  warden is in a different park entirely
 */
export function tierFor(args: {
  homeRealmId: number | null;
  currentRealmId: number | null;
  homeParkId: number | null;
  currentParkId: number | null;
}): ProximityTier {
  const { homeRealmId, currentRealmId, homeParkId, currentParkId } = args;
  if (homeRealmId != null && homeRealmId === currentRealmId) return "home";
  if (homeParkId != null && currentParkId != null && homeParkId === currentParkId) return "guest";
  return "away";
}

/** Convex hull (Andrew's monotone chain) of [lng,lat] points → outer ring. */
export function convexHull(points: ReadonlyArray<LngLat>): LngLat[] {
  const pts = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (pts.length <= 2) return pts;
  const cross = (o: LngLat, a: LngLat, b: LngLat) =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: LngLat[] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0)
      lower.pop();
    lower.push(p);
  }
  const upper: LngLat[] = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0)
      upper.pop();
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  return [...lower, ...upper];
}
