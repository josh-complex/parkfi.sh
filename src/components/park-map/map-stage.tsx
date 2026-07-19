"use client";

import * as React from "react";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useStore } from "@tanstack/react-store";
import { createPortal } from "react-dom";
import posthog from "posthog-js";

import { playModeStore, setHudExpanded } from "#/components/living/play-mode.ts";
import { PlayOverlay } from "#/components/living/play-overlay.tsx";
import { DevLocationPanel } from "#/components/park-map/dev-location-panel.tsx";
import { useSelection } from "#/components/park-dashboard/selection-context.tsx";
import { RideFilterButton } from "#/components/rides/ride-filter-button.tsx";
import { useRideFilter } from "#/components/rides/ride-filter.tsx";
import { useDeviceHeading } from "#/hooks/use-device-heading.ts";
import { useGeolocation } from "#/hooks/use-geolocation.ts";
import { useIsMobile } from "#/hooks/use-mobile.ts";
import { useWakeLock } from "#/hooks/use-wake-lock.ts";
import { vibrateArrival } from "#/lib/vibrate.ts";
import { useNavTestToolsEnabled } from "#/integrations/posthog/feature-flags.ts";
import { useTRPC } from "#/integrations/trpc/react.ts";
import { DEV_SPOTS } from "#/lib/dev-location.ts";
import { lazyWithReload } from "#/lib/lazy-with-reload.tsx";
import { preferredRouteLanguage, preferredUnitSystem, valhallaUnits } from "#/lib/units.ts";
import { distanceMeters, pointInPolygon } from "#/server/living/geofence.ts";

import {
  BottomMapCluster,
  LocateButton,
  MapAttribution,
  MapToggleChips,
  ParkChipScroller,
  ParkDetailButton,
  PlayHint,
  RIDE_CATEGORY_KEYS,
  ZoomControl,
} from "./map-controls.tsx";
import { morph, settleMorph } from "./map-morph.ts";
import { useTurnCues } from "./nav-cues.ts";
import {
  buildRouteModel,
  remainingRouteCoords,
  roundCoord,
  routeBearingAt,
} from "./nav-geometry.ts";
import { NavOverlay } from "./nav-overlay.tsx";
import {
  clearNavTrip,
  clearRerouting,
  dropFollow,
  engageFollow,
  NAV_ACCURACY_MAX_M,
  navStore,
  recordNavFix,
  requestNavDirections,
  resolvePendingDest,
  setHeadingUp,
  setMapBearing,
  startNav,
  type NavDest,
} from "./nav-store.ts";
import { fusedHeadingStore, recordCompassHeading, recordHeadingFix } from "./heading-store.ts";
import { type MapHandle } from "./shared.tsx";
import { hasWebGl } from "./webgl.ts";

// Lazy-loaded so the heavy map libraries (maplibre-gl, leaflet) are never
// evaluated on the server — leaflet's UMD touches `window` at import time and
// crashes SSR. The engine is only ever chosen on the client (see `engine`
// below), so the chunks load exactly when a real renderer is mounted.
// `lazyWithReload` recovers from stale-chunk 404s after a redeploy by reloading
// once for fresh HTML instead of surfacing a hard error.
const ParkMap = lazyWithReload(
  () => import("./park-map.tsx").then((m) => ({ default: m.ParkMap })),
  "park-map",
);
const ParkMapLeaflet = lazyWithReload(
  () => import("./park-map-leaflet.tsx").then((m) => ({ default: m.ParkMapLeaflet })),
  "park-map-leaflet",
);

type StageCtx = {
  /**
   * Claim the live map for `slot`: teleports the singleton map's DOM into it
   * and animates from wherever it was. Returns a cleanup that parks the map.
   */
  attach: (slot: HTMLElement) => (() => void) | void;
};

const MapStageContext = React.createContext<StageCtx | null>(null);

function useMapStage() {
  const ctx = React.useContext(MapStageContext);
  if (!ctx) throw new Error("useMapStage must be used within a MapStageProvider");
  return ctx;
}

// Stable empty list for the dev-destination pins when the nav QA tools are off,
// so the renderer's dev-marker effect sees an unchanging identity (no churn).
const EMPTY_DEV_SPOTS: typeof DEV_SPOTS = [];

/**
 * The last map-bearing route the user viewed, so a ride page's "back" affordances
 * (breadcrumb + mobile Map key) return to *where they were on the map* — the
 * free-roam `/map` (its camera restored by the renderer) or a specific park
 * dashboard — instead of always dumping them on the park page. Module-scoped so
 * it outlives the routes that set it; defaults to the `/map` hub.
 */
export type LastMapView = { to: "/map" } | { to: "/park/$slug"; params: { slug: string } };
let lastMapView: LastMapView = { to: "/map" };
export function getLastMapView(): LastMapView {
  return lastMapView;
}

/**
 * Owns a single ParkMap instance and lends its DOM to whichever route mounts a
 * <MapSlot>. Because the same instance simply moves (it never unmounts), the
 * map — and its WebGL context, markers, and camera — survives navigation, so
 * the hero⇄card change is one smooth morph instead of a teardown/redraw.
 */
