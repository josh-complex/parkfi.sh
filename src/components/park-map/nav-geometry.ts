import { distanceMeters } from "#/server/living/geofence.ts";
import type { RouteManeuver, RouteResult } from "#/server/routing/valhalla.ts";

/**
 * Pure geometry for walking navigation: compass/bearing math, snapping the
 * traveled breadcrumb onto the routed path, and projecting the live fix onto the
 * route to derive progress (next-turn distance, remaining distance/ETA,
 * off-route). Everything works on the project's [lng, lat] coordinate order and
 * uses a local equirectangular approximation — plenty accurate at park scale
 * (hundreds of metres), where the earth is flat for our purposes.
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

/** Compass name for a bearing (degrees clockwise from north), 8-way — the
 *  crow-flies fallback's "head northwest" copy when routing is down (§5). */
export function compassDirection(bearing: number): string {
  const names = [
    "north",
    "northeast",
    "east",
    "southeast",
    "south",
    "southwest",
    "west",
    "northwest",
  ];
  return names[Math.round((((bearing % 360) + 360) % 360) / 45) % 8];
}

/** Round a [lng, lat] to 6 decimals (~11 cm). Query-key hygiene (§6): raw GPS
 *  floats never collide, so without this no two `routing.route` requests can
 *  ever share a cache entry — not even a card's walk-time prefetch and the
 *  Directions tap that follows it from the same fix. */
export function roundCoord(c: [number, number]): [number, number] {
  return [Math.round(c[0] * 1e6) / 1e6, Math.round(c[1] * 1e6) / 1e6];
}

/** Round a [lng, lat] to 3 decimals (~110 m) — the origin key for walk-*time*
 *  estimates. A live watch (achievement tracker, low profile) wobbles the fix
 *  by tens of metres even standing still; at 6 decimals every wobble is a new
 *  query key, so an estimate CTA would flicker and re-hit Valhalla on every
 *  fix. At ~110 m the key only moves once the walk time plausibly changed. */
