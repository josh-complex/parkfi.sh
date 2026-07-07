import { Store } from "@tanstack/store";

import { distanceMeters } from "#/server/living/geofence.ts";

import { extendSnappedTrail } from "./nav-geometry.ts";

/**
 * Walking-navigation trip state, as a TanStack store (not React context) so the
 * stage provider, the nav overlay, and the geolocation effects can share it
 * without threading a dozen props — and so per-frame writes (the live map
 * bearing) only re-render subscribers that select them. Client-only UI state:
 * the server never writes it, so the module-level store always serializes its
 * idle defaults during SSR.
 */

export type NavDest = { id: number; name: string; coords: [number, number] };
export type NavPlace = { name: string; coords: [number, number] };
export type NavTrip = { from: NavPlace; to: NavPlace };
/** Snapshot of the finished trip, frozen at arrival for the completion card. */
export type NavSummary = { walkedMeters: number; elapsedSeconds: number };

// How far (metres) the user must move from the last-routed origin before we
// recompute the walking route mid-trip. Small enough that turns update promptly,
// large enough that a jittery GPS fix or a step in place won't re-hit Valhalla.
// The refetch is silent (previous route stays drawn via keepPreviousData), so we
// can afford to recompute fairly often for a responsive "next turn".
const REROUTE_MIN_MOVE_M = 10;

// Within this many metres of the destination we call it: navigation flips to the
// arrival state and stops re-routing/following. Generous enough to absorb GPS
// wobble at walking speed so we don't sit one fix short of "arrived".
const ARRIVE_RADIUS_M = 15;

// …or once the live ETA drops to within this many seconds of the destination.
// The trip is effectively done at this point — the last few metres don't need
// turn-by-turn — so we flip straight to the completion summary rather than make
// the user watch the ETA tick to zero.
const ARRIVE_ETA_S = 30;

// Minimum move (metres) between the raw fixes that extend the traveled
// breadcrumb. Keeps the "where you've been" trail from densifying with jittery
// near-duplicate points while standing still.
const TRAIL_MIN_MOVE_M = 4;

interface NavState {
  /** A Directions request waiting on the first location fix. */
  pendingDest: NavDest | null;
  /** The resolved trip (both ends labeled Places, so Swap just flips them). */
  trip: NavTrip | null;
  /** Preview (whole route framed) vs navigating (Start tapped → follow-cam). */
  started: boolean;
  /** Follow-cam recenters on the user each fix; a manual pan clears it. */
  following: boolean;
  /** Rotate the map to the user's facing (GL only). */
  headingUp: boolean;
  /** Latched within ARRIVE_RADIUS_M (or ARRIVE_ETA_S) of the destination — stops
   *  re-routing / following and swaps the nav UI for the completion card. */
  arrived: boolean;
  /** Wall-clock (ms) that Start was tapped, for the completion card's elapsed
   *  time. Null until navigating. */
  startedAt: number | null;
  /** Frozen trip stats, snapshotted the moment `arrived` latches. */
  summary: NavSummary | null;
  /** Where the user has walked since Start — snapped to the routed path (see
   *  extendSnappedTrail), drawn as a gray dotted trail behind the live route. */
  traveled: Array<[number, number]>;
  /** The raw fix that last extended `traveled`, for the min-move throttle. */
  trailAnchor: [number, number] | null;
  /** Live map bearing (degrees) mirrored from the renderer, for the compass. */
  mapBearing: number;
}

const IDLE: NavState = {
  pendingDest: null,
  trip: null,
  started: false,
  following: false,
  headingUp: false,
  arrived: false,
  startedAt: null,
  summary: null,
  traveled: [],
  trailAnchor: null,
  mapBearing: 0,
};

export const navStore = new Store<NavState>(IDLE);

// Reset the per-trip bookkeeping (arrival latch + breadcrumb + summary) folded
// into a new destination, so a new trip never inherits the last one's "arrived",
// trail, or completion stats.
const freshProgress: Pick<
  NavState,
  "arrived" | "startedAt" | "summary" | "traveled" | "trailAnchor"
> = {
  arrived: false,
  startedAt: null,
  summary: null,
  traveled: [],
  trailAnchor: null,
};

/** Total length (metres) of a polyline — the distance actually walked, summed
 *  over the snapped breadcrumb. */
function pathLength(points: Array<[number, number]>): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) total += distanceMeters(points[i - 1], points[i]);
  return total;
}

