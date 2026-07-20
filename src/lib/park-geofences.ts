import type { ParkGeofence } from "#/lib/ride-recorder-client.ts";

/** The subset of a `parks.list` row this needs — centroid + bounding box. */
export interface ParkGeoInput {
  id: number;
  latitude: number | null;
  longitude: number | null;
  latMin: number | null;
  latMax: number | null;
  lngMin: number | null;
  lngMax: number | null;
}

// iOS monitors at most 20 regions per app; keep the nearest ones.
const MAX_REGIONS = 20;
// A park geofence should trip a little *before* the boundary (catch the walk in
// from the parking tram / resort), and never be so tight a GPS wobble misses it.
const RADIUS_BUFFER_M = 150;
const MIN_RADIUS_M = 200;
const MAX_RADIUS_M = 2_500;

const EARTH_R_M = 6_371_000;

function toRad(d: number): number {
  return (d * Math.PI) / 180;
}

/** Great-circle distance in metres between two [lng, lat] points. */
export function haversineM(a: [number, number], b: [number, number]): number {
  const dLat = toRad(b[1] - a[1]);
  const dLng = toRad(b[0] - a[0]);
  const lat1 = toRad(a[1]);
  const lat2 = toRad(b[1]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_R_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Derive native circular geofences from the park list. Each park's circle is
 * centred on its centroid (bbox midpoint, falling back to the stored lat/lng)
 * with a radius covering the bbox half-diagonal plus a buffer, clamped to a sane
 * range. When `from` is provided the result is sorted nearest-first and capped
 * at {@link MAX_REGIONS} (the iOS limit) — so a user in Orlando monitors the
 * Florida parks, not Anaheim's. Parks without usable coordinates are dropped.
 */
export function parkGeofencesFromParks(
  parks: ParkGeoInput[],
  from: [number, number] | null,
): ParkGeofence[] {
  const fences: (ParkGeofence & { _center: [number, number] })[] = [];

  for (const p of parks) {
    const hasBox = p.latMin != null && p.latMax != null && p.lngMin != null && p.lngMax != null;
    let center: [number, number] | null = null;
    let radiusM = MIN_RADIUS_M;

    if (hasBox) {
      const latMid = (p.latMin! + p.latMax!) / 2;
      const lngMid = (p.lngMin! + p.lngMax!) / 2;
      center = [lngMid, latMid];
      const halfDiagM = haversineM([p.lngMin!, p.latMin!], [p.lngMax!, p.latMax!]) / 2;
      radiusM = halfDiagM + RADIUS_BUFFER_M;
    } else if (p.latitude != null && p.longitude != null) {
      center = [p.longitude, p.latitude];
    }

    if (!center) continue;
    radiusM = Math.min(MAX_RADIUS_M, Math.max(MIN_RADIUS_M, Math.round(radiusM)));
    fences.push({ id: String(p.id), lat: center[1], lng: center[0], radiusM, _center: center });
  }

  if (from) {
    fences.sort((a, b) => haversineM(from, a._center) - haversineM(from, b._center));
  }

  return fences.slice(0, MAX_REGIONS).map(({ _center, ...fence }) => fence);
}