export function coarseCoord(c: [number, number]): [number, number] {
  return [Math.round(c[0] * 1e3) / 1e3, Math.round(c[1] * 1e3) / 1e3];
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
 * `fixProj` (the fix's projection, when the caller already computed one for
 * progress) and `cumM` (the route's prefix sums from the RouteModel) are
 * optional fast paths — they skip re-projecting the fix and re-summing segment
 * lengths on every trail extension.
 *
 * Returns a new array when anything was appended, or `trail` unchanged.
 */
export function extendSnappedTrail(
  trail: ReadonlyArray<[number, number]>,
  route: ReadonlyArray<[number, number]> | null,
  fix: [number, number],
  fixProj?: RouteProjection | null,
  cumM?: ReadonlyArray<number>,
): Array<[number, number]> {
  const append: Array<[number, number]> = [];
  const proj = fixProj !== undefined ? fixProj : route ? projectOntoRoute(fix, route) : null;
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
          acc = cumM ? cumM[i] : acc + distanceMeters(route[i - 1], route[i]);
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

// How far ahead along the route the camera bearing looks. Far enough to smooth
// out vertex-to-vertex zigzags in the geometry, short enough that the map still
// turns with the path rather than cutting corners.
const BEARING_LOOKAHEAD_M = 20;

/**
 * The route's direction of travel at `fix`, degrees clockwise from north — the
 * bearing from the fix's projection to a point BEARING_LOOKAHEAD_M further along
 * the path. This is what the heading-up camera follows while navigating: the
 * way you're *supposed* to go, which is stable, instead of the device compass,
 * which wanders with every hand wobble and magnetometer hiccup (the puck's
 * facing cone still shows the device heading). Near the destination it holds
 * the final segment's direction. Null for no/degenerate route.
 */
export function routeBearingAt(
  route: ReadonlyArray<[number, number]> | null,
  fix: [number, number],
): number | null {
  if (!route || route.length < 2) return null;
  const proj = projectOntoRoute(fix, route);
  if (!proj) return null;
  const targetAlong = proj.alongM + BEARING_LOOKAHEAD_M;
  let acc = 0;
  let ahead: [number, number] | null = null;
  for (let i = 1; i < route.length && !ahead; i++) {
    const a = route[i - 1];
    const b = route[i];
    const segLen = distanceMeters(a, b);
    if (segLen > 0 && acc + segLen >= targetAlong) {
      const t = (targetAlong - acc) / segLen;
      ahead = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    }
    acc += segLen;
  }
  // Look-ahead ran off the end (or lands on top of the projection): the route's
  // closing direction is the steadiest thing left to point at.
  const to = ahead ?? route[route.length - 1];
  if (distanceMeters(proj.point, to) < 1) {
    return bearingBetween(route[route.length - 2], route[route.length - 1]);
  }
  return bearingBetween(proj.point, to);
}

/** Valhalla start maneuvers (1 start, 2 start right, 3 start left) are just
 *  "walk east on the pathway" preambles — never an actionable turn — so we skip
 *  them when picking the live headline during an active trip (§1.1). */
export function isStartManeuver(type: number): boolean {
  return type === 1 || type === 2 || type === 3;
}

/**
 * A route pre-processed for per-fix progress tracking: the geometry plus a
 * cumulative-distance prefix sum and each maneuver's distance-along-route, so a
 * live fix can be turned into "distance to next turn / remaining / ETA" with one
 * projection instead of re-hitting Valhalla every few metres (§2).
 */
export type RouteModel = {
  coordinates: ReadonlyArray<[number, number]>;
  /** Cumulative metres from the route start to each vertex (cumM[0] = 0). */
  cumM: number[];
  totalM: number;
  totalSeconds: number;
  maneuvers: ReadonlyArray<RouteManeuver>;
  /** Distance-along-route of each maneuver's begin vertex, index-aligned with
   *  `maneuvers`. */
  maneuverAlongM: number[];
};

/** Pre-compute a {@link RouteModel} from a routing result. Returns null for a
 *  degenerate route (fewer than 2 points) — nothing to track along. */
export function buildRouteModel(route: RouteResult): RouteModel | null {
  const { coordinates } = route;
  if (coordinates.length < 2) return null;
  const cumM: number[] = [0];
  for (let i = 1; i < coordinates.length; i++) {
    cumM.push(cumM[i - 1] + distanceMeters(coordinates[i - 1], coordinates[i]));
  }
  const totalM = cumM[cumM.length - 1];
  const maneuverAlongM = route.maneuvers.map((m) => {
    const idx = Math.min(Math.max(m.beginShapeIndex, 0), cumM.length - 1);
    return cumM[idx];
  });
  return {
    coordinates,
    cumM,
    totalM,
    totalSeconds: route.durationSeconds,
    maneuvers: route.maneuvers,
    maneuverAlongM,
  };
}

/**
 * The route geometry from `alongM` (a fix's projected distance along the route)
 * to the destination: the interpolated on-path point first, then every vertex
 * past it. This is what keeps the drawn line shrinking behind the walker while
 * the grayed traveled trail grows — the full geometry stays in the model for
 * the projection/progress math. Returns the full geometry for alongM ≤ 0, and
 * null once nothing remains (alongM at/past the end).
 */
export function remainingRouteCoords(
  model: RouteModel,
  alongM: number,
): Array<[number, number]> | null {
  const { coordinates, cumM, totalM } = model;
  if (alongM <= 0) return coordinates.slice() as Array<[number, number]>;
  if (alongM >= totalM) return null;
  // First vertex strictly beyond the projection (exists, since alongM < totalM).
  let i = 1;
  while (i < cumM.length && cumM[i] <= alongM) i++;
  const a = coordinates[i - 1];
  const b = coordinates[i];
  const segLen = cumM[i] - cumM[i - 1];
  const t = segLen > 0 ? (alongM - cumM[i - 1]) / segLen : 0;
  const start: [number, number] = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  return [start, ...coordinates.slice(i)];
}

/** Live projection-derived trip progress for one GPS fix. */
export type NavProgress = {
  /** Distance travelled along the route to the fix's projection, metres. */
  alongM: number;
  /** Perpendicular distance from the fix to the route, metres (off-route gate). */
  offRouteM: number;
  /** Remaining route distance to the destination, metres. */
  remainingM: number;
  /** Remaining time to the destination, seconds (route ETA scaled by fraction
   *  remaining). */
  etaSeconds: number;
  /** Index into `maneuvers` of the next actionable turn, or null when the only
   *  thing left is arrival. */
  nextManeuverIndex: number | null;
  /** Live distance to that turn, metres (null when there's no next turn). */
  distToNextM: number | null;
};

// Slack (metres) so a maneuver we're standing right on stops counting as "ahead"
// — prevents the headline flickering between a turn and the next one at the
// vertex.
const MANEUVER_REACHED_M = 6;

/** Project `fix` onto `model` and derive the live trip numbers. Returns null for
 *  a fix that can't be projected (degenerate route). Pass `proj` when the fix's
 *  projection is already in hand (recordNavFix shares one projection between
 *  progress and the trail) to skip the O(n) scan. */
export function computeProgress(
  model: RouteModel,
  fix: [number, number],
  proj: RouteProjection | null = projectOntoRoute(fix, model.coordinates),
): NavProgress | null {
  if (!proj) return null;
  const alongM = proj.alongM;
  const remainingM = Math.max(0, model.totalM - alongM);
  const etaSeconds =
    model.totalM > 0 ? Math.round((model.totalSeconds * remainingM) / model.totalM) : 0;
  // Next actionable maneuver: the first non-start maneuver whose begin lies
  // ahead of us on the route. The destination maneuver (type 4/5/6) qualifies,
  // so the headline flows into "arrive at…" as the route runs out.
  let nextManeuverIndex: number | null = null;
  for (let i = 0; i < model.maneuvers.length; i++) {
    if (isStartManeuver(model.maneuvers[i].type)) continue;
    if (model.maneuverAlongM[i] > alongM + MANEUVER_REACHED_M) {
      nextManeuverIndex = i;
      break;
    }
  }
  const distToNextM =
    nextManeuverIndex != null
      ? Math.max(0, model.maneuverAlongM[nextManeuverIndex] - alongM)
      : null;
  return { alongM, offRouteM: proj.distM, remainingM, etaSeconds, nextManeuverIndex, distToNextM };
}
