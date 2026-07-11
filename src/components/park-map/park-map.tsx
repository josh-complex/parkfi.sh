"use client";

import * as React from "react";
import { useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import maplibregl from "maplibre-gl";
import { useTheme } from "next-themes";

import { maptilerStyleUrl } from "#/components/maps/maptiler-style.ts";
import {
  anyMapLayerActive,
  rideMatchesFilter,
  type RideFilter,
} from "#/components/rides/ride-filter.tsx";
import { useTRPC } from "#/integrations/trpc/react.ts";
import { distanceMeters, pointInPolygon } from "#/server/living/geofence.ts";
import { reportError } from "#/lib/report-error.ts";

import { MarkerCluster, type DeclutterItem } from "./declutter.ts";
import {
  applySelected,
  attractionCardBodyHtml,
  attractionKind,
  attractionPriority,
  boundaryFeatureCollection,
  buildAttractionEl,
  buildDevSpotEl,
  buildParkBadgeEl,
  buildPoiEl,
  buildUserLocationEl,
  sameCoords,
  setUserHeading,
  chromePadding,
  DECLUTTER_SIZE,
  escapeHtml,
  getRoamCamera,
  type MapHandle,
  MAP_FLY_MS,
  MORPH_MS,
  openAttractionCard,
  ORLANDO_CENTER,
  ORLANDO_ZOOM,
  poiCardBodyHtml,
  poiKind,
  saveRoamCamera,
  SPREAD_ZOOM,
  waitLabelFor,
  wireHoverLabelFlip,
} from "./shared.tsx";

import "maplibre-gl/dist/maplibre-gl.css";

import type { FeatureCollection, Point } from "geojson";

/**
 * Vector basemap, per the app theme. We use a custom MapTiler GL style —
 * vector, not raster, so its labels live in addressable `symbol` layers we can
 * selectively strip (see `stripLabels`) instead of being baked into tile pixels.
 * The style itself doesn't yet vary by theme (see `maptilerStyleUrl`).
 */
function basemapStyleUrl(_dark: boolean): string {
  return maptilerStyleUrl();
}

/**
 * Source-layers whose `symbol` label layers we suppress so our own node labels
 * own the map. We drop POI, building-name / house-number, and place-area
 * (themed-land / neighborhood) labels, deliberately keeping street names and
 * water names — those give the map its sense of place.
 *
 * Written to span two schemas, since our basemap style is swappable: classic
 * OpenMapTiles (`poi`, `housenumber`, `place`) and MapTiler's v4 schema
 * (`poi_food`, `building_number`, `place_label`, …). We match any `poi*`
 * source-layer by prefix, plus this explicit set for the rest.
 */
const HIDDEN_LABEL_SOURCE_LAYERS = new Set([
  "housenumber",
  "building_number",
  "place",
  "place_label",
  "island_label",
  "mountain_peak",
  "tree",
]);

/** True for label source-layers we hide (see `HIDDEN_LABEL_SOURCE_LAYERS`). */
function isHiddenLabelLayer(sourceLayer: string): boolean {
  return sourceLayer.startsWith("poi") || HIDDEN_LABEL_SOURCE_LAYERS.has(sourceLayer);
}

/**
 * A marker's z-lift, reference-counted. MapLibre markers are positioned siblings
 * with auto z-index, so an explicit z-index wins. Returns the `raise(on)` to hand
 * the cluster controller; also wires hover to the same lift.
 */
function makeRaise(el: HTMLElement): (on: boolean) => void {
  let count = 0;
  // Recompute the marker's resting z from its lift count.
  const applyZ = () => {
    el.style.zIndex = count > 0 ? "1000" : "";
  };
  const raise = (on: boolean) => {
    count += on ? 1 : -1;
    applyZ();
  };
  el.addEventListener("mouseenter", () => {
    raise(true);
    // The hovered marker jumps to an exclusive z above every other marker so its
    // expanded label always clears its neighbors — even one whose touch-hover z
    // hasn't cleared. Demote the previously hovered marker back to its resting z
    // first, so only one ever holds the top slot (no DOM reorder, which would
    // drop :hover and cancel the click).
    if (topHover && topHover !== applyZ) topHover();
    topHover = applyZ;
    el.style.zIndex = "3000";
  });
  el.addEventListener("mouseleave", () => {
    raise(false);
    if (topHover === applyZ) topHover = null;
  });
  return raise;
}
/** The demote-to-resting-z callback of the marker currently holding the top
 *  hover slot, so a new hover can knock the previous one down. */
let topHover: (() => void) | null = null;

/** A Kingdom Hearts (play-mode) map dot: `darkness` (live ride-down / battle) = coral,
 *  `discovery` (user pin) = blue. Plain DOM markers, kept out of the ride cluster
 *  so the game layer overlays cleanly without disturbing the wait-time markers. */
function livingMarkerEl(kind: "darkness" | "discovery"): HTMLElement {
  const el = document.createElement("div");
  const color = kind === "darkness" ? "#D85A30" : "#378ADD";
  el.style.cssText = `width:18px;height:18px;border-radius:50%;background:${color};border:2px solid #fff;box-shadow:0 0 0 2px rgba(0,0,0,.15);cursor:pointer;`;
  if (kind === "darkness") el.style.boxShadow = `0 0 10px 2px ${color}`;
  return el;
}

// Zoom at/above which free-roam reveals a park's rides (and below which it falls
// back to park badges). Park-bounds fits land around 15–16, comfortably above.
const ROAM_RIDE_ZOOM = 14;

// Route styling. The remaining route is drawn as short dashes marching toward
// the destination (Google's pedestrian style); the already-walked breadcrumb
// sits behind it as a trail of *static* gray dots — same visual language as the
// route, but frozen, so "walked" reads as the route with the motion drained out
// of it (and far more visibly than the old thin line).
const ROUTE_COLOR = "#2563eb";
const TRAVELED_COLOR = "#94a3b8"; // slate-400 — a muted "where you've been" gray
const TRAVELED_DOT_SPACING_PX = 14; // tighter than the route's, so the trail reads solid
const TRAVELED_DOT_RADIUS = 4;
// The remaining route is drawn as a row of round dots marching toward the
// destination (Google pedestrian style). MapLibre can't animate a dash offset —
// round-capped dashes leave a stray dot pinned at the line origin and double up
// mid-line — so instead we sample discrete points along the route and render them
// as a `circle` layer. A phase offset that creeps forward each tick slides every
// dot toward the destination. The spacing is derived from the current zoom (a
// fixed on-screen gap), so the dots read the same density whether the map is
// zoomed in tight or pulled back.
const DOT_SPACING_PX = 22; // on-screen gap between dot centers
const DOT_STEP_FRAC = 0.04; // fraction of a spacing advanced per tick (slow crawl)
const DOT_TICK_MS = 70; // animation cadence
const DOT_RADIUS = 3.75;

/** Metres per screen pixel at a given latitude + MapLibre zoom (Web Mercator).
 *  MapLibre uses 512px tiles, so the world is `512 · 2^zoom` px wide — hence the
 *  earth circumference / 512 constant (half the 256-tile value Leaflet/Google use;
 *  using the 256 constant makes every spacing come out 2× too large). */
function metersPerPixel(lat: number, zoom: number): number {
  return (78271.5169 * Math.cos((lat * Math.PI) / 180)) / 2 ** zoom;
}

/** Sample [lng,lat] points every `spacingM` metres along the polyline, the first
 *  `offsetM` metres in — advancing `offsetM` (0…spacing) marches the whole row of
 *  dots forward, toward the destination. */
function dotsAlongRoute(
  coords: Array<[number, number]> | null,
  spacingM: number,
  offsetM: number,
): FeatureCollection<Point> {
  const features: FeatureCollection<Point>["features"] = [];
  if (coords && coords.length > 1 && spacingM > 0) {
    let target = offsetM > 1e-6 ? offsetM : spacingM;
    let acc = 0;
    for (let i = 1; i < coords.length; i++) {
      const a = coords[i - 1];
      const b = coords[i];
      const segLen = distanceMeters(a, b);
      if (segLen <= 1e-6) continue;
      while (target <= acc + segLen) {
        const t = (target - acc) / segLen;
        features.push({
          type: "Feature",
          properties: {},
          geometry: {
            type: "Point",
            coordinates: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t],
          },
        });
        target += spacingM;
      }
      acc += segLen;
    }
  }
  return { type: "FeatureCollection", features };
}

