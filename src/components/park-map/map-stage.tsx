"use client";

import * as React from "react";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useStore } from "@tanstack/react-store";
import {
  ArrowUpRightIcon,
  DramaIcon,
  LoaderCircleIcon,
  LocateFixedIcon,
  MinusIcon,
  PlusIcon,
  RollerCoasterIcon,
  ShoppingBagIcon,
  UtensilsIcon,
  XIcon,
  type LucideIcon,
} from "lucide-react";
import { createPortal } from "react-dom";

import { playModeStore, setHudExpanded } from "#/components/living/play-mode.ts";
import { PlayOverlay } from "#/components/living/play-overlay.tsx";
import { useSelection } from "#/components/park-dashboard/selection-context.tsx";
import { RideFilterButton } from "#/components/rides/ride-filter-button.tsx";
import { type MapLayers, useRideFilter } from "#/components/rides/ride-filter.tsx";
import { useGeolocation, type GeoState } from "#/hooks/use-geolocation.ts";
import { useTRPC } from "#/integrations/trpc/react.ts";
import { cn } from "#/lib/utils.ts";
import { lazyWithReload } from "#/lib/lazy-with-reload.tsx";
import { distanceMeters, pointInPolygon } from "#/server/living/geofence.ts";

import { MAP_TYPE_COLOR, type MapHandle, type MapItemKind } from "./shared.tsx";
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

// Length of the hero⇄card morph. Snappy, then the camera fly follows (see
// MORPH_MS in park-map.tsx, kept in lockstep so the fly waits for the box).
export const MORPH_MS = 420;

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
const INLINE_PROPS = [
  "position",
  "margin",
  "z-index",
  "left",
  "top",
  "width",
  "height",
  "will-change",
] as const;