export function MapStageProvider({
  activeSlug,
  children,
}: {
  activeSlug: string | null;
  children: React.ReactNode;
}) {
  const { selected, setSelected } = useSelection();
  const navigate = useNavigate();
  const trpc = useTRPC();
  const { filter, setFilter } = useRideFilter();
  // The `/map` route is the free-roam map (zoom reveals rides, no navigation);
  // everywhere else the map is route-driven via `activeSlug`.
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const roam = pathname === "/map";
  // The stage now lives on the app-wide shell (`_app`) so the singleton map
  // survives hops to non-dashboard sections. To keep that from taxing routes
  // that never show a map (e.g. `/privacy`), everything heavy self-defers until
  // the first `<MapSlot>` claims the stage: the renderer isn't mounted and the
  // parks query doesn't fetch until then. Once latched it stays true — the map
  // persists for the rest of the session rather than tearing down between views.
  const [hasAttached, setHasAttached] = React.useState(false);
  const parksQ = useQuery({ ...trpc.parks.list.queryOptions(), enabled: hasAttached });
  // Park chips list Disney parks first (the app's primary operator), otherwise
  // preserving the query's resort/name order. `.sort` is stable, so this only
  // hoists Disney to the front.
  const parksDisneyFirst = React.useMemo(() => {
    const parks = parksQ.data ?? [];
    return [...parks].sort(
      (a, b) => (a.operatorSlug === "disney" ? 0 : 1) - (b.operatorSlug === "disney" ? 0 : 1),
    );
  }, [parksQ.data]);

  // The free-roam map opens with the "Rides" chip lit (rides only) rather than
  // every category at once. We seed the shared category filter to the ride group
  // the first time the roam map is shown — but only if the user hasn't already
  // made a category selection, so we never stomp an existing choice. Seeding once
  // (guarded) means turning the Rides chip back off later isn't re-forced on.
  const seededRoamRef = React.useRef(false);
  React.useEffect(() => {
    if (!roam || seededRoamRef.current) return;
    seededRoamRef.current = true;
    setFilter((f) =>
      f.categories.size === 0 ? { ...f, categories: new Set(RIDE_CATEGORY_KEYS) } : f,
    );
  }, [roam, setFilter]);

  // Remember the last map surface the user was on (the roam map, or a park
  // dashboard) so a ride page's back/Map targets can return there. A ride route
  // (`/park/$slug/ride/$rideSlug`) is *not* a map surface — skip it.
  React.useEffect(() => {
    if (roam) lastMapView = { to: "/map" };
    else if (pathname.startsWith("/park/") && !pathname.includes("/ride/") && activeSlug)
      lastMapView = { to: "/park/$slug", params: { slug: activeSlug } };
  }, [pathname, roam, activeSlug]);

  // Roam only: which park's rides are currently revealed (reported by the active
  // renderer), so we can float a "view park details" shortcut over the map.
  const [roamFocusSlug, setRoamFocusSlug] = React.useState<string | null>(null);

  // Kingdom Hearts play mode — an overlay on the roam map, scoped to the currently
  // focused park when it's a Disney park (the live-feed game world is built for
  // Disney; Universal isn't wired). Toggled from the bottom-nav Play button.
  const playMode = useStore(playModeStore, (s) => s.playMode);
  const focusPark = parksQ.data?.find((p) => p.slug === roamFocusSlug) ?? null;
  const isDisneyFocus = focusPark?.operatorSlug === "disney";
  const playActive = playMode && roam && isDisneyFocus;
  // Map-reported taps: a Darkness spawn engaged (→ battle) / the bare map tapped
  // (→ drop a discovery). Cleared whenever play mode isn't actively running.
  const [battleMarkId, setBattleMarkId] = React.useState<number | null>(null);
  const [dropAt, setDropAt] = React.useState<{ lat: number; lng: number } | null>(null);
  React.useEffect(() => {
    if (!playActive) {
      setBattleMarkId(null);
      setDropAt(null);
    }
  }, [playActive]);
  // Tell the bottom-nav Play button when a panel owns the bottom band, so it can
  // fade out of the way (and back in when the panel closes).
  React.useEffect(() => {
    setHudExpanded(playActive && (battleMarkId != null || dropAt != null));
    return () => setHudExpanded(false);
  }, [playActive, battleMarkId, dropAt]);
  // Walking directions — the trip itself lives in the shared nav store (see
  // nav-store.ts for the state shape + transition rules). Per-field selectors
  // (the default compare is `===`), so writes to fields this provider doesn't
  // render — above all `mapBearing`, which changes every animation frame of a
  // rotate — never re-render the whole stage tree. The compass needle subscribes
  // to the bearing itself, inside the overlay. Selected up here because the
  // geolocation watch's power profile hangs off the trip phase.
  const pendingDest = useStore(navStore, (s) => s.pendingDest);
  const trip = useStore(navStore, (s) => s.trip);
  const started = useStore(navStore, (s) => s.started);
  // One geolocation watch for the whole app, owned here so it survives the map
  // moving between routes. Never auto-prompts — the locate button calls locate().
  // Power profile (§1.5): a started trip runs on near-live fixes (a 15 s-stale
  // puck lags ~20 m at walking speed — enough to blow through a turn cue); a
  // pending/previewing trip and play mode need GPS-grade accuracy at the relaxed
  // cadence; plain browsing drops to the low-power profile for battery.
  const geo = useGeolocation({
    watch: true,
    rememberActive: true,
    profile: started ? "nav" : trip != null || pendingDest != null || playActive ? "high" : "low",
  });
  // Live compass heading from the device magnetometer, only while location is
  // on. iOS needs a permission grant from a gesture — hung off the locate tap
  // below. Readings flow straight into the fused-heading store (compass ⊕ GPS
  // movement course, see heading-store.ts) without touching React state, so
  // sensor-rate ticks never re-render this tree — the renderers' cone/rotation
  // consumers subscribe to the store imperatively.
  const compass = useDeviceHeading(geo.state.status === "granted", recordCompassHeading);
  // Feed each fix (and location on/off flips) into the heading fusion — the
  // movement course is what keeps the heading honest while actually walking.
  React.useEffect(() => {
    recordHeadingFix(geo.state);
  }, [geo.state]);
  // Nav QA tools (the local-routing destination picker): always on in dev, and
  // in prod for accounts with the `nav-test-tools` PostHog flag — so it can be
  // dogfooded on a phone without shipping it to everyone.
  const navTestTools = useNavTestToolsEnabled();
  const showNavTest = import.meta.env.DEV || navTestTools;
  // The dev picker's test destinations, handed to the renderer so it can drop
  // temporary pins for them while navigating (they aren't real attractions, so
  // they'd otherwise have no marker). Empty for normal users, so nothing extra
  // renders in prod. Memoized to a stable identity so it doesn't churn the
  // renderer's dev-marker effect.
  const devDestinations = React.useMemo(
    () => (showNavTest ? DEV_SPOTS : EMPTY_DEV_SPOTS),
    [showNavTest],
  );
  // Memoized so its identity only changes on a new GPS fix, keeping the
  // renderers' `userLocation`-keyed effects (follow-cam, marker create) from
  // re-running on unrelated renders. The live fused heading doesn't ride along
  // — the renderers read it from `fusedHeadingStore` imperatively.
  const userLocation = React.useMemo(
    () =>
      geo.state.status === "granted"
        ? { coords: geo.state.coords, accuracy: geo.state.accuracy, heading: geo.state.heading }
        : null,
    [geo.state],
  );
  // Auto-zoom: the first fix while on the overview jumps into the park the user
  // is standing in (or nearest within ~2km, for parking lots / esplanades).
  // Fires once so it never fights the user re-opening the overview.
  const autoNavigatedRef = React.useRef(false);
  React.useEffect(() => {
    // In free-roam the map flies+focuses to the user's park internally (no
    // navigation), so the route-changing auto-zoom is suppressed there.
    if (roam) return;
    if (autoNavigatedRef.current || geo.state.status !== "granted" || activeSlug != null) return;
    const parks = parksQ.data;
    if (!parks || parks.length === 0) return;
    const point = geo.state.coords;
    let match = parks.find((p) => pointInPolygon(point, p.boundary ?? null));
    if (!match) {
      let best = 2000; // metres
      for (const p of parks) {
        if (p.latitude == null || p.longitude == null) continue;
        const d = distanceMeters(point, [p.longitude, p.latitude]);
        if (d < best) {
          best = d;
          match = p;
        }
      }
    }
    if (match) {
      autoNavigatedRef.current = true;
      void navigate({ to: "/park/$slug", params: { slug: match.slug } });
    }
  }, [geo.state, activeSlug, parksQ.data, navigate]);

  const following = useStore(navStore, (s) => s.following);
  const headingUp = useStore(navStore, (s) => s.headingUp);
  const arrived = useStore(navStore, (s) => s.arrived);
  const summary = useStore(navStore, (s) => s.summary);
  const traveled = useStore(navStore, (s) => s.traveled);
  const walkedM = useStore(navStore, (s) => s.walkedM);
  const progress = useStore(navStore, (s) => s.progress);
  const toRouteM = useStore(navStore, (s) => s.toRouteM);
  const rerouting = useStore(navStore, (s) => s.rerouting);
  const rerouteCount = useStore(navStore, (s) => s.rerouteCount);
  // A "Directions" tap snapshots the user's location as the trip origin (so the
  // route doesn't re-fetch/re-frame on every GPS tick) and routes to the
  // destination via the `routing.route` query. A coarse fix — likely under the
  // low-power browse profile — makes a bad origin, so it parks the destination
  // instead: pending flips the watch to the high-accuracy profile, and the next
  // fix resolves it. No fix at all additionally kicks `locate()`.
  const requestDirections = React.useCallback(
    (d: NavDest) => {
      const origin =
        geo.state.status === "granted" && geo.state.accuracy <= NAV_ACCURACY_MAX_M
          ? geo.state.coords
          : null;
      requestNavDirections(d, origin);
      if (geo.state.status !== "granted") geo.locate();
    },
    [geo],
  );
  React.useEffect(() => {
    if (geo.state.status === "granted") resolvePendingDest(geo.state.coords);
  }, [geo.state]);
  // A pending destination that arrived from outside the map — a ride page's
  // "Walk there", a /map?nav= deep link — has no locate() gesture behind it, so
  // kick the watch here. Browsers that insist on a gesture for the permission
  // prompt leave the overlay on "Getting your location…", where the locate
  // button is the manual fallback.
  React.useEffect(() => {
    if (pendingDest != null && (geo.state.status === "idle" || geo.state.status === "error"))
      geo.locate();
  }, [pendingDest, geo]);
  // Feet/miles vs metres/km and the narrative language, from the guest's
  // locale. Units drive both the chrome formatting and the Valhalla narrative so
  // "300 feet" agrees with the bar (§1.4); language localizes the instructions
  // themselves (§5). Stable per session, so computed once.
  const unitSystem = React.useMemo(() => preferredUnitSystem(), []);
  const routeLanguage = React.useMemo(() => preferredRouteLanguage(), []);
  const routeQ = useQuery({
    ...trpc.routing.route.queryOptions({
      // Rounded to ~11 cm so the query key (and any warm cache from a card's
      // walk-time prefetch) is shareable — raw GPS floats never collide (§6).
      from: trip ? roundCoord(trip.from.coords) : [0, 0],
      to: trip ? roundCoord(trip.to.coords) : [0, 0],
      units: valhallaUnits(unitSystem),
      language: routeLanguage,
    }),
    enabled: trip != null,
    // A mid-trip re-route re-keys the origin, which would normally blank the
    // query while the new route loads — jarring during navigation. Keep the
    // previous route drawn (and the "next turn" text intact) until the fresh one
    // arrives, so recalcs are invisible; `isPending` (no data at all) is the only
    // true loading state, reserved for the very first fetch.
    placeholderData: keepPreviousData,
    // Never gate route fetches on `navigator.onLine`. The default networkMode
    // ("online") *pauses* a fetch when the browser thinks it's offline and only
    // resumes on an offline→online transition — but on mobile/PWA that flag is
    // unreliable (it can stay false, or never re-fire `online`, after a blip,
    // captive portal, or flaky cellular). That left the route query stuck in
    // `paused` after a network loss: re-keying (walking / a new destination) just
    // re-parked it, so `routeQ.data` never advanced and the line never redrew —
    // even though the GPS-driven "traveled" breadcrumb kept updating. "always"
    // lets the real fetch decide, and makes the manual Retry reliable too.
    networkMode: "always",
    // The nav overlay already renders routing failures inline ("No walking
    // route found" + the Retry bar), so skip the generic error toast — the
    // failure still reaches telemetry via the query cache's global sink.
    meta: { errorToast: false },
  });
  // `keepPreviousData` keeps the last route cached after the query is disabled,
  // so gate the drawn geometry on an active trip — otherwise clearing/ending nav
  // leaves the route line and dots painted on the map. The route model (prefix
  // sums + per-maneuver distances) is what per-fix progress tracking projects
  // onto; rebuilt only when a fresh route lands, not on every GPS tick.
  const routeModel = React.useMemo(
    () => (trip && routeQ.data ? buildRouteModel(routeQ.data) : null),
    [trip, routeQ.data],
  );
  const routeCoords = trip ? (routeQ.data?.coordinates ?? null) : null;
  // While actively walking, the drawn line is trimmed to what's left to walk —
  // the grayed traveled trail behind it covers where you've been (the old
  // per-10 m refetch redrew the route from the current position and got this
  // for free; the client-side projection has to trim explicitly). Preview and
  // arrival draw the whole route; the full geometry always stays in
  // `routeModel` for the projection/progress math.
  const progressAlongM = started && !arrived ? (progress?.alongM ?? null) : null;
  const drawnRoute = React.useMemo(() => {
    if (!routeCoords) return null;
    if (routeModel && progressAlongM != null)
      return remainingRouteCoords(routeModel, progressAlongM) ?? routeCoords;
    return routeCoords;
  }, [routeCoords, routeModel, progressAlongM]);
  // Latest drawn geometry, read inside the stable overview/bearing callbacks —
  // trimmed while walking, so the route overview frames the *remaining* route
  // and the route-up bearing projects onto the part still ahead.
  const routeCoordsRef = React.useRef(drawnRoute);
  routeCoordsRef.current = drawnRoute;
  // Live fixes drive the trip: progress (next-turn/remaining/ETA), arrival
  // detection, the traveled breadcrumb (snapped to the routed path), and
  // off-route rerouting — all in one store transition per fix (see recordNavFix),
  // projecting onto `routeModel` rather than re-routing every few metres.
  const durationSeconds = routeQ.data?.durationSeconds ?? null;
  const coarseFixStreakRef = React.useRef(0);
  React.useEffect(() => {
    if (geo.state.status !== "granted") return;
    // Accuracy gating (§1.6): a coarse fix (just-woke GPS, a canyon between show
    // buildings) can extend the trail with a bogus point, trigger a needless
    // reroute, or falsely latch arrival — so it doesn't drive the trip. The puck
    // still renders (with its accuracy ring) via `userLocation`. But the gate
    // only rejects *spikes*: when every fix is coarse (indoors, older hardware),
    // an unconditional gate would freeze progress/arrival for the whole walk —
    // so after a streak of rejects the coarse fix drives the trip anyway.
    if (geo.state.accuracy > NAV_ACCURACY_MAX_M && coarseFixStreakRef.current < 3) {
      coarseFixStreakRef.current += 1;
      return;
    }
    coarseFixStreakRef.current = 0;
    recordNavFix(geo.state.coords, routeModel, geo.state.accuracy);
  }, [geo.state, routeModel]);
  // A newly fetched route (identity change on `routeQ.data`) resolves any
  // in-flight reroute — the authoritative clear for the "Rerouting…" state, so it
  // can't stick even if the fresh route lands slightly off the current fix.
  React.useEffect(() => {
    if (routeQ.data) clearRerouting();
  }, [routeQ.data]);
  // Live wait at the destination (§3.5): while heading to an *attraction* the
  // one number that matters is its current wait — a mid-walk spike is a decision
  // the guest wants to make now, so it refreshes on a timer. POI destinations
  // (id absent / non-positive) skip the query and show just the name.
  const destId = trip?.to.id ?? pendingDest?.id ?? null;
  const destWaitQ = useQuery({
    ...trpc.parks.attractionById.queryOptions({ id: destId != null && destId > 0 ? destId : 0 }),
    enabled: (trip != null || pendingDest != null) && destId != null && destId > 0,
    refetchInterval: 60_000,
    meta: { errorToast: false },
  });
  const destWait =
    destWaitQ.data?.status === "OPERATING" ? (destWaitQ.data.standbyWait ?? null) : null;
  // Haptic + spoken cues at each approaching turn (§3.2), driven by the same
  // live projection as the headline. The voice respects the overlay's mute.
  const voiceMuted = useStore(navStore, (s) => s.voiceMuted);
  useTurnCues({
    started,
    arrived,
    muted: voiceMuted,
    progress,
    maneuvers: routeQ.data?.maneuvers ?? null,
    routeModel,
    destName: trip?.to.name ?? "",
    language: routeLanguage,
  });
  // Nav funnel (§6): nav_previewed → nav_started → nav_arrived | nav_abandoned,
  // with trip distance/duration and reroute count. Mid-trip abandonment rate is
  // the metric that says which of the nav improvements actually land. We snapshot
  // the live trip stats into a ref each render so the abandon event (which fires
  // as the store resets to idle) can still report them.
  const tripStatsRef = React.useRef<{
    dest: string;
    distanceMeters: number | null;
    durationSeconds: number | null;
    rerouteCount: number;
  } | null>(null);
  if (trip)
    tripStatsRef.current = {
      dest: trip.to.name,
      distanceMeters: routeQ.data?.distanceMeters ?? null,
      durationSeconds,
      rerouteCount,
    };
  const navPhaseRef = React.useRef({ hadTrip: false, started: false, arrived: false });
  React.useEffect(() => {
    const prev = navPhaseRef.current;
    const hasTrip = trip != null;
    const stats = tripStatsRef.current;
    if (hasTrip && !prev.hadTrip) posthog.capture("nav_previewed", { dest: trip?.to.name });
    if (started && !prev.started)
      posthog.capture("nav_started", {
        dest: stats?.dest,
        distanceMeters: stats?.distanceMeters,
        durationSeconds: stats?.durationSeconds,
      });
    if (arrived && !prev.arrived)
      posthog.capture("nav_arrived", {
        dest: stats?.dest,
        walkedMeters: summary?.walkedMeters,
        elapsedSeconds: summary?.elapsedSeconds,
        rerouteCount: stats?.rerouteCount,
      });
    // Abandoned — an *active* trip cleared before arrival (a preview cancelled
    // before Start doesn't count as abandoning a walk).
    if (!hasTrip && prev.hadTrip && prev.started && !prev.arrived)
      posthog.capture("nav_abandoned", {
        dest: stats?.dest,
        distanceMeters: stats?.distanceMeters,
        rerouteCount: stats?.rerouteCount,
      });
    navPhaseRef.current = { hadTrip: hasTrip, started, arrived };
  }, [trip, started, arrived, summary]);

  // Keep the screen awake for the whole active walk (§3.1) — a phone that sleeps
  // 30 s into a 10-minute route is the biggest real-world flow killer.
  useWakeLock(started && !arrived);
  // Mark the finish with a haptic buzz once arrival latches. The completion card
  // (in the overlay) is the visible confirmation — no toast, which would be a
  // duplicate of the card firing at the same moment (§5). Reset on a fresh trip.
  const arrivedBuzzRef = React.useRef(false);
  React.useEffect(() => {
    if (arrived && !arrivedBuzzRef.current) {
      arrivedBuzzRef.current = true;
      vibrateArrival();
    } else if (!arrived) {
      arrivedBuzzRef.current = false;
    }
  }, [arrived]);
  // While navigating (a resolved trip, or waiting on a location fix for a
  // pending one), the green nav UI takes over and the filter chrome hides.
  const navigating = trip != null || pendingDest != null;
  // The map host is a plain DOM node created imperatively (client-only), NOT a
  // React-rendered element. We then `appendChild` it between the parking div and
  // whichever <MapSlot> claims it. If React owned this node in its tree, moving
  // it by hand would desync the fiber tree from the DOM and the next commit that
  // touched the region would call `removeChild` on a null parent and crash the
  // page (the prod park-page hydration bug). Rendering the map *into* `host` via
  // a portal keeps React treating it as an opaque container, so moving it is safe.
  const [host] = React.useState<HTMLDivElement | null>(() => {
    if (typeof document === "undefined") return null;
    const el = document.createElement("div");
    // `relative` so the overlay controls (locate / filter / directions) anchor to
    // the map area itself, whatever slot it's currently lent to. `rounded-[inherit]`
    // (+ its own `overflow-hidden`) clips the square-cornered maplibre canvas to
    // whatever radius the *current* slot carries — the embedded park card's
    // `rounded-4xl` (on mobile too, where it has no `md:` breakpoint) or the desktop
    // roam card's `rounded-2xl` — while the fullscreen mobile roam slot (no radius)
    // leaves it square. A single static radius couldn't satisfy all three.
    el.className = "relative size-full overflow-hidden rounded-[inherit]";
    return el;
  });
  const parkRef = React.useRef<HTMLDivElement>(null);
  const mapRef = React.useRef<MapHandle | null>(null);

  // Fly the camera in close to the user and (re-)engage the follow-cam — shared
  // by Start and the locate/recenter button while navigating.
  const flyToUser = React.useCallback(() => {
    if (geo.state.status !== "granted") return;
    // Also (re-)request compass access here: this fires from the Start / recenter
    // taps, so it covers the iOS case where location auto-resumed from a past
    // session (no locate tap) and the per-gesture orientation grant was never
    // asked for. A no-op once already granted / off iOS.
    compass.requestPermission();
    engageFollow();
    mapRef.current?.flyToLocation(geo.state.coords, {
      zoom: 17.5,
      // Heading-up means *route*-up while navigating: point the camera the way
      // the route goes (stable), not wherever the device compass happens to
      // swing. The fused heading is only the fallback when there's no route
      // geometry yet (crow-flies nav).
      bearing:
        routeBearingAt(routeCoordsRef.current, geo.state.coords) ??
        fusedHeadingStore.state ??
        geo.state.heading ??
        0,
      // Engage the tilted walking-nav framing (puck low, pitched) — follow +
      // heading-up are engaged together, so the close-up is always heading-up.
      tilt: true,
    });
  }, [geo, compass.requestPermission]);
  const handleStart = React.useCallback(() => {
    startNav();
    flyToUser();
  }, [flyToUser]);
  // Turning on locate is the natural gesture to also grant compass access (iOS
  // gates the magnetometer behind a per-gesture prompt); no-op elsewhere.
  const activateLocate = React.useCallback(() => {
    compass.requestPermission();
    geo.locate();
  }, [compass.requestPermission, geo.locate]);
  // Compass tap: toggle heading-up, snapping the map bearing to the heading (or
  // back to north). GL only — Leaflet's `setBearing` is a no-op.
  const toggleHeadingUp = React.useCallback(() => {
    const next = !navStore.state.headingUp;
    // Route direction first (heading-up is route-up while navigating), fused
    // device heading only as the no-route fallback.
    const h =
      (geo.state.status === "granted"
        ? routeBearingAt(routeCoordsRef.current, geo.state.coords)
        : null) ??
      fusedHeadingStore.state ??
      (geo.state.status === "granted" ? geo.state.heading : null);
    // Tilt with heading-up; flatten back on north-lock (§3.3). While following,
    // re-frame around the puck via flyToLocation so the tilt lands with the same
    // lower-third offset the per-fix follow easeTo applies — a bare setBearing
    // would pitch with the puck still centered, then hitch to the offset framing
    // on the next fix.
    if (navStore.state.following && geo.state.status === "granted") {
      mapRef.current?.flyToLocation(geo.state.coords, {
        bearing: next ? (h ?? 0) : 0,
        tilt: next,
        duration: 400,
      });
    } else {
      mapRef.current?.setBearing(next ? (h ?? 0) : 0, { tilt: next });
    }
    setHeadingUp(next);
  }, [geo]);
  // Route overview (§3.4): drop the follow-cam so it doesn't immediately snap
  // back, then frame the whole remaining route. The recenter/locate button (shown
  // while navigating) re-engages follow.
  const showRouteOverview = React.useCallback(() => {
    dropFollow();
    mapRef.current?.fitRoute(routeCoordsRef.current);
  }, []);

  // Park the host in its off-screen home on mount, unless a <MapSlot>'s layout
  // effect (which fires first, child-before-parent) already claimed it.
  React.useLayoutEffect(() => {
    if (host && parkRef.current && host.parentNode == null) parkRef.current.appendChild(host);
  }, [host]);
  // Pick the renderer once on the client: MapLibre (WebGL) when available, the
  // Leaflet DOM/raster renderer otherwise — so a WebGL-disabled browser degrades
  // gracefully instead of crashing. `null` until detected, so SSR and the first
  // paint render no engine (the host stays an empty box) and there's no
  // server/client engine mismatch to hydrate.
  const [engine, setEngine] = React.useState<"gl" | "leaflet" | null>(null);
  const engineDetectedRef = React.useRef(false);
  React.useEffect(() => {
    // Detect lazily, only once the stage is actually claimed — so map-less routes
    // don't probe WebGL (and can't skew the leaflet-fallback metric below).
    if (!hasAttached || engineDetectedRef.current) return;
    engineDetectedRef.current = true;
    const gl = hasWebGl();
    setEngine(gl ? "gl" : "leaflet");
    // Expected on old/hardened devices, but worth trending — a rising share means
    // more users are stuck on the degraded raster renderer.
    if (!gl) posthog.capture("map_fallback_leaflet", { parkSlug: activeSlug });
  }, [hasAttached, activeSlug]);
  // Whether the singleton map is currently lent to a visible slot. While false
  // it's parked in the 0×0 off-screen home, where camera flies must not run —
  // Leaflet computes NaN coordinates fitting bounds into a zero-size container
  // and throws "Invalid LatLng object: (NaN, NaN)". The engines gate their fly
  // on this and re-fit when it flips true.
  const [attached, setAttached] = React.useState(false);
  // Geometry of the slot we just left, carried into the next attach() to seed
  // the FLIP. Set on the outgoing slot's cleanup (mutation phase), consumed by
  // the incoming slot's layout effect.
  const prevRectRef = React.useRef<DOMRect | null>(null);
  const slotRef = React.useRef<HTMLElement | null>(null);

  const onMapRef = React.useCallback((m: MapHandle | null) => {
    mapRef.current = m;
  }, []);

  const attach = React.useCallback(
    (slot: HTMLElement) => {
      if (!host) return;
      slotRef.current = slot;
      // First claim ever: latch the renderer + parks query on (see `hasAttached`).
      setHasAttached(true);
      setAttached(true);
      const first = prevRectRef.current;
      prevRectRef.current = null;

      slot.appendChild(host);
      // Strip any geometry a prior (possibly interrupted) morph left inline, so
      // the host measures and settles as a clean `size-full` child of this slot
      // and is clipped by the slot's rounded overflow — otherwise a leftover
      // `position: fixed` keeps the map out of the clip and it spills past the
      // card's corners. A fresh `morph` below re-applies what it needs.
      settleMorph(host);
      const last = host.getBoundingClientRect();
      const resize = () => mapRef.current?.resize();

      // Only morph when the map is actually changing box between two visible
      // slots. If it's landing essentially where it left off — the common case
      // of returning to the fullscreen map from a slot-less page (Waits, Eats…),
      // where `first` is a stale near-identical fullscreen rect — a morph would
      // just be a motionless overlay for MORPH_MS, so skip straight to a resize.
      const moved =
        first != null &&
        (Math.abs(first.left - last.left) > 4 ||
          Math.abs(first.top - last.top) > 4 ||
          Math.abs(first.width - last.width) > 4 ||
          Math.abs(first.height - last.height) > 4);

      if (
        first != null &&
        moved &&
        first.width > 4 &&
        first.height > 4 &&
        last.width > 4 &&
        last.height > 4
      ) {
        morph(host, first, slot, resize);
      } else {
        resize();
      }

      return () => {
        if (slotRef.current !== slot) return;
        // Remember where we are so the next slot can morph from here, then tuck
        // the map into its hidden parking spot until the next slot claims it.
        prevRectRef.current = host.getBoundingClientRect();
        parkRef.current?.appendChild(host);
        slotRef.current = null;
        setAttached(false);
      };
    },
    [host],
  );

  const value = React.useMemo(() => ({ attach }), [attach]);

  return (
    <MapStageContext.Provider value={value}>
      {/* Off-screen home for the singleton map whenever no slot owns it. The
          host node itself is created imperatively and lives in `host` — it's
          never a React child, so React never tries to move/remove it (see the
          `host` state above). The map renders *into* it via the portal below. */}
      <div ref={parkRef} className="pointer-events-none fixed -z-10 size-0 opacity-0" aria-hidden />
      {host &&
        createPortal(
          <>
            <React.Suspense fallback={null}>
              {hasAttached && engine === "gl" && (
                <ParkMap
                  activeSlug={activeSlug}
                  selectedId={selected?.id ?? null}
                  onSelectAttraction={setSelected}
                  onDeselect={() => setSelected(null)}
                  onMapRef={onMapRef}
                  attached={attached}
                  userLocation={userLocation}
                  route={drawnRoute}
                  traveled={started && traveled.length > 1 ? traveled : null}
                  animateRoute={started && !arrived}
                  onRequestDirections={requestDirections}
                  navDest={started && trip ? trip.to.coords : null}
                  devDestinations={devDestinations}
                  follow={following}
                  headingUp={headingUp}
                  onBearingChange={setMapBearing}
                  onUserInteract={dropFollow}
                  roam={roam}
                  filter={filter}
                  onRoamFocusChange={setRoamFocusSlug}
                  play={playActive}
                  playParkSlug={roamFocusSlug}
                  onEngageDarkness={(id) => {
                    setDropAt(null);
                    setBattleMarkId(id);
                  }}
                  onDropDiscovery={(p) => {
                    if (battleMarkId == null) setDropAt(p);
                  }}
                />
              )}
              {hasAttached && engine === "leaflet" && (
                <ParkMapLeaflet
                  activeSlug={activeSlug}
                  selectedId={selected?.id ?? null}
                  onSelectAttraction={setSelected}
                  onDeselect={() => setSelected(null)}
                  onMapRef={onMapRef}
                  attached={attached}
                  userLocation={userLocation}
                  route={drawnRoute}
                  traveled={started && traveled.length > 1 ? traveled : null}
                  animateRoute={started && !arrived}
                  onRequestDirections={requestDirections}
                  navDest={started && trip ? trip.to.coords : null}
                  devDestinations={devDestinations}
                  follow={following}
                  onUserInteract={dropFollow}
                  roam={roam}
                  filter={filter}
                  onRoamFocusChange={setRoamFocusSlug}
                />
              )}
            </React.Suspense>
            {/* Top-left cluster (roam, once a park is focused): the park-details
                shortcut sits directly below the search bar, with the map-layer
                toggle chips beneath it. The chip row scrolls horizontally if it
                can't fit. */}
            {attached && engine && roam && !navigating && (
              <div
                data-map-chrome="top"
                className="pointer-events-none absolute inset-x-3 top-[calc(var(--safe-top)+4.5rem)] z-10 flex flex-col items-start gap-1 md:top-3"
              >
                <ParkChipScroller
                  parks={parksDisneyFirst}
                  focusSlug={roamFocusSlug}
                  onZoom={(slug) => mapRef.current?.flyToPark(slug)}
                />
                {/* Layer toggle chips only for Disney — Universal parks don't
                    have the ride/show/venue category data behind them yet. */}
                {roamFocusSlug && isDisneyFocus && <MapToggleChips />}
              </div>
            )}
            {/* Nav QA tool: quick-destination picker for testing walking
                directions from your real location. On in dev, and in prod for
                accounts with the `nav-test-tools` flag (see `showNavTest`). */}
            {showNavTest && attached && engine && (
              <DevLocationPanel
                activeDest={trip?.to ?? null}
                onNavigate={(d) => requestDirections({ id: -1, name: d.name, coords: d.coords })}
                onEndNav={clearNavTrip}
              />
            )}
            {/* Bottom-right control column: zoom group, locate, and the credits
                chip stacked top-to-bottom. One bottom-anchored flex column owns
                the positioning (and lifts clear of the nav ETA bar while
                navigating), so the controls stay a real stack instead of three
                separately-positioned elements. */}
            {attached && engine && (
              <BottomMapCluster side="right" fullBleed={roam} lifted={navigating}>
                <ZoomControl
                  onZoomIn={() => mapRef.current?.zoomIn()}
                  onZoomOut={() => mapRef.current?.zoomOut()}
                />
                {/* Locate is the free-roam map's control (find yourself in the
                    park). Embedded maps — a park page's overview card — aren't a
                    "you are here" surface, so it's hidden there; the exception is
                    an active nav trip, where the same button doubles as recenter. */}
                {(roam || started) && (
                  <LocateButton
                    state={geo.state}
                    // While navigating, the locate button doubles as recenter — it
                    // re-engages the follow-cam (and heading-up) after a manual pan.
                    // Otherwise it's a toggle: on when off, off when already tracking.
                    onClick={
                      started
                        ? flyToUser
                        : geo.state.status === "granted"
                          ? geo.deactivate
                          : activateLocate
                    }
                  />
                )}
                <MapAttribution />
              </BottomMapCluster>
            )}
            {/* Bottom-left cluster (roam, once a park is focused): the park-details
                shortcut stacked directly on top of the ride filter button. Both are
                hidden at the all-parks overview — there's no single park to open or
                filter until you've zoomed into one. */}
            {attached && engine && roam && !playMode && roamFocusSlug && !navigating && (
              <BottomMapCluster side="left">
                <ParkDetailButton slug={roamFocusSlug} />
                <RideFilterButton className="pointer-events-auto gap-1.5 px-4 py-2 text-sm [&>svg]:size-4" />
              </BottomMapCluster>
            )}
            {/* Kingdom Hearts play overlay — GL renderer only. Live over a focused
                Disney park; otherwise a hint points the player at one. */}
            {attached && engine === "gl" && roam && playMode ? (
              isDisneyFocus && roamFocusSlug ? (
                <PlayOverlay
                  parkSlug={roamFocusSlug}
                  battleMarkId={battleMarkId}
                  dropAt={dropAt}
                  onCloseBattle={() => setBattleMarkId(null)}
                  onCloseDrop={() => setDropAt(null)}
                />
              ) : (
                <PlayHint>Kingdom Hearts is live at Disney parks — zoom into one to play.</PlayHint>
              )
            ) : null}
            {attached && engine === "leaflet" && roam && playMode ? (
              <PlayHint>Kingdom Hearts needs a WebGL-capable browser to play.</PlayHint>
            ) : null}
            {attached && navigating && (
              <NavOverlay
                destName={trip?.to.name ?? pendingDest?.name ?? ""}
                geoStatus={
                  geo.state.status === "denied" || geo.state.status === "unavailable"
                    ? geo.state.status
                    : null
                }
                onRetryLocation={activateLocate}
                locating={trip == null}
                // Only the very first fetch is a "loading" state — mid-trip
                // recalcs keep the previous route (keepPreviousData), so
                // `isPending` (never had data) is the sole spinner trigger.
                loading={routeQ.isPending && trip != null}
                // A full failure only after React Query's retries are exhausted
                // and we have no route to fall back on — that's when the user
                // needs the manual Retry.
                error={routeQ.isError && !routeQ.data}
                arrived={arrived}
                summary={summary}
                walkedMeters={walkedM}
                distanceMeters={routeQ.data?.distanceMeters ?? null}
                durationSeconds={durationSeconds}
                maneuvers={routeQ.data?.maneuvers ?? null}
                progress={progress}
                toRouteM={toRouteM}
                rerouting={rerouting}
                unitSystem={unitSystem}
                destWait={destWait}
                userCoords={geo.state.status === "granted" ? geo.state.coords : null}
                destCoords={trip?.to.coords ?? pendingDest?.coords ?? null}
                started={started}
                canRotate={engine === "gl"}
                headingUp={headingUp}
                onStart={handleStart}
                onRetry={() => void routeQ.refetch()}
                onToggleHeadingUp={toggleHeadingUp}
                onOverview={showRouteOverview}
                onClear={clearNavTrip}
              />
            )}
          </>,
          host,
        )}
      {children}
    </MapStageContext.Provider>
  );
}