// Stable default for the `devDestinations` prop, so the dev-marker effect's deps
// don't churn when the caller omits it.
const EMPTY_DEV_DESTINATIONS: ReadonlyArray<{
  id: string;
  label: string;
  coords: [number, number];
}> = [];

// How long the map must sit still before the cluster pass re-runs. Re-clustering
// on every frame of a zoom made markers flicker in/out as they crossed the
// grouping threshold; debouncing coalesces a whole gesture into one relayout
// (with an immediate flush on `moveend`, so the settled state still snaps in).
const DECLUTTER_SETTLE_MS = 150;

type ParkBounds = { latMin: number; latMax: number; lngMin: number; lngMax: number };

/** Generous box around the park used to cap how far the user can zoom/pan out. */
function zoomOutBounds(b: ParkBounds): maplibregl.LngLatBoundsLike {
  const dLng = (b.lngMax - b.lngMin) * 0.6;
  const dLat = (b.latMax - b.latMin) * 0.6;
  return [
    [b.lngMin - dLng, b.latMin - dLat],
    [b.lngMax + dLng, b.latMax + dLat],
  ];
}

/** Pad a LngLatBounds by `factor` of its span on each side. Falls back to a
 *  small fixed margin when the box collapses to a point (single resort). */
function paddedBounds(b: maplibregl.LngLatBounds, factor: number): maplibregl.LngLatBoundsLike {
  const sw = b.getSouthWest();
  const ne = b.getNorthEast();
  const dLng = (ne.lng - sw.lng) * factor || 0.05;
  const dLat = (ne.lat - sw.lat) * factor || 0.05;
  return [
    [sw.lng - dLng, sw.lat - dLat],
    [ne.lng + dLng, ne.lat + dLat],
  ];
}