// easeOutBack — overshoots slightly past the target before settling, for a
// springy little landing. `c1` tunes the bounce (higher = more overshoot).
function ease(t: number): number {
  const c1 = 1.5;
  const c3 = c1 + 1;
  const u = t - 1;
  return 1 + c3 * u * u * u + c1 * u * u;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

// Tears down any morph currently in flight on a given host, so a fast second
// navigation can claim the map without the prior morph's resize loop stomping
// the new morph's inline geometry.
const morphCleanup = new WeakMap<HTMLElement, () => void>();

/**
 * Morph `host` from `first` toward `slot`'s box by animating its *real* geometry
 * — left/top/width/height — and calling MapLibre's own `resize()` on every frame
 * so the map re-lays-out to fill its container as the box changes. We transition
 * the parent and let the map track it, rather than scaling a fixed-size canvas
 * with a CSS transform (which leaves the map's dimensions stale mid-flight, so
 * the layout appears not to adjust while the camera flies).
 *
 * The target is re-read from `slot.getBoundingClientRect()` *every frame* rather
 * than snapshotted once: the destination slot's flex height can still be
 * settling when the morph starts (its content/scroll height isn't final until
 * after paint), and snapshotting a stale value is what made the box land short
 * and then "pop" to full size at the end. Tracking the live rect lands it
 * exactly, no pop.
 *
 * The host is lifted to <body> as a fixed overlay so no transformed/clipped
 * ancestor distorts the coordinates, then re-homed into `slot` when done.
 */
function morph(host: HTMLElement, first: DOMRect, slot: HTMLElement, resize: () => void) {
  morphCleanup.get(host)?.();
  document.body.appendChild(host);
  Object.assign(host.style, {
    position: "fixed",
    margin: "0",
    // Below the floating chrome — the mobile header is z-30 and the bottom nav
    // z-40, and on the fullscreen `/map` route the map rests at z-0 *behind*
    // them (they show it through their transparent areas). Lifting the morph
    // overlay above the bars (it used to be z-40) covered them for the whole
    // morph, then dropped back to z-0 — so the chrome blinked out and popped
    // back in on every return to the map. Staying under the bars keeps them
    // visible throughout; z-20 is still above page content for the card morph.
    zIndex: "20",
    left: `${first.left}px`,
    top: `${first.top}px`,
    width: `${first.width}px`,
    height: `${first.height}px`,
    willChange: "left, top, width, height",
  });
  resize();

  let raf = 0;
  let start = 0;
  let done = false;
  const teardown = () => {
    done = true;
    cancelAnimationFrame(raf);
    morphCleanup.delete(host);
  };
  morphCleanup.set(host, teardown);

  const tick = (now: number) => {
    if (!start) start = now;
    const t = Math.min(1, (now - start) / MORPH_MS);
    const e = ease(t);
    // Live target — picks up the slot's settling height/width as it finalizes.
    const to = slot.getBoundingClientRect();
    host.style.left = `${lerp(first.left, to.left, e)}px`;
    host.style.top = `${lerp(first.top, to.top, e)}px`;
    host.style.width = `${lerp(first.width, to.width, e)}px`;
    host.style.height = `${lerp(first.height, to.height, e)}px`;
    resize();
    if (t < 1 && !done) {
      raf = requestAnimationFrame(tick);
      return;
    }
    teardown();
    // Re-home into the slot only if it's still the one we were animating into;
    // otherwise a newer navigation already claimed the map and we must not
    // steal it back.
    if (host.parentElement !== slot && slot.isConnected) slot.appendChild(host);
    for (const p of INLINE_PROPS) host.style.removeProperty(p);
    resize();
  };
  raf = requestAnimationFrame(tick);
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
  const geo = useGeolocation({ watch: true });
  const userLocation =
    geo.state.status === "granted"
      ? { coords: geo.state.coords, accuracy: geo.state.accuracy }
      : null;
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

  // Walking directions. A "Directions" tap snapshots the user's location as the
  // trip origin (so the route doesn't re-fetch/re-frame on every GPS tick) and
  // routes to the destination via the `routing.route` query. If location isn't
  // granted yet, we stash the destination and fulfill it once a fix arrives.
  type Dest = { id: number; name: string; coords: [number, number] };
  const [pendingDest, setPendingDest] = React.useState<Dest | null>(null);
  const [trip, setTrip] = React.useState<{ origin: [number, number]; dest: Dest } | null>(null);
  const requestDirections = React.useCallback(
    (d: Dest) => {
      if (geo.state.status === "granted") setTrip({ origin: geo.state.coords, dest: d });
      else {
        setPendingDest(d);
        geo.locate();
      }
    },
    [geo],
  );
  React.useEffect(() => {
    if (geo.state.status === "granted" && pendingDest) {
      setTrip({ origin: geo.state.coords, dest: pendingDest });
      setPendingDest(null);
    }
  }, [geo.state, pendingDest]);
  const routeQ = useQuery({
    ...trpc.routing.route.queryOptions({
      from: trip?.origin ?? [0, 0],
      to: trip?.dest.coords ?? [0, 0],
    }),
    enabled: trip != null,
  });
  const clearTrip = React.useCallback(() => {
    setTrip(null);
    setPendingDest(null);
  }, []);
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
    // the map area itself, whatever slot it's currently lent to.
    el.className = "relative size-full overflow-hidden";
    return el;
  });
  const parkRef = React.useRef<HTMLDivElement>(null);
  const mapRef = React.useRef<MapHandle | null>(null);

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
  React.useEffect(() => setEngine(hasWebGl() ? "gl" : "leaflet"), []);
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
                  route={routeQ.data?.coordinates ?? null}
                  onRequestDirections={requestDirections}
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
                  route={routeQ.data?.coordinates ?? null}
                  onRequestDirections={requestDirections}
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
            {attached && engine && roam && (
              <div
                data-map-chrome="top"
                className="pointer-events-none absolute inset-x-3 top-[calc(env(safe-area-inset-top)+5.5rem)] z-10 flex flex-col items-start gap-2 md:top-3"
              >
                <ParkChipScroller
                  parks={parksQ.data ?? []}
                  focusSlug={roamFocusSlug}
                  onZoom={(slug) => mapRef.current?.flyToPark(slug)}
                />
                {roamFocusSlug && <MapToggleChips />}
              </div>
            )}
            {attached && engine && (
              <ZoomControl
                onZoomIn={() => mapRef.current?.zoomIn()}
                onZoomOut={() => mapRef.current?.zoomOut()}
              />
            )}
            {attached && engine && <LocateButton state={geo.state} onClick={geo.locate} />}
            {attached && engine && roam && !playMode && (
              <RideFilterButton className="absolute left-3 bottom-[calc(var(--bottom-nav-height)+env(safe-area-inset-bottom)+0.75rem)] z-10 md:bottom-3" />
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
            {attached && trip && (
              <DirectionsPanel
                destName={trip.dest.name}
                geoBlocked={geo.state.status === "denied" || geo.state.status === "unavailable"}
                loading={routeQ.isFetching && !routeQ.data}
                error={routeQ.isError}
                distanceMeters={routeQ.data?.distanceMeters ?? null}
                durationSeconds={routeQ.data?.durationSeconds ?? null}
                onClear={clearTrip}
              />
            )}
          </>,
          host,
        )}
      {children}
    </MapStageContext.Provider>
  );
}

