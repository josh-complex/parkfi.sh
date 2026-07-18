import { Store } from "@tanstack/store";

import { distanceMeters } from "#/server/living/geofence.ts";

import {
  computeProgress,
  extendSnappedTrail,
  projectOntoRoute,
  SNAP_OFF_ROUTE_M,
  type NavProgress,
  type RouteModel,
} from "./nav-geometry.ts";

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

// Within this many metres of the destination we call it: navigation flips to the
// arrival state and stops re-routing/following. Generous enough to absorb GPS
// wobble at walking speed so we don't sit one fix short of "arrived". Applied to
// the *remaining route distance* when we have a route model (honest even when the
// pin sits deep inside a building and the path stops at its edge), or crow-flies
// to the pin as a fallback.
const ARRIVE_RADIUS_M = 15;

// Consecutive off-route fixes (each beyond SNAP_OFF_ROUTE_M from the path) before
// we recompute the route from the current position. A short streak so a single
// GPS spike between show buildings doesn't trigger a needless reroute, but a
// genuine wrong turn is caught within a few metres of walking.
const OFF_ROUTE_FIXES = 3;

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
  /** Latched within ARRIVE_RADIUS_M of the destination (by remaining route
   *  distance) — stops re-routing / following and swaps the nav UI for the
   *  completion card. */
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
  /** Running length (metres) of `traveled` — the distance actually walked this
   *  trip. Accumulated as the trail extends (never re-summed), so it survives
   *  reroutes; drives the overlay's progress bar and the completion stats. */
  walkedM: number;
  /** Live map bearing (degrees) mirrored from the renderer, for the compass. */
  mapBearing: number;
  /** Per-fix projection progress (next-turn distance, remaining, ETA, off-route)
   *  — the source of the live nav numbers. Null until navigating with a route. */
  progress: NavProgress | null;
  /** A wrong turn was detected and we're recomputing the route from here — drives
   *  the "Rerouting…" headline until a fresh route lands. */
  rerouting: boolean;
  /** Consecutive off-route fixes, for the reroute streak threshold. */
  offRouteStreak: number;
  /** Number of off-route reroutes this trip, for the arrival/abandon telemetry. */
  rerouteCount: number;
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
  walkedM: 0,
  mapBearing: 0,
  progress: null,
  rerouting: false,
  offRouteStreak: 0,
  rerouteCount: 0,
};

export const navStore = new Store<NavState>(IDLE);

// Reset the per-trip bookkeeping (arrival latch + breadcrumb + summary) folded
// into a new destination, so a new trip never inherits the last one's "arrived",
// trail, or completion stats.
const freshProgress: Pick<
  NavState,
  | "arrived"
  | "startedAt"
  | "summary"
  | "traveled"
  | "trailAnchor"
  | "walkedM"
  | "progress"
  | "rerouting"
  | "offRouteStreak"
  | "rerouteCount"
> = {
  arrived: false,
  startedAt: null,
  summary: null,
  traveled: [],
  trailAnchor: null,
  walkedM: 0,
  progress: null,
  rerouting: false,
  offRouteStreak: 0,
  rerouteCount: 0,
};

/** Length (metres) the trail grew by — `next` is `prev` plus appended points
 *  (extendSnappedTrail only ever appends), so only the new segments are summed. */