export function ParkMap({
  activeSlug,
  selectedId,
  onSelectAttraction,
  onDeselect,
  onMapRef,
  attached = true,
  userLocation,
  deviceHeading = null,
  route,
  traveled = null,
  animateRoute = false,
  onRequestDirections,
  navDest = null,
  devDestinations = EMPTY_DEV_DESTINATIONS,
  follow = false,
  headingUp = false,
  onBearingChange,
  onUserInteract,
  roam = false,
  filter,
  onRoamFocusChange,
  play = false,
  playParkSlug,
  onEngageDarkness,
  onDropDiscovery,
}: {
  activeSlug: string | null;
  /** Currently charted attraction — its marker is highlighted. */
  selectedId?: number | null;
  /** Clicking an attraction marker selects it (drives the wait chart). */
  onSelectAttraction?: (item: { id: number; name: string }) => void;
  /** Clicking the empty map clears the current selection. */
  onDeselect?: () => void;
  /** Exposes a resize handle so the stage can re-fit the canvas mid-morph. */
  onMapRef?: (map: MapHandle | null) => void;
  /** True only while the map is lent to a visible slot. The camera fly is gated
   *  on it so the fit re-runs when returning from a route with no map. */
  attached?: boolean;
  /** The user's live position ([lng,lat] + accuracy + GPS heading), drawn as a
   *  "you are here" dot with a facing cone. Null when location is off/denied. */
  userLocation?: { coords: [number, number]; accuracy: number; heading: number | null } | null;
  /** Live device-compass heading (degrees clockwise from north), preferred over
   *  the GPS course-over-ground for the facing cone + heading-up rotation since
   *  it works while standing still. Null when unavailable. */
  deviceHeading?: number | null;
  /** Active walking route geometry ([lng,lat] points) to draw, or null. */
  route?: Array<[number, number]> | null;
  /** Breadcrumb of where the user has already walked this trip ([lng,lat]),
   *  drawn as a grayed trail behind the remaining route. Null when not
   *  navigating / before there's a trail. */
  traveled?: Array<[number, number]> | null;
  /** Animate the route as marching dots toward the destination (active nav).
   *  Off in preview and once arrived — the line renders static then. */
  animateRoute?: boolean;
  /** A "Directions" tap in an attraction popup — asks the stage to route here. */
  onRequestDirections?: (d: { id: number; name: string; coords: [number, number] }) => void;
  /** While actively navigating (Start tapped), the destination's [lng,lat]. Set,
   *  it hides every other marker so only the destination + route remain; null in
   *  preview / when idle (all markers show as normal). */
  navDest?: [number, number] | null;
  /** The dev picker's test destinations — drawn as temporary pins while
   *  navigating so a dev target (not a real attraction) is visible on the map.
   *  Empty for normal users. */
  devDestinations?: ReadonlyArray<{ id: string; label: string; coords: [number, number] }>;
  /** Nav follow-cam: recenter on the user as their position updates. */
  follow?: boolean;
  /** Rotate the map so the user's heading is "up" (else north-up). */
  headingUp?: boolean;
  /** Reports the live map bearing (degrees) so the overlay compass can track it. */
  onBearingChange?: (bearing: number) => void;
  /** Fires on a real user gesture (drag/zoom/rotate) so the stage can drop
   *  follow-cam — distinguished from our programmatic camera moves. */
  onUserInteract?: () => void;
  /** Free-roam mode (the `/map` page): the map self-manages which park is in
   *  focus from the zoom level + viewport (no route navigation). Zooming into a
   *  park reveals its rides; zooming back out shows park badges again. */
  roam?: boolean;
  /** Shared ride filter — hides ride markers that don't match. */
  filter?: RideFilter;
  /** Roam only: reports which park's rides are currently revealed (or null), so
   *  the stage can offer a "view park details" shortcut. */
  onRoamFocusChange?: (slug: string | null) => void;
  /** Kingdom Hearts play mode: overlay the Darkness/discovery game layer for
   *  `playParkSlug` on top of the roam map. GL renderer only. */
  play?: boolean;
  /** The park whose Living Layer marks to render while `play` is on. */
  playParkSlug?: string | null;
  /** Tapping a Darkness spawn — the stage opens the battle panel for this mark. */
  onEngageDarkness?: (markId: number) => void;
  /** Tapping the bare map in play mode — the stage opens the discovery-drop sheet. */
  onDropDiscovery?: (p: { lat: number; lng: number }) => void;
}) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { resolvedTheme } = useTheme();
  const dark = resolvedTheme === "dark";

  const [mounted, setMounted] = React.useState(false);
  const [ready, setReady] = React.useState(false);
  // Free-roam focus: which park's rides are revealed, driven by zoom/click (not
  // the route). Outside roam mode the route's `activeSlug` is authoritative.
  const [focusSlug, setFocusSlug] = React.useState<string | null>(null);
  const focusSlugRef = React.useRef<string | null>(null);
  focusSlugRef.current = focusSlug;
  const effectiveSlug = roam ? focusSlug : activeSlug;
  const effectiveSlugRef = React.useRef<string | null>(effectiveSlug);
  effectiveSlugRef.current = effectiveSlug;
  // Stable dep for the marker effect: it rebuilds when navigation starts/ends (or
  // the destination changes) so the non-destination markers hide/return, but not
  // on every re-route/GPS tick (the destination coords hold steady through those).
  const navDestKey = navDest ? `${navDest[0]},${navDest[1]}` : "";
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const mapRef = React.useRef<maplibregl.Map | null>(null);
  // The map is a singleton that survives navigation, so this ref is effectively
  // per-session: only the first map error toasts + reports as critical; the rest
  // (tile-fetch blips, etc.) are counted as degraded without a toast tower.
  const mapErrorReportedRef = React.useRef(false);
  const markersRef = React.useRef<Array<maplibregl.Marker>>([]);
  // Kingdom Hearts play-mode markers (Darkness spawns + discovery pins), kept in their
  // own set so they never touch the ride cluster's marker bookkeeping.
  const playMarkersRef = React.useRef<Array<maplibregl.Marker>>([]);
  // Dev-destination pins (the nav QA tools' test spots), likewise kept apart from
  // the ride cluster — they're a temporary overlay shown only while navigating.
  const devMarkersRef = React.useRef<Array<maplibregl.Marker>>([]);
  // Attraction marker detail-layer elements by id, so selection highlight can
  // update in place without rebuilding (rebuilding would close an open popup).
  const markerElsRef = React.useRef<Map<number, HTMLElement>>(new Map());
  // Cluster controller (shared with the Leaflet renderer). It owns the collision
  // pass, the "+N" cluster chips, and the click-to-zoom interaction; we just feed
  // it items and re-run on move.
  const layerRef = React.useRef<MarkerCluster | null>(null);
  const declutterTimerRef = React.useRef(0);
  // The currently-expanded marker card (see openAttractionCard), so any new
  // interaction can collapse it first.
  const cardRef = React.useRef<{ close: () => void } | null>(null);
  const userMarkerRef = React.useRef<maplibregl.Marker | null>(null);
  const routeCoordsRef = React.useRef<Array<[number, number]> | null>(null);
  const traveledCoordsRef = React.useRef<Array<[number, number]> | null>(null);
  // Dot-march animation: an interval that advances the phase offset and re-samples
  // the route dots so they crawl toward the destination. `dotTimerRef` holds the
  // interval id (0 when idle); `dotAnimateRef` mirrors the `animateRoute` prop so
  // the loop can be read without re-subscribing; `dotPhaseRef` is the running
  // offset in metres.
  const dotTimerRef = React.useRef(0);
  const dotAnimateRef = React.useRef(false);
  const dotPhaseRef = React.useRef(0);
  // Park-outline FeatureCollection + a (re-)installer. The basemap is rebuilt on
  // theme swap (setStyle wipes custom sources/layers), so we re-add on styledata.
  const boundaryFCRef = React.useRef(boundaryFeatureCollection([]));
  // Latest select callback / selection, read inside the marker effect so it
  // doesn't rebuild every render or on each selection change.
  const onSelectRef = React.useRef(onSelectAttraction);
  onSelectRef.current = onSelectAttraction;
  const onDeselectRef = React.useRef(onDeselect);
  onDeselectRef.current = onDeselect;
  const onRequestDirectionsRef = React.useRef(onRequestDirections);
  onRequestDirectionsRef.current = onRequestDirections;
  const onEngageDarknessRef = React.useRef(onEngageDarkness);
  onEngageDarknessRef.current = onEngageDarkness;
  const onDropDiscoveryRef = React.useRef(onDropDiscovery);
  onDropDiscoveryRef.current = onDropDiscovery;
  const selectedIdRef = React.useRef(selectedId);
  selectedIdRef.current = selectedId;
  const onBearingChangeRef = React.useRef(onBearingChange);
  onBearingChangeRef.current = onBearingChange;
  const onUserInteractRef = React.useRef(onUserInteract);
  onUserInteractRef.current = onUserInteract;
  // Last non-null heading, so a follow-cam rotation holds orientation when the
  // GPS heading briefly drops to null (common when nearly stationary).
  const lastHeadingRef = React.useRef<number | null>(null);
  // Live compass heading, read inside the marker/follow effects without making
  // them re-run at sensor rate (only the dedicated repaint/rotate effects below
  // key off `deviceHeading`).
  const deviceHeadingRef = React.useRef(deviceHeading);
  deviceHeadingRef.current = deviceHeading;
  // Repaints the facing cone with the current heading + map bearing. Set by the
  // marker effect; called both there and by the compass-repaint effect so a new
  // sensor reading re-points the cone without rebuilding the marker.
  const paintConeRef = React.useRef<() => void>(() => {});
  // Live mirrors of the follow-cam props, read inside effects that must NOT
  // re-run when these toggle. Engaging follow shouldn't itself move the camera —
  // the imperative `flyToLocation` owns the initial zoom-in, and if the per-fix
  // recenter effect fired on the toggle its zoom-less easeTo would clobber that
  // fly and snap back to the preview zoom. Reading via refs keeps the recenter
  // firing only on new fixes.
  const followRef = React.useRef(follow);
  followRef.current = follow;
  const headingUpRef = React.useRef(headingUp);
  headingUpRef.current = headingUp;
  // True while an engage fly (flyToLocation) is animating. A GPS fix landing
  // mid-fly must not fire the zoom-less recenter, which would interrupt the fly
  // before it reaches the close nav zoom. Cleared on the fly's moveend.
  const engagingRef = React.useRef(false);

  const listQ = useQuery(trpc.parks.list.queryOptions());
  const overviewQ = useQuery(trpc.parks.overview.queryOptions());
  const boardQ = useQuery({
    ...trpc.parks.board.queryOptions({ parkSlug: effectiveSlug ?? "" }),
    enabled: !!effectiveSlug,
  });

  // Optional map overlay layers, driven by the shared filter. Markers only
  // render once a park is focused (`effectiveSlug`) and the layer is toggled on
  // (see the POI block below) — but we start fetching before the toggle, so the
  // data is already warm when the user flips "Eats"/"Shops" and the markers
  // appear instantly instead of after a round trip. The feeds are resort-wide
  // and identical across parks, so this fetches once and is shared; a long
  // `staleTime` keeps it from refetching as the user roams between parks (also
  // edge-cached — see CACHEABLE_TRPC_PATHS).
  //
  // These are progressive/off-critical-path: they're both large (resort-wide,
  // ~300 venues) and non-essential to the first paint, so we hold them until
  // the attraction board has loaded. That lets the ride/show markers — the data
  // the user is actually waiting on — win the browser's connection budget and
  // render first, then shops/eats stream in behind them.
  const layers = filter?.layers;
  const POI_STALE_MS = 30 * 60 * 1000;
  const poisEnabled = !!effectiveSlug && boardQ.isSuccess;
  const diningQ = useQuery({
    ...trpc.parks.dining.queryOptions(),
    enabled: poisEnabled,
    staleTime: POI_STALE_MS,
    gcTime: POI_STALE_MS,
  });
  const shopsQ = useQuery({
    ...trpc.parks.shops.queryOptions(),
    enabled: poisEnabled,
    staleTime: POI_STALE_MS,
    gcTime: POI_STALE_MS,
  });
  // Non-facility POIs (guest services / entertainment / events-tours) — the
  // Services / Live / Tours overlay layers. Same resort-wide-fetch-once,
  // clip-by-boundary treatment as dining/shops; one feed covers all three
  // layers, filtered by category at render.
  const poiQ = useQuery({
    ...trpc.parks.poi.queryOptions(),
    enabled: poisEnabled,
    staleTime: POI_STALE_MS,
    gcTime: POI_STALE_MS,
  });

  // Kingdom Hearts play mode: the active Living Layer marks for the focused park.
  // Only fetches while play is on and a park is focused; polls so a ride going
  // down (a fresh Darkness spawn) appears without a manual refresh.
  const marksQ = useQuery({
    ...trpc.living.marks.queryOptions({ parkSlug: playParkSlug ?? "" }),
    enabled: play && !!playParkSlug,
    refetchInterval: play ? 30_000 : false,
  });
  const reactMark = useMutation(
    trpc.living.reactMark.mutationOptions({
      onSuccess: () => {
        if (playParkSlug)
          void queryClient.invalidateQueries({
            queryKey: trpc.living.marks.queryKey({ parkSlug: playParkSlug }),
          });
      },
    }),
  );
  const reactMarkRef = React.useRef(reactMark);
  reactMarkRef.current = reactMark;

  const parks = listQ.data;
  const overview = overviewQ.data;
  const board = boardQ.data;
  // Latest parks list read inside map event handlers (focus watcher / auto-focus)
  // without resubscribing them on every refetch.
  const parksRef = React.useRef(parks);
  parksRef.current = parks;

  // SSR guard: maplibre needs the DOM. Render a placeholder until mounted.
  React.useEffect(() => setMounted(true), []);

  // Init map once.
  React.useEffect(() => {
    if (!mounted || !containerRef.current || mapRef.current) return;
    let map: maplibregl.Map;
    try {
      map = new maplibregl.Map({
        container: containerRef.current,
        style: basemapStyleUrl(dark),
        center: ORLANDO_CENTER,
        zoom: ORLANDO_ZOOM,
        // Native attribution off — our own toggleable credits chip (the info
        // button in the map-stage control column) carries the MapTiler/OSM
        // attribution instead, so nothing pokes out beneath the bottom nav.
        attributionControl: false,
      });
    } catch (err) {
      // The WebGL probe passed but MapLibre still couldn't get a context — the
      // map is THE core surface, so a silent failure is the worst flow-block.
      reportError(err, {
        source: "map",
        severity: "critical",
        toast: "The map failed to load — try reloading",
        toastId: "map",
        context: { parkSlug: activeSlug, renderer: "gl" },
      });
      return;
    }
    // No native NavigationControl — our own 3D zoom buttons (in the stage) drive
    // zoom via the MapHandle below, so the map's controls match the app.
    layerRef.current = new MarkerCluster(
      DECLUTTER_SIZE,
      () => selectedIdRef.current ?? null,
      // Tap a cluster head -> zoom in on its members so the group splits apart on
      // the way in (unproject the projected points back to lng/lat). A tight,
      // near-coincident group barely changes the fit zoom, which would just
      // re-form the cluster, so we always land at least a couple levels closer
      // than we are now and allow a deeper max so repeated taps keep progressing.
      (points) => {
        const b = new maplibregl.LngLatBounds();
        for (const p of points) b.extend(map.unproject([p.x, p.y]));
        // Reserve space for the chrome overlaying the map (top search/chips, the
        // bottom nav + zoom/locate controls) so the split-apart members land in
        // the visible band, not tucked behind a button. Cap the fit at
        // SPREAD_ZOOM: past it the layout switches to "spread" (markers just
        // nudge apart, no grouping), so there's no reason to over-zoom a tight
        // two-node group toward max and fling its members to opposite edges.
        const pad = chromePadding(containerRef.current, { sides: 70 });
        const cam = map.cameraForBounds(b, { padding: pad, maxZoom: SPREAD_ZOOM });
        const target = Math.min(SPREAD_ZOOM, Math.max(cam?.zoom ?? 0, map.getZoom() + 2));
        // Pass `pad` (not a pre-offset `cam.center`) to easeTo so the reserve is
        // applied at the *actual* target zoom: we often force a couple levels past
        // `cam.zoom` for tight groups, and cam.center's offset — baked for the
        // shallower cam.zoom — would otherwise let the top members drift back under
        // the chip rows. Centering the raw group center inside the padded band
        // keeps it clear at whatever zoom we land on.
        map.easeTo({ center: b.getCenter(), zoom: target, padding: pad, duration: 500 });
      },
      // Any marker click collapses an open ride card before it zooms/activates.
      () => {
        cardRef.current?.close();
        cardRef.current = null;
      },
    );
    map.on("load", () => setReady(true));
    // MapLibre surfaces runtime failures (style/source load, WebGL context loss,
    // per-tile fetch errors) on the "error" event. First one per session is
    // treated as flow-blocking (toast once, keyed "map"); the rest are degraded
    // and silent so a flurry of tile errors can't stack toasts.
    map.on("error", (e: { error?: Error }) => {
      const first = !mapErrorReportedRef.current;
      mapErrorReportedRef.current = true;
      reportError(e.error ?? new Error("MapLibre error"), {
        source: "map",
        severity: first ? "critical" : "degraded",
        toast: first ? "The map failed to load — try reloading" : false,
        toastId: "map",
        context: { parkSlug: activeSlug, renderer: "gl" },
      });
    });
    // Mirror the live bearing to the overlay compass.
    map.on("rotate", () => onBearingChangeRef.current?.(map.getBearing()));
    // A real gesture (has an originalEvent) means the user took the wheel — tell
    // the stage to drop follow-cam. Our own easeTo/flyTo moves have no
    // originalEvent, so they don't trip this.
    const onGesture = (e: { originalEvent?: unknown }) => {
      if (e.originalEvent) onUserInteractRef.current?.();
    };
    map.on("dragstart", onGesture);
    map.on("zoomstart", onGesture);
    map.on("rotatestart", onGesture);
    mapRef.current = map;
    onMapRef?.({
      resize: () => map.resize(),
      zoomIn: () => map.zoomIn(),
      zoomOut: () => map.zoomOut(),
      flyToPark: (slug) => flyToPark(slug),
      flyToLocation: (coords, opts) => {
        const dur = opts?.duration ?? 700;
        engagingRef.current = true;
        const done = () => {
          engagingRef.current = false;
        };
        // Clear on the fly's end, with a timeout fallback in case the move is a
        // no-op (already at target) and never fires `moveend` — otherwise a stuck
        // flag would disable the follow-cam for the rest of the trip.
        map.once("moveend", done);
        setTimeout(done, dur + 200);
        map.easeTo({
          center: coords,
          zoom: opts?.zoom ?? map.getZoom(),
          bearing: opts?.bearing ?? map.getBearing(),
          duration: dur,
        });
      },
      setBearing: (bearing, opts) => map.easeTo({ bearing, duration: opts?.duration ?? 400 }),
    });
    return () => {
      map.remove();
      mapRef.current = null;
      layerRef.current = null;
      onMapRef?.(null);
      setReady(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mounted]);

  // Add (or refresh) the park-boundary fill+line layers from boundaryFCRef. The
  // markers are DOM (above the canvas), so these style layers always sit beneath
  // them. Re-installs itself once the style finishes loading after a theme swap.
  const ensureBoundaries = React.useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    if (!map.isStyleLoaded()) {
      map.once("styledata", ensureBoundaries);
      return;
    }
    const src = map.getSource("park-boundaries");
    if (src) {
      (src as maplibregl.GeoJSONSource).setData(boundaryFCRef.current);
      return;
    }
    map.addSource("park-boundaries", { type: "geojson", data: boundaryFCRef.current });
    map.addLayer({
      id: "park-boundaries-fill",
      type: "fill",
      source: "park-boundaries",
      paint: { "fill-color": ["get", "color"], "fill-opacity": 0.07 },
    });
    map.addLayer({
      id: "park-boundaries-line",
      type: "line",
      source: "park-boundaries",
      paint: { "line-color": ["get", "color"], "line-width": 2, "line-opacity": 0.9 },
    });
  }, []);

  // Re-sample the route + traveled-trail dots and push them to their sources.
  // Spacing is derived from the live zoom so the on-screen gap stays constant.
  // The route dots march (the running phase offsets where the row starts); the
  // traveled dots always sample from phase 0, so they hold still — appending to
  // the trail only adds dots at its end, it never re-shuffles the ones behind.
  const paintDots = React.useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    const mpp = metersPerPixel(map.getCenter().lat, map.getZoom());
    const routeSrc = map.getSource("route-dots");
    if (routeSrc) {
      const spacingM = DOT_SPACING_PX * mpp;
      (routeSrc as maplibregl.GeoJSONSource).setData(
        dotsAlongRoute(routeCoordsRef.current, spacingM, dotPhaseRef.current * spacingM),
      );
    }
    const traveledSrc = map.getSource("route-traveled");
    if (traveledSrc) {
      (traveledSrc as maplibregl.GeoJSONSource).setData(
        dotsAlongRoute(traveledCoordsRef.current, TRAVELED_DOT_SPACING_PX * mpp, 0),
      );
    }
  }, []);

  // Start/stop the marching-dots timer to match the current mode. Runs only while
  // `animateRoute` is on and there's a real route; each tick nudges the phase and
  // re-samples so the dots crawl toward the destination. Idempotent — safe to call
  // on every route/mode change and after a style swap.
  const syncDotAnimation = React.useCallback(() => {
    const shouldRun = dotAnimateRef.current && (routeCoordsRef.current?.length ?? 0) > 1;
    if (shouldRun && dotTimerRef.current === 0) {
      dotTimerRef.current = window.setInterval(() => {
        // Advancing the phase moves the first dot to a larger distance-along, i.e.
        // toward the destination (the coords run origin → destination).
        dotPhaseRef.current = (dotPhaseRef.current + DOT_STEP_FRAC) % 1;
        paintDots();
      }, DOT_TICK_MS);
    } else if (!shouldRun && dotTimerRef.current !== 0) {
      clearInterval(dotTimerRef.current);
      dotTimerRef.current = 0;
    }
  }, [paintDots]);

  // Install/refresh the grayed traveled trail and the remaining route (each a
  // row of dots) as GeoJSON layers. Like the boundaries, they must re-install
  // on `styledata` (a theme swap's setStyle wipes custom sources/layers). Empty
  // collections clear them in place. The traveled trail is added first so the
  // route dots draw on top of it.
  const ensureRoute = React.useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    if (!map.isStyleLoaded()) {
      map.once("styledata", ensureRoute);
      return;
    }

    if (!map.getSource("route-traveled")) {
      map.addSource("route-traveled", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
      map.addLayer({
        id: "route-traveled-dots",
        type: "circle",
        source: "route-traveled",
        paint: {
          "circle-radius": TRAVELED_DOT_RADIUS,
          "circle-color": TRAVELED_COLOR,
          "circle-opacity": 0.9,
          "circle-stroke-color": "#ffffff",
          "circle-stroke-width": 1.25,
          "circle-stroke-opacity": 0.85,
        },
      });
    }

    if (!map.getSource("route-dots")) {
      map.addSource("route-dots", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
      map.addLayer({
        id: "route-dots",
        type: "circle",
        source: "route-dots",
        paint: {
          "circle-radius": DOT_RADIUS,
          "circle-color": ROUTE_COLOR,
          "circle-opacity": 0.95,
          "circle-stroke-color": "#ffffff",
          "circle-stroke-width": 1.25,
          "circle-stroke-opacity": 0.9,
        },
      });
    }
    paintDots(); // fills the source at the current zoom + phase
    syncDotAnimation();
  }, [paintDots, syncDotAnimation]);

  // Hide the basemap's own POI / building / house-number labels so our node
  // labels don't fight them, while keeping street + water names. Runs once the
  // style is loaded (and re-runs on `styledata` after a theme swap, which brings
  // in a fresh set of label layers).
  const stripLabels = React.useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    if (!map.isStyleLoaded()) {
      map.once("styledata", stripLabels);
      return;
    }
    for (const layer of map.getStyle().layers ?? []) {
      if (layer.type !== "symbol") continue;
      const sourceLayer = (layer as maplibregl.SymbolLayerSpecification)["source-layer"];
      if (sourceLayer && isHiddenLabelLayer(sourceLayer)) {
        map.setLayoutProperty(layer.id, "visibility", "none");
      }
    }
  }, []);

  // Theme swap — DOM markers survive setStyle (they aren't style layers), so
  // swapping the basemap is all that's needed here.
  React.useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    map.setStyle(basemapStyleUrl(dark));
    // setStyle wipes custom sources/layers — re-add the outlines + route, and
    // re-strip the new style's labels, once it reloads.
    ensureBoundaries();
    ensureRoute();
    stripLabels();
  }, [dark, ready, ensureBoundaries, ensureRoute, stripLabels]);

  // Strip labels on first style load too (the theme effect only fires on swaps).
  React.useEffect(() => {
    if (ready) stripLabels();
  }, [ready, stripLabels]);

  // Draw / update / clear the active walking route (+ traveled trail), and frame
  // it when it appears.
  React.useEffect(() => {
    routeCoordsRef.current = route ?? null;
    traveledCoordsRef.current = traveled ?? null;
    dotAnimateRef.current = animateRoute;
    if (!ready) return;
    ensureRoute();
    // Frame the whole route in *preview* only. While following (navigating), a
    // mid-trip re-route must redraw the line without yanking the camera off the
    // user — the follow-cam owns the viewport then.
    if (route && route.length > 1 && mapRef.current && !followRef.current) {
      const b = new maplibregl.LngLatBounds();
      for (const c of route) b.extend(c);
      // Reserve space for the nav overlays (green turn sign + bottom ETA bar,
      // tagged `data-map-chrome`) so the route's endpoints land in the visible
      // band instead of under the UI.
      mapRef.current.fitBounds(b, {
        padding: chromePadding(containerRef.current),
        maxZoom: 17,
        duration: 500,
      });
    }
  }, [route, traveled, animateRoute, ready, ensureRoute]);

  // Reflow the dot spacing to the new zoom while zooming — the march timer already
  // repaints during navigation, but this keeps the density right in preview (and
  // during a pinch) too. Stop the march timer on unmount so it can't outlive the map.
  React.useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    map.on("zoom", paintDots);
    return () => {
      map.off("zoom", paintDots);
    };
  }, [ready, paintDots]);
  React.useEffect(() => {
    return () => {
      if (dotTimerRef.current !== 0) {
        clearInterval(dotTimerRef.current);
        dotTimerRef.current = 0;
      }
    };
  }, []);

  // Recompute the park outline(s) and (re)install the layers: all parks on the
  // overview, just the active park in a park view.
  React.useEffect(() => {
    if (!ready) return;
    const shapes = effectiveSlug
      ? (parks ?? []).filter((p) => p.slug === effectiveSlug)
      : (overview?.parks ?? []);
    boundaryFCRef.current = boundaryFeatureCollection(shapes);
    ensureBoundaries();
  }, [effectiveSlug, parks, overview, ready, ensureBoundaries]);

  // Keep the canvas correct as the layout width animates.
  React.useEffect(() => {
    if (!mounted || !containerRef.current) return;
    const ro = new ResizeObserver(() => mapRef.current?.resize());
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, [mounted]);

  const clearMarkers = React.useCallback(() => {
    layerRef.current?.clear();
    for (const m of markersRef.current) m.remove();
    markersRef.current = [];
    markerElsRef.current.clear();
  }, []);

  // Run the cluster pass now: pick the layout mode for the current zoom and
  // relayout. Cheap, but toggling marker visibility on every frame flickers, so
  // callers reach it through the debounced `scheduleRefresh` / `flushRefresh`.
  const runRefresh = React.useCallback(() => {
    const map = mapRef.current;
    const layer = layerRef.current;
    if (!layer) return;
    // Cluster inside a park until we're zoomed in far enough, then spread so
    // markers stop grouping and just nudge apart. Overview always spreads.
    const inPark = effectiveSlugRef.current != null;
    layer.setMode(inPark && (map?.getZoom() ?? 0) < SPREAD_ZOOM ? "cluster" : "spread");
    layer.refresh();
  }, []);

  // Debounced relayout for continuous motion (a trailing timer, reset on each
  // move frame) so a whole pan/zoom collapses into one pass instead of flickering
  // markers across the grouping threshold frame by frame.
  const scheduleRefresh = React.useCallback(() => {
    if (declutterTimerRef.current) clearTimeout(declutterTimerRef.current);
    declutterTimerRef.current = window.setTimeout(() => {
      declutterTimerRef.current = 0;
      runRefresh();
    }, DECLUTTER_SETTLE_MS);
  }, [runRefresh]);

  // Immediate relayout, cancelling any pending debounce — used on `moveend` so the
  // settled layout snaps in without waiting out the debounce.
  const flushRefresh = React.useCallback(() => {
    if (declutterTimerRef.current) {
      clearTimeout(declutterTimerRef.current);
      declutterTimerRef.current = 0;
    }
    runRefresh();
  }, [runRefresh]);

  // Fly the camera to a park's bounds (used by free-roam park-badge taps). No
  // max-bounds cap here — roam keeps the whole region pannable.
  const flyToPark = React.useCallback((slug: string) => {
    const map = mapRef.current;
    const park = parksRef.current?.find((p) => p.slug === slug);
    if (!map || !park) return;
    map.setMaxZoom(21);
    map.setMaxBounds(null);
    if (park.bounds) {
      map.fitBounds(
        [
          [park.bounds.lngMin, park.bounds.latMin],
          [park.bounds.lngMax, park.bounds.latMax],
        ],
        {
          padding: chromePadding(containerRef.current),
          maxZoom: 17,
          duration: MAP_FLY_MS,
        },
      );
    } else if (park.latitude != null && park.longitude != null) {
      map.flyTo({
        center: [park.longitude, park.latitude],
        zoom: park.mapZoom ?? 15,
        duration: MAP_FLY_MS,
      });
    }
  }, []);

  // Rebuild markers: park badges on the overview, attraction pins when a park is
  // active. Each marker becomes a DeclutterItem the cluster controller drives.
  React.useEffect(() => {
    const map = mapRef.current;
    const layer = layerRef.current;
    if (!map || !layer || !ready) return;
    clearMarkers();
    // Overview spreads its handful of parks apart; a park view clusters its rides
    // until it's zoomed in past SPREAD_ZOOM, where it spreads too (no grouping).
    layer.setMode(effectiveSlug && map.getZoom() < SPREAD_ZOOM ? "cluster" : "spread");
    const items: Array<DeclutterItem> = [];

    if (!effectiveSlug) {
      cardRef.current?.close();
      cardRef.current = null;
      for (const p of overview?.parks ?? []) {
        if (p.latitude == null || p.longitude == null) continue;
        const lngLat: [number, number] = [p.longitude, p.latitude];
        // Actively navigating: show only the destination, hide everything else.
        if (navDest && !sameCoords(lngLat, navDest)) continue;
        const { el, detail } = buildParkBadgeEl(p);
        const raise = makeRaise(el);
        if (containerRef.current) wireHoverLabelFlip(el, containerRef.current);
        const marker = new maplibregl.Marker({ element: el }).setLngLat(lngLat).addTo(map);
        markersRef.current.push(marker);
        items.push({
          id: p.id,
          point: () => map.project(lngLat),
          detail,
          raise,
          // Roam: a tap flies into the park (zoom reveals its rides) without
          // leaving the map. Otherwise navigate to the park page as before.
          onActivate: () => {
            if (roam) {
              setFocusSlug(p.slug);
              flyToPark(p.slug);
            } else {
              void navigate({ to: "/park/$slug", params: { slug: p.slug } });
            }
          },
          // Busier parks anchor their cluster; tie-break is stable input order.
          priority: p.operating,
        });
      }
    } else {
      // Every attraction pin on a park view belongs to the focused park, so its
      // operator (Disney vs Universal) is fixed — resolve it once for the card's
      // Lightning Lane / Express labelling.
      const operatorSlug =
        parksRef.current?.find((p) => p.slug === effectiveSlug)?.operatorSlug ?? null;
      for (const a of board ?? []) {
        if (a.latitude == null || a.longitude == null) continue;
        if (a.entityType !== "ATTRACTION") continue;
        if (
          filter &&
          !rideMatchesFilter(
            {
              category: a.category,
              status: a.status,
              standbyWait: a.standbyWait,
              heightRequirement: a.meta?.heightRequirement ?? null,
            },
            filter,
            // On the roam map, once the user has turned on another layer
            // (Shops/Eats), deselecting every ride group hides the rides
            // instead of falling back to showing them all. With nothing
            // selected at all we keep the default rides+shows.
            { emptyCategoriesMatchNone: roam && anyMapLayerActive(filter.layers) },
          )
        )
          continue;
        const lngLat: [number, number] = [a.longitude, a.latitude];
        // Actively navigating: show only the destination, hide every other ride.
        if (navDest && !sameCoords(lngLat, navDest)) continue;
        const { el, detail } = buildAttractionEl(a, a.id === selectedIdRef.current);
        const raise = makeRaise(el);
        if (containerRef.current) wireHoverLabelFlip(el, containerRef.current);
        const waitLabel = waitLabelFor(a);
        const rideHref = `/park/${effectiveSlug}/ride/${a.slug}`;
        const marker = new maplibregl.Marker({ element: el }).setLngLat(lngLat).addTo(map);
        markersRef.current.push(marker);
        markerElsRef.current.set(a.id, detail);
        items.push({
          id: a.id,
          point: () => map.project(lngLat),
          detail,
          raise,
          onActivate: () => {
            const wasSelected = a.id === selectedIdRef.current;
            onSelectRef.current?.({ id: a.id, name: a.name });
            // Warm the ride page's data the moment its card opens, so tapping
            // "More info" navigates instantly instead of blocking on the route
            // loader's uncached `attraction` fetch (the imperative navigate below
            // never triggers the router's intent-preload).
            void queryClient.prefetchQuery(
              trpc.parks.attraction.queryOptions({ parkSlug: effectiveSlug, rideSlug: a.slug }),
            );
            cardRef.current?.close();
            if (!containerRef.current) return;
            // Morph the marker's own disc into an info card in place, lifting it
            // above its neighbors for as long as it's open.
            raise(true);
            const { card, close } = openAttractionCard({
              detail,
              container: containerRef.current,
              bodyHtml: attractionCardBodyHtml(a, waitLabel, rideHref, operatorSlug),
              wasSelected,
              onClose: () => raise(false),
            });
            cardRef.current = { close };
            // Intercept the in-card "More info" link for client-side navigation.
            card.querySelector<HTMLAnchorElement>("[data-spa]")?.addEventListener("click", (e) => {
              e.preventDefault();
              void navigate({
                to: "/park/$slug/ride/$rideSlug",
                params: { slug: effectiveSlug, rideSlug: a.slug },
              });
            });
            // "Directions" asks the stage to route from the user's location here.
            card
              .querySelector<HTMLButtonElement>("[data-directions]")
              ?.addEventListener("click", (e) => {
                e.preventDefault();
                if (a.longitude != null && a.latitude != null) {
                  onRequestDirectionsRef.current?.({
                    id: a.id,
                    name: a.name,
                    coords: [a.longitude, a.latitude],
                  });
                }
                close();
                cardRef.current = null;
              });
          },
          priority: attractionPriority(a),
          kind: attractionKind(a.category),
          wait: a.status === "OPERATING" && a.standbyWait != null ? a.standbyWait : null,
        });
      }

      // Optional POI overlay layers (dining/shops), folded into the SAME cluster
      // as the rides so they group + collision-avoid together. Scoped to the
      // focused park's boundary (the resort-wide feed clipped to this park — the
      // same containment test roam uses); no boundary → plot nothing rather than
      // dumping every WDW venue here. Negative ids keep them clear of the
      // positive attraction/park id space the cluster + selection use.
      const boundary = parks?.find((p) => p.slug === effectiveSlug)?.boundary ?? null;
      if (boundary && layers && anyMapLayerActive(layers)) {
        // The park_poi feed carries all three overlay categories; pick the ones
        // whose layer is lit (Live folds entertainment + character meets).
        const overlayPoi = (poiQ.data ?? []).filter(
          (p) =>
            (layers?.services && p.category === "info") ||
            (layers?.entertainment &&
              (p.category === "entertainment" || p.category === "character")) ||
            (layers?.tours && p.category === "tour"),
        );
        // The dining feed carries both reservable table-service venues and
        // non-bookable quick service/carts (tagged 'quick-service' — see
        // `parks.dining`); split it across the two layers so each toggles
        // independently instead of lumping carts in with sit-down dining.
        const diningData = diningQ.data ?? [];
        const pois = [
          ...(layers?.dining ? diningData.filter((p) => p.category !== "quick-service") : []),
          ...(layers?.quickService ? diningData.filter((p) => p.category === "quick-service") : []),
          ...(layers?.shops ? (shopsQ.data ?? []) : []),
          ...overlayPoi,
        ];
        pois.forEach((poi, i) => {
          if (poi.latitude == null || poi.longitude == null) return;
          const lngLat: [number, number] = [poi.longitude, poi.latitude];
          if (!pointInPolygon(lngLat, boundary)) return;
          // Actively navigating: show only the destination, hide every other POI.
          if (navDest && !sameCoords(lngLat, navDest)) return;
          const { el, detail } = buildPoiEl(poi);
          const raise = makeRaise(el);
          if (containerRef.current) wireHoverLabelFlip(el, containerRef.current);
          const marker = new maplibregl.Marker({ element: el }).setLngLat(lngLat).addTo(map);
          markersRef.current.push(marker);
          items.push({
            id: -(i + 1),
            point: () => map.project(lngLat),
            detail,
            raise,
            onActivate: () => {
              cardRef.current?.close();
              if (!containerRef.current) return;
              // Same disc→card morph as rides, with the shared POI body.
              raise(true);
              const { card, close } = openAttractionCard({
                detail,
                container: containerRef.current,
                bodyHtml: poiCardBodyHtml(poi),
                wasSelected: false,
                onClose: () => raise(false),
              });
              cardRef.current = { close };
              // "Details" always lands on our own page (never the operator site):
              // shops → /shop/$slug, dining → /dining/$facilityId. The target ids
              // ride on data attributes so one handler covers both.
              card
                .querySelector<HTMLAnchorElement>("[data-spa]")
                ?.addEventListener("click", (e) => {
                  e.preventDefault();
                  const link = e.currentTarget as HTMLAnchorElement;
                  const shopSlug = link.getAttribute("data-shop-slug");
                  const diningId = link.getAttribute("data-dining-id");
                  if (shopSlug) void navigate({ to: "/shop/$slug", params: { slug: shopSlug } });
                  else if (diningId)
                    void navigate({ to: "/dining/$facilityId", params: { facilityId: diningId } });
                });
              // "Directions" routes from the user's location to this POI, same as
              // rides. Negative ids keep POIs clear of the attraction id space.
              card
                .querySelector<HTMLButtonElement>("[data-directions]")
                ?.addEventListener("click", (e) => {
                  e.preventDefault();
                  if (poi.longitude != null && poi.latitude != null) {
                    onRequestDirectionsRef.current?.({
                      id: -(i + 1),
                      name: poi.name,
                      coords: [poi.longitude, poi.latitude],
                    });
                  }
                  close();
                  cardRef.current = null;
                });
            },
            // POIs never anchor a cluster over a ride — a nearby ride heads the
            // group, the POI folds under its dot.
            priority: 0,
            kind: poiKind(poi.category),
          });
        });
      }
    }

    layer.setItems(items);
    layer.refresh();
    // Click on empty map dismisses the popup and clears the selection
    // (marker clicks stopPropagation, so this only fires on the bare map).
    const onMapClick = () => {
      cardRef.current?.close();
      cardRef.current = null;
      onDeselectRef.current?.();
    };
    map.on("move", scheduleRefresh);
    map.on("moveend", flushRefresh);
    map.on("click", onMapClick);
    return () => {
      map.off("move", scheduleRefresh);
      map.off("moveend", flushRefresh);
      map.off("click", onMapClick);
      if (declutterTimerRef.current) {
        clearTimeout(declutterTimerRef.current);
        declutterTimerRef.current = 0;
      }
    };
  }, [
    effectiveSlug,
    overview,
    board,
    parks,
    diningQ.data,
    shopsQ.data,
    poiQ.data,
    ready,
    navigate,
    clearMarkers,
    scheduleRefresh,
    flushRefresh,
    roam,
    filter,
    flyToPark,
    queryClient,
    trpc,
    navDestKey,
  ]);

  // Free-roam focus watcher: after each pan/zoom, reveal a park's rides once the
  // viewport is zoomed in over it, and fall back to park badges when zoomed out.
  React.useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !roam) return;
    const onMoveEnd = () => {
      const z = map.getZoom();
      const c = map.getCenter();
      // Remember the roam camera so returning to `/map` restores this exact view.
      saveRoamCamera({ center: [c.lng, c.lat], zoom: z });
      if (z >= ROAM_RIDE_ZOOM) {
        const park = (parksRef.current ?? []).find((p) =>
          pointInPolygon([c.lng, c.lat], p.boundary ?? null),
        );
        if (park) {
          if (park.slug !== focusSlugRef.current) setFocusSlug(park.slug);
        } else if (focusSlugRef.current != null) {
          setFocusSlug(null);
        }
      } else if (focusSlugRef.current != null) {
        setFocusSlug(null);
      }
    };
    map.on("moveend", onMoveEnd);
    return () => {
      map.off("moveend", onMoveEnd);
    };
  }, [ready, roam]);

  // Roam auto-focus: the first location fix that lands inside a park flies in and
  // reveals its rides (the in-map equivalent of "open the park you're standing in").
  const autoFocusedRef = React.useRef(false);
  React.useEffect(() => {
    if (!roam || autoFocusedRef.current || !ready || !userLocation) return;
    const park = (parksRef.current ?? []).find((p) =>
      pointInPolygon(userLocation.coords, p.boundary ?? null),
    );
    if (park) {
      autoFocusedRef.current = true;
      setFocusSlug(park.slug);
      flyToPark(park.slug);
    }
  }, [roam, ready, userLocation, flyToPark]);

  // Report the roam focus (which park's rides are revealed) up to the stage so it
  // can offer a "view park details" shortcut. Null outside roam / when zoomed out.
  const onRoamFocusChangeRef = React.useRef(onRoamFocusChange);
  onRoamFocusChangeRef.current = onRoamFocusChange;
  React.useEffect(() => {
    onRoamFocusChangeRef.current?.(roam ? focusSlug : null);
  }, [focusSlug, roam]);

  // Update selection highlight in place (no marker rebuild, so a popup stays open).
  React.useEffect(() => {
    for (const [id, el] of markerElsRef.current) applySelected(el, id === selectedId);
    // Re-cluster so the selected marker is promoted to its own anchor.
    scheduleRefresh();
  }, [selectedId, board, ready, scheduleRefresh]);

  // "You are here" marker — created on the first fix, moved on later updates,
  // removed when location turns off. It's a plain DOM marker (not a DeclutterItem)
  // so the cluster pass never touches it. The facing cone points along the heading
  // in *screen* space, so we subtract the map bearing (heading-up keeps the cone
  // pointing up). Heading prefers the live device compass (works standing still)
  // and falls back to GPS course-over-ground; it hides when both are unknown.
  React.useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    if (!userLocation) {
      userMarkerRef.current?.remove();
      userMarkerRef.current = null;
      paintConeRef.current = () => {};
      return;
    }
    if (!userMarkerRef.current) {
      userMarkerRef.current = new maplibregl.Marker({ element: buildUserLocationEl() });
    }
    userMarkerRef.current.setLngLat(userLocation.coords).addTo(map);
    if (userLocation.heading != null) lastHeadingRef.current = userLocation.heading;
    const el = userMarkerRef.current.getElement();
    const paint = () => {
      const h = deviceHeadingRef.current ?? userLocation.heading;
      setUserHeading(el, h == null ? null : h - map.getBearing());
    };
    paintConeRef.current = paint;
    paint();
    // Re-point the cone as the map rotates (heading-up follow-cam), and clean up.
    map.on("rotate", paint);
    return () => {
      map.off("rotate", paint);
      paintConeRef.current = () => {};
    };
  }, [userLocation, ready]);

  // Re-point the facing cone on each new compass reading — cheap DOM write, no
  // marker rebuild — so it tracks a turn-in-place even without a new GPS fix.
  React.useEffect(() => {
    paintConeRef.current();
  }, [deviceHeading]);

  // Follow-cam: recenter (and, heading-up, rotate) on the user as their fix
  // updates. Only while `follow` is on — a manual pan clears it upstream. Uses a
  // short easeTo so walking reads as a smooth glide, not teleports. `follow` /
  // `headingUp` are read via refs (not deps) so toggling them doesn't re-run
  // this and clobber the engage-time flyToLocation zoom; it fires on new fixes.
  React.useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !followRef.current || !userLocation || engagingRef.current) return;
    const bearing = headingUpRef.current
      ? (deviceHeadingRef.current ??
        userLocation.heading ??
        lastHeadingRef.current ??
        map.getBearing())
      : 0;
    map.easeTo({ center: userLocation.coords, bearing, duration: 500 });
  }, [userLocation, ready]);

  // Heading-up live rotation: while following with heading-up on, rotate the map
  // to the compass as the user turns in place — the recenter effect above only
  // fires on GPS fixes, which don't arrive when standing still. Keyed on
  // `deviceHeading` (already smoothed + ~1°-thresholded upstream) so it tracks a
  // turn without spamming; a short easeTo keeps it a glide. Skips while an engage
  // fly is animating so it can't fight the initial zoom-in.
  React.useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !followRef.current || !headingUpRef.current) return;
    if (deviceHeading == null || engagingRef.current) return;
    map.easeTo({ bearing: deviceHeading, duration: 300 });
  }, [deviceHeading, ready]);

  // Kingdom Hearts play layer — render Darkness spawns (tap → battle) and discovery
  // pins (popup with note + reactions) as plain DOM markers over the roam map.
  // Cleared whenever play turns off. Independent of the ride-cluster effect.
  React.useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    for (const m of playMarkersRef.current) m.remove();
    playMarkersRef.current = [];
    if (!play) return;
    for (const mk of marksQ.data ?? []) {
      if (mk.latitude == null || mk.longitude == null) continue;
      const el = livingMarkerEl(mk.isSystem ? "darkness" : "discovery");
      const marker = new maplibregl.Marker({ element: el }).setLngLat([mk.longitude, mk.latitude]);
      if (mk.isSystem) {
        // A Darkness spawn — tapping it hands the battle up to the stage overlay.
        // stopPropagation so the same tap doesn't also drop a discovery pin.
        el.addEventListener("click", (e) => {
          e.stopPropagation();
          onEngageDarknessRef.current?.(mk.id);
        });
      } else {
        const note = (mk.payload as { note?: string } | null)?.note;
        const popup = new maplibregl.Popup({ offset: 14 }).setHTML(
          `<div style="font:14px system-ui;max-width:220px">
             <strong>Discovery</strong>
             <div style="margin-top:4px;color:#555">${escapeHtml(note ?? "")}</div>
             <div style="margin-top:8px;display:flex;gap:8px">
               <button data-react="found" data-id="${mk.id}">Found it (${mk.findCount})</button>
               <button data-react="upvote" data-id="${mk.id}">▲ (${mk.upvoteCount})</button>
               <button data-react="report" data-id="${mk.id}">Report</button>
             </div>
           </div>`,
        );
        popup.on("open", () => {
          popup
            .getElement()
            ?.querySelectorAll<HTMLButtonElement>("button[data-react]")
            .forEach((btn) => {
              btn.onclick = () =>
                reactMarkRef.current.mutate({
                  markId: Number(btn.dataset.id),
                  kind: btn.dataset.react as "found" | "upvote" | "report",
                });
            });
        });
        marker.setPopup(popup);
      }
      marker.addTo(map);
      playMarkersRef.current.push(marker);
    }
  }, [play, marksQ.data, ready]);

  // Dev-destination pins — the nav QA tools' test spots (near home), drawn as
  // temporary markers only while actively navigating so a dev target, which isn't
  // a real attraction on the map, is still visible. The spot we're routing to is
  // highlighted + labeled. Plain DOM markers, kept out of the ride cluster;
  // cleared the moment navigation ends. No-op for normal users (empty list).
  React.useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    for (const m of devMarkersRef.current) m.remove();
    devMarkersRef.current = [];
    if (!navDest || devDestinations.length === 0) return;
    for (const spot of devDestinations) {
      const el = buildDevSpotEl(spot.label, sameCoords(spot.coords, navDest));
      const marker = new maplibregl.Marker({ element: el, anchor: "bottom" })
        .setLngLat(spot.coords)
        .addTo(map);
      devMarkersRef.current.push(marker);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navDestKey, devDestinations, ready]);

  // Play mode: a tap on the bare map (not a marker) asks the stage to open the
  // discovery-drop sheet at that point. Marker taps land on their own DOM element
  // (above the canvas), so they never reach this canvas-level handler.
  React.useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !play) return;
    const onClick = (e: maplibregl.MapMouseEvent) => {
      onDropDiscoveryRef.current?.({ lat: e.lngLat.lat, lng: e.lngLat.lng });
    };
    map.on("click", onClick);
    return () => {
      map.off("click", onClick);
    };
  }, [play, ready]);

  // Camera: fit both resorts on the overview, fly into the active park. Built
  // as a closure recomputed each render and stashed in a ref so the delayed
  // scheduler below always reads fresh data without re-firing the fly on every
  // query refetch.
  const runFly = () => {
    const map = mapRef.current;
    if (!map || !attached) return;

    if (roam) {
      // Free-roam: frame all parks but let the user zoom all the way in. Rides
      // reveal themselves by zoom (the focus watcher above), so no zoom cap and
      // no max-bounds — the whole region stays explorable.
      map.setMaxZoom(18);
      map.setMaxBounds(null);
      // Returning to the map: restore the exact camera the user left (so a round
      // trip through a ride page doesn't snap back to the all-parks overview).
      const saved = getRoamCamera();
      if (saved) {
        map.jumpTo({ center: saved.center, zoom: saved.zoom });
        return;
      }
      const coords = (overview?.parks ?? []).filter(
        (p): p is typeof p & { latitude: number; longitude: number } =>
          p.latitude != null && p.longitude != null,
      );
      if (coords.length === 0) {
        map.flyTo({ center: ORLANDO_CENTER, zoom: ORLANDO_ZOOM });
        return;
      }
      const b = new maplibregl.LngLatBounds();
      for (const p of coords) b.extend([p.longitude, p.latitude]);
      map.fitBounds(b, {
        padding: chromePadding(containerRef.current),
        maxZoom: 12,
        duration: MAP_FLY_MS,
      });
      return;
    }

    if (!activeSlug) {
      // Overview/home: fit both resorts, then cap pan/zoom-out to that area.
      // Cap zoom-in too — the overview is a regional picture, not a park view.
      map.setMaxZoom(13);
      map.setMaxBounds(null);
      const coords = (overview?.parks ?? []).filter(
        (p): p is typeof p & { latitude: number; longitude: number } =>
          p.latitude != null && p.longitude != null,
      );
      if (coords.length === 0) {
        map.flyTo({ center: ORLANDO_CENTER, zoom: ORLANDO_ZOOM });
        return;
      }
      const b = new maplibregl.LngLatBounds();
      for (const p of coords) b.extend([p.longitude, p.latitude]);
      map.fitBounds(b, {
        padding: chromePadding(containerRef.current),
        maxZoom: 12,
        duration: MAP_FLY_MS,
      });
      void map.once("moveend", () => map.setMaxBounds(paddedBounds(b, 0.6)));
      return;
    }

    const park = parks?.find((p) => p.slug === activeSlug);
    if (!park) return;
    // Park views need close zoom; lift the overview's cap.
    map.setMaxZoom(21);
    if (park.bounds) {
      const bounds = park.bounds;
      // Clear first so the fit isn't constrained mid-flight, then cap the
      // zoom-out once we've arrived at the park.
      map.setMaxBounds(null);
      map.fitBounds(
        [
          [bounds.lngMin, bounds.latMin],
          [bounds.lngMax, bounds.latMax],
        ],
        {
          padding: chromePadding(containerRef.current),
          maxZoom: 17,
          duration: MAP_FLY_MS,
        },
      );
      void map.once("moveend", () => map.setMaxBounds(zoomOutBounds(bounds)));
    } else if (park.latitude != null && park.longitude != null) {
      map.setMaxBounds(null);
      map.flyTo({
        center: [park.longitude, park.latitude],
        zoom: park.mapZoom ?? 15,
        duration: MAP_FLY_MS,
      });
    }
  };
  const runFlyRef = React.useRef(runFly);
  runFlyRef.current = runFly;

  // Schedule the fly after the box morph settles (layout first, then zoom). Keyed
  // on the navigation target and data *presence* (stable booleans) — not the
  // data objects — so a background refetch can't queue a second, competing fly.
  const hasOverview = (overview?.parks?.length ?? 0) > 0;
  const hasParks = (parks?.length ?? 0) > 0;
  React.useEffect(() => {
    if (!ready || !attached) return;
    const t = setTimeout(() => runFlyRef.current(), MORPH_MS);
    return () => clearTimeout(t);
  }, [activeSlug, ready, hasOverview, hasParks, attached, roam]);

  if (!mounted) {
    return <div className="size-full bg-muted" aria-hidden />;
  }
  // `isolate` gives the map its own stacking context so markers — which lift to a
  // high z-index on hover/select/card-open — stay beneath the app chrome (search,
  // nav, filter, zoom), which is layered over the map at z-10.
  return <div ref={containerRef} className="isolate size-full" />;
}