// A round, 3D-embossed map control, matching the app's button language (the same
// shelf/glare as the bottom nav + core search). Absolutely positioned, so the
// press "sinks" via translate-y (not the `top` trick the flow buttons use, which
// would fight the overlay's absolute `top`/`bottom` anchor). Slightly translucent
// with a blur so it floats cleanly over the map.
const MAP_CTRL_3D =
  "btn-3d-outline border-3d shadow-3d pointer-events-auto flex size-10 items-center justify-center bg-background/95 text-foreground backdrop-blur transition-[transform,box-shadow,background-color,color] duration-150 ease-out active:translate-y-[3px] active:shadow-3d-active dark:border-border";

/** A small centered pill for Kingdom Hearts status copy (wrong park / no WebGL). Sits
 *  in the bottom-center slot the play HUD would otherwise occupy. */
function PlayHint({ children }: { children: React.ReactNode }) {
  return (
    <div className="animate-in fade-in slide-in-from-bottom-2 pointer-events-none absolute left-1/2 bottom-[calc(var(--bottom-nav-height)+env(safe-area-inset-bottom)+3rem)] z-10 -translate-x-1/2 rounded-full border bg-background/90 px-4 py-2 text-center text-xs shadow-sm backdrop-blur duration-200 md:bottom-4">
      {children}
    </div>
  );
}

/** Vertical +/- zoom group, bottom-right, stacked directly above the locate
 *  button (clear of the bottom-nav island on mobile). Replaces each engine's
 *  native zoom control with one connected 3D control — a single embossed shelf
 *  split by a divider — driving zoom through the shared MapHandle. Individual
 *  buttons flash their background on press rather than sinking, so the group
 *  reads as one solid piece. */
function ZoomControl({ onZoomIn, onZoomOut }: { onZoomIn: () => void; onZoomOut: () => void }) {
  return (
    <div
      data-map-chrome="bottom"
      className="pointer-events-none absolute right-3 bottom-[calc(var(--bottom-nav-height)+env(safe-area-inset-bottom)+3.75rem)] z-10 md:bottom-[3.75rem]"
    >
      <div className="btn-3d-outline border-3d shadow-3d pointer-events-auto flex flex-col overflow-hidden rounded-2xl bg-background/95 backdrop-blur dark:border-border">
        <button
          type="button"
          onClick={onZoomIn}
          aria-label="Zoom in"
          className="flex size-10 items-center justify-center text-foreground transition-colors active:bg-foreground/10"
        >
          <PlusIcon className="size-5" />
        </button>
        <div className="mx-2 h-px bg-border" />
        <button
          type="button"
          onClick={onZoomOut}
          aria-label="Zoom out"
          className="flex size-10 items-center justify-center text-foreground transition-colors active:bg-foreground/10"
        >
          <MinusIcon className="size-5" />
        </button>
      </div>
    </div>
  );
}

/**
 * Floating "locate me" control, overlaid on the map (it travels in the portal so
 * it follows the map between routes). Sits clear of the bottom-nav island on
 * mobile and bottom-right on desktop. Tapping it requests/refreshes the fix.
 */
function LocateButton({ state, onClick }: { state: GeoState; onClick: () => void }) {
  const prompting = state.status === "prompting";
  const active = state.status === "granted";
  const off = state.status === "denied" || state.status === "unavailable";
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Show my location"
      title={off ? "Location unavailable — check permissions" : "Show my location"}
      className={cn(
        MAP_CTRL_3D,
        "absolute right-3 bottom-[calc(var(--bottom-nav-height)+env(safe-area-inset-bottom)+0.75rem)] z-10 rounded-full md:bottom-3",
        active && "text-blue-600",
        off && "text-muted-foreground",
      )}
    >
      {prompting ? (
        <LoaderCircleIcon className="size-5 animate-spin" />
      ) : (
        <LocateFixedIcon className="size-5" />
      )}
    </button>
  );
}