/**
 * Reserves layout space for the shared map in a route and claims the live map
 * on mount. Style it like any container — the map fills it.
 */
// The full-bleed mobile map is a `fixed inset-0` layer, so its bottom edge
// tracks the layout viewport. When the omni-search opens, Android reserves space
// for the gesture/navigation bar (the WebView content area shrinks by ~the bar's
// height); `inset-0`'s bottom rises, the map container shrinks, and its
// `ResizeObserver` shrinks the canvas with it — the map visibly loses a strip.
//
// Pin the layer to the *largest* height we've seen at the current orientation
// instead: top-anchored at a fixed pixel height that only ever grows, so a
// transient inset/viewport shrink can't reduce it. A real orientation change
// (width flips) resets the baseline so rotation still resizes normally.
function useStableFullBleedHeight(enabled: boolean): number | undefined {
  const [height, setHeight] = React.useState<number>();

  React.useEffect(() => {
    if (!enabled) {
      setHeight(undefined);
      return;
    }
    let max = window.innerHeight;
    let width = window.innerWidth;
    setHeight(max);
    const update = () => {
      if (window.innerWidth !== width) {
        // Orientation / real layout change: rebaseline to the new viewport.
        width = window.innerWidth;
        max = window.innerHeight;
        setHeight(max);
      } else if (window.innerHeight > max) {
        // Same orientation: only grow (e.g. the gesture bar releases its space),
        // never shrink.
        max = window.innerHeight;
        setHeight(max);
      }
    };
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, [enabled]);

  return height;
}

/**
 * Renders a slot the singleton map attaches into. `pinnedFullBleed` marks the
 * fullscreen mobile map route: it holds the `fixed inset-0` layer at a stable
 * height so the omni-search (or anything that briefly steals bottom inset) can't
 * shrink it — see {@link useStableFullBleedHeight}.
 */
export function MapSlot({
  className,
  pinnedFullBleed = false,
}: {
  className?: string;
  pinnedFullBleed?: boolean;
}) {
  const { attach } = useMapStage();
  const ref = React.useRef<HTMLDivElement>(null);
  const isMobile = useIsMobile();
  const pinnedHeight = useStableFullBleedHeight(pinnedFullBleed && isMobile);

  // Layout effect (not passive) so the FLIP measures and starts before paint —
  // no flash of the map in its destination before it animates in.
  React.useLayoutEffect(() => {
    if (!ref.current) return;
    return attach(ref.current);
  }, [attach]);

  // Only override geometry on the mobile full-bleed layer; desktop keeps the
  // className's `md:` sizing untouched. Anchoring top + height (bottom:auto)
  // lets the map keep extending under the gesture bar at its intended size.
  const style =
    pinnedHeight == null ? undefined : { height: pinnedHeight, top: 0, bottom: "auto" as const };

  return <div ref={ref} className={className} style={style} />;
}
