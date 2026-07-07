import { distanceMeters } from "#/server/living/geofence.ts";

/**
 * Pure geometry for walking navigation: compass/bearing math and snapping the
 * traveled breadcrumb onto the routed path. Everything works on the project's
 * [lng, lat] coordinate order and uses a local equirectangular approximation —
 * plenty accurate at park scale (hundreds of metres), where the earth is flat
 * for our purposes.
 */

/** Shortest signed delta from `a` to `b` on the 0–360 compass circle, in
 *  (-180, 180] — so smoothing/thresholds take the short way across the 0/360
 *  seam instead of spinning the long way round. */
export function angleDelta(a: number, b: number): number {
  let d = (b - a) % 360;
  if (d > 180) d -= 360;
  if (d <= -180) d += 360;
  return d;
}

/** Initial bearing from `a` to `b` in degrees clockwise from north (0–360). */
export function bearingBetween(a: [number, number], b: [number, number]): number {
  const lat = ((a[1] + b[1]) / 2) * (Math.PI / 180);
  const dx = (b[0] - a[0]) * Math.cos(lat); // east
  const dy = b[1] - a[1]; // north
  const deg = (Math.atan2(dx, dy) * 180) / Math.PI;
  return (deg + 360) % 360;
}

// Metres per degree of latitude (WGS84 mean) — longitude scales by cos(lat).
const M_PER_DEG = 111_320;

/** A GPS fix's projection onto the route polyline. */
export type RouteProjection = {
  /** The nearest point on the route, [lng, lat]. */
  point: [number, number];
  /** Perpendicular distance from the fix to the route, metres. */
  distM: number;
  /** Distance travelled along the route to reach `point`, metres. */
  alongM: number;
};

/**
 * Project `p` onto the closest segment of `route`. Returns null for a
 * degenerate route (fewer than 2 points).
 */
export function projectOntoRoute(
  p: [number, number],
  route: ReadonlyArray<[number, number]>,
): RouteProjection | null {
  if (route.length < 2) return null;
  const cosLat = Math.cos((p[1] * Math.PI) / 180);
  // Local metre-space around p, so segment projection is plain 2D math.
  const toXY = (c: [number, number]): [number, number] => [
    (c[0] - p[0]) * cosLat * M_PER_DEG,
    (c[1] - p[1]) * M_PER_DEG,
  ];
  let best: RouteProjection | null = null;
  let acc = 0; // metres along the route up to the current segment's start
  for (let i = 1; i < route.length; i++) {
    const a = route[i - 1];
    const b = route[i];
    const [ax, ay] = toXY(a);
    const [bx, by] = toXY(b);
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const segLen = Math.sqrt(len2);
    // t of the perpendicular foot, clamped to the segment. (p is the local
    // origin, so the projection of p is just -a·d / |d|².)
    const t = len2 > 0 ? Math.min(1, Math.max(0, -(ax * dx + ay * dy) / len2)) : 0;
    const qx = ax + dx * t;
    const qy = ay + dy * t;
    const dist = Math.sqrt(qx * qx + qy * qy);
    if (!best || dist < best.distM) {
      best = {
        point: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t],
        distM: dist,
        alongM: acc + segLen * t,
      };
    }
    acc += segLen;
  }
  return best;
}

// Within this many metres of the routed path a GPS fix is treated as *on* the
// path (its wobble is projected away); beyond it the user has genuinely left
// the route and we record the raw fix. Roughly a walkway's width plus typical
// urban GPS error.
export const SNAP_OFF_ROUTE_M = 15;

// Don't back-fill route vertices across a gap longer than this between two
// consecutive snapped fixes — a jump that big isn't walking (dev teleports,
// a long GPS dropout), and tracing the route through it would fake a trail.
const MAX_FILL_M = 80;

// Drop appended points closer than this to the previous one, so vertex fills
// and snaps never densify the trail with near-duplicates.
const MIN_PT_SPACING_M = 1;

/**
 * Append a GPS fix to the traveled breadcrumb, snapped to the routed path.
 *
 * When the fix is within SNAP_OFF_ROUTE_M of `route`, we record its projection
 * onto the route instead of the raw fix — and back-fill the route's own
 * vertices between the previous trail point's projection and this one, so the
 * trail traces the path around corners rather than cutting them the way raw
 * fixes do. A fix beyond the threshold is recorded raw (the user left the
 * routed path, and the trail should show where they actually went).
 *
 * Returns a new array when anything was appended, or `trail` unchanged.
 */
export function extendSnappedTrail(
  trail: ReadonlyArray<[number, number]>,
  route: ReadonlyArray<[number, number]> | null,
  fix: [number, number],
): Array<[number, number]> {
  const append: Array<[number, number]> = [];
  const proj = route ? projectOntoRoute(fix, route) : null;
  if (!proj || proj.distM > SNAP_OFF_ROUTE_M) {
    append.push(fix);
  } else {
    const last = trail[trail.length - 1];
    const lastProj = last && route ? projectOntoRoute(last, route) : null;
    if (lastProj && lastProj.distM <= SNAP_OFF_ROUTE_M) {
      const gap = Math.abs(proj.alongM - lastProj.alongM);
      if (gap > 0 && gap <= MAX_FILL_M && route) {
        // Route vertices strictly between the two projections, in walk order
        // (either direction — the user may be backtracking).
        const forward = proj.alongM >= lastProj.alongM;
        const lo = Math.min(lastProj.alongM, proj.alongM);
        const hi = Math.max(lastProj.alongM, proj.alongM);
        const between: Array<[number, number]> = [];
        let acc = 0;
        for (let i = 1; i < route.length; i++) {
          acc += distanceMeters(route[i - 1], route[i]);
          if (acc > lo && acc < hi) between.push(route[i]);
          if (acc >= hi) break;
        }
        if (!forward) between.reverse();
        append.push(...between);
      }
    }
    append.push(proj.point);
  }
  const out = trail.slice() as Array<[number, number]>;
  for (const pt of append) {
    const prev = out[out.length - 1];
    if (!prev || distanceMeters(prev, pt) >= MIN_PT_SPACING_M) out.push(pt);
  }
  return out.length === trail.length ? (trail as Array<[number, number]>) : out;
}