/**
 * Free-roam shortcut into the focused park's dashboard. Appears (traveling in the
 * portal with the map) only when the roam map is zoomed into a park and showing
 * its rides — a left-aligned 3D pill in the top-left cluster, below the layer
 * chips (the cluster owns the absolute positioning). Tapping it opens the full
 * `/park/$slug` page; the press sinks via translate-y.
 */
function ParkDetailButton({ slug }: { slug: string }) {
  return (
    <Link
      to="/park/$slug"
      params={{ slug }}
      className="btn-3d-outline border-3d shadow-3d pointer-events-auto flex shrink-0 select-none items-center gap-1.5 rounded-full bg-background/95 px-4 py-2 text-sm font-medium text-foreground backdrop-blur transition-[transform,box-shadow] duration-150 ease-out active:translate-y-[3px] active:shadow-3d-active dark:border-border"
    >
      <span>Park info</span>
      <ArrowUpRightIcon className="size-4 shrink-0 text-muted-foreground" />
    </Link>
  );
}

/**
 * A horizontally-scrollable row of pills to jump the roam camera to a park.
 * Zoomed into a park (`focusSlug` set): offers the *other* parks, split from the
 * details shortcut by an "or / go to" copy breaker. Zoomed out (`focusSlug` null):
 * offers every park with no breaker. Tapping a chip flies the shared map there;
 * the roam viewport watcher then re-points the cluster at the new focus. Renders
 * nothing when there's no park to offer.
 */
function ParkZoomChips({
  parks,
  focusSlug,
  onZoom,
}: {
  parks: ReadonlyArray<{ slug: string; name: string }>;
  focusSlug: string | null;
  onZoom: (slug: string) => void;
}) {
  const others = focusSlug ? parks.filter((p) => p.slug !== focusSlug) : parks;
  if (others.length === 0) return null;
  return (
    <>
      {focusSlug && (
        <span className="mt-1 flex shrink-0 select-none flex-col items-center rounded-full bg-background/80 px-2.5 py-1 text-center font-medium leading-none text-muted-foreground backdrop-blur">
          <span className="text-[10px] leading-none">or</span>
          <span className="mb-0.5 text-xs leading-none">go to</span>
        </span>
      )}
      {others.map((p) => (
        <button
          key={p.slug}
          type="button"
          onClick={() => onZoom(p.slug)}
          className="btn-3d-outline border-3d shadow-3d flex shrink-0 select-none items-center whitespace-nowrap rounded-full bg-background/95 px-4 py-2 text-sm font-medium text-foreground backdrop-blur transition-[transform,box-shadow] duration-150 ease-out active:translate-y-[3px] active:shadow-3d-active dark:border-border"
        >
          {p.name}
        </button>
      ))}
    </>
  );
}

// Left inset (px) of the whole cluster — matches the `inset-x-3` parent, so the
// pinned button and the scroll row's `px-3` both line up with the search bar.
const CHIP_ROW_INSET = 12;
// How far past the pinned button the chips finish fading back in — short, so the
// fade hugs the button and the chips sit close to it.
const CHIP_FADE_TAIL = 8;

/**
 * The top park-chip row. Once zoomed into a park, the "Park info" shortcut is
 * pinned to the left as its own overlay while the park chips (and the "or / go to"
 * breaker) scroll beneath it — and the scroll row is *masked* so those chips fade
 * to transparent as they slide under the button, dissolving into it rather than
 * bumping a visible panel. Zoomed out (no focus) it's just a plain scroll row.
 *
 * The button is measured (its label is fixed, but the width still depends on font
 * metrics) so both the reserved left gutter and the mask's fade stops track it
 * exactly. Negative margins + matching padding let the row bleed to the screen
 * edges while the first item still lines up with the search bar.
 */