function addedLength(
  prev: ReadonlyArray<[number, number]>,
  next: ReadonlyArray<[number, number]>,
): number {
  let total = 0;
  for (let i = Math.max(1, prev.length); i < next.length; i++)
    total += distanceMeters(next[i - 1], next[i]);
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

/** A freshly fetched route has landed — drop the "Rerouting…" indicator. Called
 *  from the stage when the route query settles, so the flag can't stick if the
 *  new route happens to be slightly off the current fix. No-op unless rerouting. */
export function clearRerouting() {
  navStore.setState((s) => (s.rerouting ? { ...s, rerouting: false, offRouteStreak: 0 } : s));
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
 * Feed a live GPS fix into the trip. While navigating (and not yet arrived) this
 * drives, in one update, off a single client-side projection of the fix onto the
 * current route (see computeProgress) — no per-fix Valhalla call:
 *  - progress: next-turn distance, remaining distance, and ETA, all ticking
 *    between reroutes instead of freezing until a response lands;
 *  - arrival: remaining route distance within ARRIVE_RADIUS_M (or crow-flies to
 *    the pin when there's no route model) — latch `arrived`, drop the follow-cam,
 *    and freeze the trip summary so the completion card can frame the finish;
 *  - the traveled breadcrumb: fixes at least TRAIL_MIN_MOVE_M apart extend the
 *    trail, snapped onto `route` so it hugs the walked path (see nav-geometry);
 *  - re-routing: after OFF_ROUTE_FIXES consecutive fixes off the path, re-key the
 *    trip origin so the route query refetches from here, and flag `rerouting`
 *    until the fresh route lands (a fix back on-route clears it).
 */
export function recordNavFix(fix: [number, number], model: RouteModel | null) {
  navStore.setState((s) => {
    if (!s.started || s.arrived || !s.trip) return s;
    const route = model?.coordinates ?? null;
    // Project the fix onto the route once — progress, arrival, and the trail
    // extension all share it instead of each re-running the O(n) scan.
    const proj = route ? projectOntoRoute(fix, route) : null;
    const progress = model ? computeProgress(model, fix, proj) : null;

    // Arrival — remaining route distance to the end when we have a model, else
    // crow-flies to the pin. Using remaining route distance means a destination
    // whose pin sits inside a building (route ends at the footpath edge) still
    // arrives cleanly, and a 25 s-away destination no longer latches on fix one
    // (its remaining distance starts well above ARRIVE_RADIUS_M).
    const arrived =
      progress != null
        ? progress.remainingM <= ARRIVE_RADIUS_M
        : distanceMeters(fix, s.trip.to.coords) <= ARRIVE_RADIUS_M;
    if (arrived) {
      // Fold this final fix into the trail before measuring, so the walked
      // distance covers the whole approach.
      const trail = extendSnappedTrail(s.traveled, route, fix, proj, model?.cumM);
      const walked = s.walkedM + addedLength(s.traveled, trail);
      const elapsedSeconds = s.startedAt ? Math.round((Date.now() - s.startedAt) / 1000) : 0;
      return {
        ...s,
        arrived: true,
        following: false,
        progress: null,
        rerouting: false,
        offRouteStreak: 0,
        summary: { walkedMeters: walked, elapsedSeconds },
      };
    }

    // computeProgress returns a fresh object per fix, so only the both-null case
    // (route still loading) can skip the state clone.
    let next: NavState = progress == null && s.progress == null ? s : { ...s, progress };

    if (!s.trailAnchor || distanceMeters(fix, s.trailAnchor) >= TRAIL_MIN_MOVE_M) {
      const traveled = extendSnappedTrail(s.traveled, route, fix, proj, model?.cumM);
      next = {
        ...next,
        trailAnchor: fix,
        traveled,
        walkedM: s.walkedM + addedLength(s.traveled, traveled),
      };
    }

    // Off-route → reroute. Without a projection (route still loading) we can't
    // judge, so leave the reroute state untouched.
    if (progress != null) {
      const offRoute = progress.offRouteM > SNAP_OFF_ROUTE_M;
      if (!offRoute) {
        // On (possibly freshly-computed) route: clear the streak and any
        // in-flight rerouting flag.
        if (next.offRouteStreak !== 0 || next.rerouting)
          next = { ...next, offRouteStreak: 0, rerouting: false };
      } else if (!s.rerouting) {
        const streak = next.offRouteStreak + 1;
        next =
          streak >= OFF_ROUTE_FIXES
            ? {
                ...next,
                offRouteStreak: 0,
                rerouting: true,
                rerouteCount: s.rerouteCount + 1,
                trip: { ...s.trip, from: { ...s.trip.from, coords: fix } },
              }
            : { ...next, offRouteStreak: streak };
      }
    }
    return next;
  });
}
