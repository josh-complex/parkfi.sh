"use client";

import * as React from "react";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useStore } from "@tanstack/react-store";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import posthog from "posthog-js";

import { playModeStore, setHudExpanded } from "#/components/living/play-mode.ts";
import { PlayOverlay } from "#/components/living/play-overlay.tsx";
import { DevLocationPanel } from "#/components/park-map/dev-location-panel.tsx";
import { useSelection } from "#/components/park-dashboard/selection-context.tsx";
import { RideFilterButton } from "#/components/rides/ride-filter-button.tsx";
import { useRideFilter } from "#/components/rides/ride-filter.tsx";
import { useDeviceHeading } from "#/hooks/use-device-heading.ts";
import { useGeolocation } from "#/hooks/use-geolocation.ts";
import { useNavTestToolsEnabled } from "#/integrations/posthog/feature-flags.ts";
import { useTRPC } from "#/integrations/trpc/react.ts";
import { DEV_SPOTS } from "#/lib/dev-location.ts";
import { lazyWithReload } from "#/lib/lazy-with-reload.tsx";
import { distanceMeters, pointInPolygon } from "#/server/living/geofence.ts";

import {
  LocateButton,
  MapToggleChips,
  ParkChipScroller,
  ParkDetailButton,
  PlayHint,
  RIDE_CATEGORY_KEYS,
  ZoomControl,
} from "./map-controls.tsx";
import { morph } from "./map-morph.ts";
import { NavOverlay } from "./nav-overlay.tsx";
import {
  clearNavTrip,
  dropFollow,
  engageFollow,
  navStore,
  recordNavFix,
  requestNavDirections,
  resolvePendingDest,
  setHeadingUp,
  setMapBearing,
  startNav,
  swapNavEnds,
  type NavDest,
} from "./nav-store.ts";
import { type MapHandle } from "./shared.tsx";
import { useFusedHeading } from "./use-fused-heading.ts";
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
  const parksQ = useQuery(trpc.parks.list.queryOptions());
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
  // One geolocation watch for the whole app, owned here so it survives the map
  // moving between routes. Never auto-prompts — the locate button calls locate().
  const geo = useGeolocation({ watch: true, rememberActive: true });
  // Live compass heading from the device magnetometer, only while location is on.
  // iOS needs a permission grant from a gesture — hung off the locate tap below.
  const compass = useDeviceHeading(geo.state.status === "granted");
  // The heading handed to the renderers (facing cone + heading-up rotation):
  // the compass fused with the GPS movement course — while walking, the
  // direction you're actually moving is weighted over the (orientation-
  // sensitive) magnetometer unless the compass says you're actively turning.
  const fusedHeading = useFusedHeading(geo.state, compass.heading);
  // Read the fused heading inside callbacks via a ref, so they aren't recreated
  // on every sensor tick (they'd otherwise churn effects that list them as deps).
  const fusedHeadingRef = React.useRef<number | null>(null);
  fusedHeadingRef.current = fusedHeading;
  // Nav QA tools (the local-routing destination picker): always on in dev, and
  // in prod for accounts with the `nav-test-tools` PostHog flag — so it can be
  // dogfooded on a phone without shipping it to everyone.
  const navTestTools = useNavTestToolsEnabled();
  const showNavTest = import.meta.env.DEV || navTestTools;
  // The dev picker's test destinations, handed to the renderer so it can drop
  // temporary pins for them while navigating (they aren't real attractions, so
  // they'd otherwise have no marker). Empty for normal users, so nothing extra
  // renders in prod. Memoized to a stable identity so it doesn't churn the
  // renderer's dev-marker effect on every compass tick.
  const devDestinations = React.useMemo(
    () => (showNavTest ? DEV_SPOTS : EMPTY_DEV_SPOTS),
    [showNavTest],
  );
  // Memoized so its identity only changes on a new GPS fix — not on every compass
  // tick — keeping the renderers' `userLocation`-keyed effects (follow-cam, marker
  // create) from re-running at sensor rate. The live fused heading rides down
  // separately as `deviceHeading`.
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

  // Walking directions — the trip itself lives in the shared nav store (see
  // nav-store.ts for the state shape + transition rules). A "Directions" tap
  // snapshots the user's location as the trip origin (so the route doesn't
  // re-fetch/re-frame on every GPS tick) and routes to the destination via the
  // `routing.route` query. If location isn't granted yet, the store parks the
  // destination and the effect below fulfills it once a fix arrives.
  const {
    pendingDest,
    trip,
    started,
    following,
    headingUp,
    arrived,
    summary,
    traveled,
    mapBearing,
  } = useStore(navStore);
  const requestDirections = React.useCallback(
    (d: NavDest) => {
      requestNavDirections(d, geo.state.status === "granted" ? geo.state.coords : null);
      if (geo.state.status !== "granted") geo.locate();
    },
    [geo],
  );
  React.useEffect(() => {
    if (geo.state.status === "granted") resolvePendingDest(geo.state.coords);
  }, [geo.state]);
  const routeQ = useQuery({
    ...trpc.routing.route.queryOptions({
      from: trip?.from.coords ?? [0, 0],
      to: trip?.to.coords ?? [0, 0],
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
  });
  // `keepPreviousData` keeps the last route cached after the query is disabled,
  // so gate the drawn geometry on an active trip — otherwise clearing/ending nav
  // leaves the route line and dots painted on the map.
  const routeCoords = trip ? (routeQ.data?.coordinates ?? null) : null;
  // Live fixes drive the trip: arrival detection, the traveled breadcrumb
  // (snapped to the routed path), and the mid-trip re-route throttle — all in
  // one store transition per fix (see recordNavFix).
  const durationSeconds = routeQ.data?.durationSeconds ?? null;
  React.useEffect(() => {
    if (geo.state.status === "granted")
      recordNavFix(geo.state.coords, routeCoords, durationSeconds);
  }, [geo.state, routeCoords, durationSeconds]);
  // Announce the finish once, when arrival first latches (the summary card takes
  // over the overlay at the same moment). Reset when a fresh trip clears it.
  const arrivedToastRef = React.useRef(false);
  React.useEffect(() => {
    if (arrived && !arrivedToastRef.current) {
      arrivedToastRef.current = true;
      const name = navStore.state.trip?.to.name;
      toast.success("You’ve completed your navigation!", {
        description: name ? `You’ve arrived at ${name}.` : "You’ve arrived at your destination.",
      });
    } else if (!arrived) {
      arrivedToastRef.current = false;
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
    // the map area itself, whatever slot it's currently lent to. Rounded to match
    // the desktop content card (app-inset.tsx) so the square-cornered maplibre
    // canvas doesn't poke past its rounded corners; mobile's fullscreen slot has
    // no rounding to match, so this is a no-op there.
    el.className = "relative size-full overflow-hidden md:rounded-2xl";
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
      bearing: fusedHeadingRef.current ?? geo.state.heading ?? 0,
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
    const h =
      fusedHeadingRef.current ?? (geo.state.status === "granted" ? geo.state.heading : null);
    mapRef.current?.setBearing(next ? (h ?? 0) : 0);
    setHeadingUp(next);
  }, [geo]);

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
    if (engineDetectedRef.current) return;
    engineDetectedRef.current = true;
    const gl = hasWebGl();
    setEngine(gl ? "gl" : "leaflet");
    // Expected on old/hardened devices, but worth trending — a rising share means
    // more users are stuck on the degraded raster renderer.
    if (!gl) posthog.capture("map_fallback_leaflet", { parkSlug: activeSlug });
  }, [activeSlug]);
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
      setAttached(true);
      const first = prevRectRef.current;
      prevRectRef.current = null;

      slot.appendChild(host);
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
              {engine === "gl" && (
                <ParkMap
                  activeSlug={activeSlug}
                  selectedId={selected?.id ?? null}
                  onSelectAttraction={setSelected}
                  onDeselect={() => setSelected(null)}
                  onMapRef={onMapRef}
                  attached={attached}
                  userLocation={userLocation}
                  deviceHeading={fusedHeading}
                  route={routeCoords}
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
              {engine === "leaflet" && (
                <ParkMapLeaflet
                  activeSlug={activeSlug}
                  selectedId={selected?.id ?? null}
                  onSelectAttraction={setSelected}
                  onDeselect={() => setSelected(null)}
                  onMapRef={onMapRef}
                  attached={attached}
                  userLocation={userLocation}
                  deviceHeading={fusedHeading}
                  route={routeCoords}
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
                className="pointer-events-none absolute inset-x-3 top-[calc(env(safe-area-inset-top)+4.5rem)] z-10 flex flex-col items-start gap-1 md:top-3"
              >
                <ParkChipScroller
                  parks={parksDisneyFirst}
                  focusSlug={roamFocusSlug}
                  onZoom={(slug) => mapRef.current?.flyToPark(slug)}
                />
                {roamFocusSlug && <MapToggleChips />}
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
            {attached && engine && (
              <ZoomControl
                onZoomIn={() => mapRef.current?.zoomIn()}
                onZoomOut={() => mapRef.current?.zoomOut()}
                raised={navigating}
              />
            )}
            {attached && engine && (
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
                raised={navigating}
              />
            )}
            {/* Bottom-left cluster (roam, once a park is focused): the park-details
                shortcut stacked directly on top of the ride filter button. Both are
                hidden at the all-parks overview — there's no single park to open or
                filter until you've zoomed into one. */}
            {attached && engine && roam && !playMode && roamFocusSlug && !navigating && (
              <div
                data-map-chrome="bottom"
                className="pointer-events-none absolute left-3 bottom-[calc(var(--bottom-nav-height)+var(--safe-bottom)+1.25rem)] z-10 flex flex-col items-start gap-2 md:bottom-3"
              >
                <ParkDetailButton slug={roamFocusSlug} />
                <RideFilterButton className="pointer-events-auto gap-1.5 px-4 py-2 text-sm [&>svg]:size-4" />
              </div>
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
                geoBlocked={geo.state.status === "denied" || geo.state.status === "unavailable"}
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
                distanceMeters={routeQ.data?.distanceMeters ?? null}
                durationSeconds={durationSeconds}
                maneuvers={routeQ.data?.maneuvers ?? null}
                started={started}
                canRotate={engine === "gl"}
                headingUp={headingUp}
                bearing={mapBearing}
                onStart={handleStart}
                onRetry={() => void routeQ.refetch()}
                onToggleHeadingUp={toggleHeadingUp}
                onSwap={swapNavEnds}
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
export function MapSlot({ className }: { className?: string }) {
  const { attach } = useMapStage();
  const ref = React.useRef<HTMLDivElement>(null);

  // Layout effect (not passive) so the FLIP measures and starts before paint —
  // no flash of the map in its destination before it animates in.
  React.useLayoutEffect(() => {
    if (!ref.current) return;
    return attach(ref.current);
  }, [attach]);

  return <div ref={ref} className={className} />;
}