/** A "Directions" tap: snapshot the user's location as the trip origin, or park
 *  the destination until a fix arrives (the caller triggers `locate()`). */
export function requestNavDirections(d: NavDest, origin: [number, number] | null) {
  const to: NavPlace = { name: d.name, coords: d.coords };
  navStore.setState((s) => ({
    ...s,
    ...freshProgress,
    ...(origin
      ? { trip: { from: { name: "Your location", coords: origin }, to }, pendingDest: null }
      : { trip: null, pendingDest: d }),
  }));
}

/** Fulfil a pending Directions request once the first location fix lands. */
export function resolvePendingDest(origin: [number, number]) {
  navStore.setState((s) => {
    if (!s.pendingDest) return s;
    return {
      ...s,
      pendingDest: null,
      trip: {
        from: { name: "Your location", coords: origin },
        to: { name: s.pendingDest.name, coords: s.pendingDest.coords },
      },
    };
  });
}

/** Start tapped — flip to navigating with the follow-cam engaged (the stage
 *  drives the actual camera fly). */
export function startNav() {
  navStore.setState((s) => ({
    ...s,
    started: true,
    following: true,
    headingUp: true,
    startedAt: Date.now(),
  }));
}

/** (Re-)engage the follow-cam + heading-up — Start and the recenter button. */
export function engageFollow() {
  navStore.setState((s) => ({ ...s, following: true, headingUp: true }));
}

/** A real user gesture on the map (drag/zoom/rotate) drops the follow-cam. */
export function dropFollow() {
  navStore.setState((s) => (s.following ? { ...s, following: false } : s));
}

export function setHeadingUp(headingUp: boolean) {
  navStore.setState((s) => ({ ...s, headingUp }));
}

export function setMapBearing(mapBearing: number) {
  navStore.setState((s) => (s.mapBearing === mapBearing ? s : { ...s, mapBearing }));
}

/** End navigation entirely — back to the plain map UI. */
export function clearNavTrip() {
  navStore.setState((s) => ({ ...IDLE, mapBearing: s.mapBearing }));
}

/** Reverse origin/destination (preview only — re-keys the route query). */
export function swapNavEnds() {
  navStore.setState((s) => (s.trip ? { ...s, trip: { from: s.trip.to, to: s.trip.from } } : s));
}

/**
 * Feed a live GPS fix into the trip. While navigating (and not yet arrived)
 * this drives, in one update:
 *  - arrival: within ARRIVE_RADIUS_M of the destination *or* with the live ETA
 *    (`etaSeconds`) inside ARRIVE_ETA_S, latch `arrived`, drop the follow-cam,
 *    and freeze the trip summary so the completion card can frame the finish;
 *  - the traveled breadcrumb: fixes at least TRAIL_MIN_MOVE_M apart extend the
 *    trail, snapped onto `route` so it hugs the walked path (see nav-geometry);
 *  - re-routing: once the user is REROUTE_MIN_MOVE_M from the last-routed
 *    origin, re-key the trip origin so the route query refetches from here.
 */
export function recordNavFix(
  fix: [number, number],
  route: Array<[number, number]> | null,
  etaSeconds: number | null,
) {
  navStore.setState((s) => {
    if (!s.started || s.arrived || !s.trip) return s;
    const withinRadius = distanceMeters(fix, s.trip.to.coords) <= ARRIVE_RADIUS_M;
    const withinEta = etaSeconds != null && etaSeconds <= ARRIVE_ETA_S;
    if (withinRadius || withinEta) {
      // Fold this final fix into the trail before measuring, so the walked
      // distance covers the whole approach.
      const walked = pathLength(extendSnappedTrail(s.traveled, route, fix));
      const elapsedSeconds = s.startedAt ? Math.round((Date.now() - s.startedAt) / 1000) : 0;
      return {
        ...s,
        arrived: true,
        following: false,
        summary: { walkedMeters: walked, elapsedSeconds },
      };
    }
    let next = s;
    if (!s.trailAnchor || distanceMeters(fix, s.trailAnchor) >= TRAIL_MIN_MOVE_M) {
      next = { ...next, trailAnchor: fix, traveled: extendSnappedTrail(s.traveled, route, fix) };
    }
    if (distanceMeters(fix, s.trip.from.coords) >= REROUTE_MIN_MOVE_M) {
      next = { ...next, trip: { ...s.trip, from: { ...s.trip.from, coords: fix } } };
    }
    return next;
  });
}