function ParkChipScroller({
  parks,
  focusSlug,
  onZoom,
}: {
  parks: ReadonlyArray<{ slug: string; name: string }>;
  focusSlug: string | null;
  onZoom: (slug: string) => void;
}) {
  const btnRef = React.useRef<HTMLDivElement>(null);
  const [btnWidth, setBtnWidth] = React.useState(0);
  React.useLayoutEffect(() => {
    const el = btnRef.current;
    if (!focusSlug || !el) {
      setBtnWidth(0);
      return;
    }
    const measure = () => setBtnWidth(el.offsetWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [focusSlug]);

  // Right edge of the pinned button (from the row's screen-flush left). Chips are
  // fully transparent up to here, then fade back in across CHIP_FADE_TAIL, so a
  // chip has vanished before it reaches the button.
  const fadeEnd = focusSlug && btnWidth ? CHIP_ROW_INSET + btnWidth : 0;
  const mask = fadeEnd
    ? `linear-gradient(to right, transparent 0, transparent ${fadeEnd}px, #000 ${fadeEnd + CHIP_FADE_TAIL}px)`
    : undefined;

  return (
    <div className="relative -mx-3 w-[calc(100%+1.5rem)]">
      <div
        className="pointer-events-auto flex touch-pan-x items-center gap-1.5 overflow-x-auto overscroll-contain px-3 pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        style={mask ? { WebkitMaskImage: mask, maskImage: mask } : undefined}
      >
        {focusSlug &&
          btnWidth > 0 && (
            // Transparent gutter reserving the pinned button's footprint (plus a
            // little air past the fade) so the chips rest just clear of it, then
            // scroll under it as you swipe.
            <div aria-hidden className="shrink-0" style={{ width: btnWidth + 4 }} />
          )}
        <ParkZoomChips parks={parks} focusSlug={focusSlug} onZoom={onZoom} />
      </div>
      {focusSlug && (
        <div className="pointer-events-none absolute inset-y-0 left-3 flex items-center pb-1">
          <div ref={btnRef} className="pointer-events-auto">
            <ParkDetailButton slug={focusSlug} />
          </div>
        </div>
      )}
    </div>
  );
}

// The ride categories each on-map chip stands for. "Rides" folds the three
// ride-type markers (coasters, flat/dark rides, water rides) into one toggle;
// "Shows" folds stage shows and character meets together. Kept as the single
// source of truth for both the seeded roam-map default and the chip's
// active/toggle logic.
const RIDE_CATEGORY_KEYS = ["thrill", "attraction", "water"] as const;
const SHOW_CATEGORY_KEYS = ["show", "character"] as const;

/**
 * The on-map toggle row: labeled pills for what the map draws — grouped ride
 * categories (which ride markers show, shared with the Waits filter) and the
 * optional overlay layers (dining/shops markers). Two category groups ("Rides",
 * "Shows") each cover several underlying categories; Shops and Eats are overlay
 * layers (on the map only ride markers render, so a per-venue ride category would
 * have nothing to act on — the venues live in the layers instead). Sized to match
 * the filter button, in a scroll-if-it-overflows row with the scrollbar hidden.
 */
type MapToggle = { label: string; Icon: LucideIcon; color: MapItemKind } & (
  | { kind: "category"; keys: ReadonlyArray<string> }
  | { kind: "layer"; key: keyof MapLayers }
);

const MAP_TOGGLES: ReadonlyArray<MapToggle> = [
  {
    kind: "category",
    label: "Rides",
    Icon: RollerCoasterIcon,
    keys: RIDE_CATEGORY_KEYS,
    color: "rides",
  },
  { kind: "category", label: "Shows", Icon: DramaIcon, keys: SHOW_CATEGORY_KEYS, color: "shows" },
  { kind: "layer", key: "shops", label: "Shops", Icon: ShoppingBagIcon, color: "shops" },
  { kind: "layer", key: "dining", label: "Eats", Icon: UtensilsIcon, color: "eats" },
];

function MapToggleChips() {
  const { filter, setFilter } = useRideFilter();
  // A group is on when every category it covers is selected; toggling flips the
  // whole group on/off together.
  const toggleCategory = (keys: ReadonlyArray<string>) =>
    setFilter((f) => {
      const categories = new Set(f.categories);
      const allOn = keys.every((k) => categories.has(k));
      for (const k of keys) {
        if (allOn) categories.delete(k);
        else categories.add(k);
      }
      return { ...f, categories };
    });
  const toggleLayer = (key: keyof MapLayers) =>
    setFilter((f) => ({ ...f, layers: { ...f.layers, [key]: !f.layers[key] } }));
  return (
    <div className="pointer-events-auto -mx-3 flex w-[calc(100%+1.5rem)] touch-pan-x gap-1.5 overflow-x-auto overscroll-contain px-3 pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {MAP_TOGGLES.map((t) => {
        const active =
          t.kind === "category"
            ? t.keys.every((k) => filter.categories.has(k))
            : filter.layers[t.key];
        const { Icon } = t;
        const color = MAP_TYPE_COLOR[t.color];
        return (
          <button
            key={t.kind === "category" ? `cat:${t.label}` : `layer:${t.key}`}
            type="button"
            onClick={() => (t.kind === "category" ? toggleCategory(t.keys) : toggleLayer(t.key))}
            aria-pressed={active}
            style={
              active
                ? // Fill + 3D shelf/glare all derived from the type's signature
                  // colour, so a lit chip matches its markers' overflow dot.
                  ({
                    backgroundColor: color,
                    "--btn-3d": `color-mix(in oklch, ${color}, black 32%)`,
                    "--btn-glare": `color-mix(in oklch, ${color}, black 32%)`,
                  } as React.CSSProperties)
                : undefined
            }
            className={cn(
              "btn-3d-outline border-3d flex shrink-0 select-none items-center gap-1.5 rounded-full px-4 py-2 text-sm font-medium backdrop-blur transition-[transform,box-shadow,background-color,color] duration-150 ease-out dark:border-border",
              active
                ? // Selected: hold the pressed-in state — the filled pill sits
                  // translated down into its shelf with the shadow collapsed, so it
                  // reads as depressed rather than raised.
                  "translate-y-[3px] text-white shadow-3d-active"
                : // Resting: raised 3D outline pill that sinks on press. The icon
                  // carries the type colour so the mapping reads even when off.
                  "bg-background/95 text-foreground shadow-3d active:translate-y-[3px] active:shadow-3d-active",
            )}
          >
            <Icon className="size-5" style={active ? undefined : { color }} />
            {t.label}
          </button>
        );
      })}
    </div>
  );
}

function formatDistance(m: number): string {
  return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`;
}
function formatWalk(s: number): string {
  return `${Math.max(1, Math.round(s / 60))} min walk`;
}

/**
 * Floating directions readout, overlaid at the top of the map (travels in the
 * portal with the map). Shows the route's distance + walking ETA to the
 * destination, a loading/permission/error state, and a dismiss button.
 */
function DirectionsPanel({
  destName,
  geoBlocked,
  loading,
  error,
  distanceMeters,
  durationSeconds,
  onClear,
}: {
  destName: string;
  geoBlocked: boolean;
  loading: boolean;
  error: boolean;
  distanceMeters: number | null;
  durationSeconds: number | null;
  onClear: () => void;
}) {
  let body: React.ReactNode;
  if (geoBlocked) {
    body = <span className="text-muted-foreground">Enable location to route to {destName}</span>;
  } else if (loading) {
    body = (
      <span className="flex items-center gap-2">
        <LoaderCircleIcon className="size-4 animate-spin" />
        Finding route to {destName}…
      </span>
    );
  } else if (error || distanceMeters == null || durationSeconds == null) {
    body = <span className="text-muted-foreground">No walking route found to {destName}</span>;
  } else {
    body = (
      <span>
        <span className="font-semibold">{formatDistance(distanceMeters)}</span>
        <span className="text-muted-foreground"> · {formatWalk(durationSeconds)} to </span>
        <span className="font-medium">{destName}</span>
      </span>
    );
  }
  return (
    <div className="pointer-events-auto absolute inset-x-3 top-3 z-10 mx-auto flex max-w-md items-center gap-3 rounded-2xl border border-black/10 bg-background/95 px-4 py-2.5 text-sm shadow-lg backdrop-blur">
      <div className="min-w-0 flex-1 truncate">{body}</div>
      <button
        type="button"
        onClick={onClear}
        aria-label="Clear route"
        className="-mr-1 inline-flex size-7 shrink-0 items-center justify-center rounded-full text-muted-foreground transition hover:bg-foreground/10 hover:text-foreground active:scale-95"
      >
        <XIcon className="size-4" />
      </button>
    </div>
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
