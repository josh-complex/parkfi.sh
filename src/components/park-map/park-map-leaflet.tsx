"use client";

import * as React from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import * as L from "leaflet";
import { useTheme } from "next-themes";

import {
  anyMapLayerActive,
  rideMatchesFilter,
  type RideFilter,
} from "#/components/rides/ride-filter.tsx";
import { useTRPC } from "#/integrations/trpc/react.ts";
import { pointInPolygon } from "#/server/living/geofence.ts";

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
  poiCardBodyHtml,
  poiKind,
  sameCoords,
  setUserHeading,
  chromePadding,
  DECLUTTER_SIZE,
  getRoamCamera,
  type MapHandle,
  MAP_FLY_MS,
  MORPH_MS,
  openAttractionCard,
  ORLANDO_CENTER,
  ORLANDO_ZOOM,
  saveRoamCamera,
  SPREAD_ZOOM,
  waitLabelFor,
  wireHoverLabelFlip,
} from "./shared.tsx";

import "leaflet/dist/leaflet.css";
import "./park-map-leaflet.css";

const FLY_SECONDS = MAP_FLY_MS / 1000;

// Zoom at/above which free-roam reveals a park's rides (mirrors the GL renderer).
const ROAM_RIDE_ZOOM = 14;

// Stable default for the `devDestinations` prop (see the GL renderer).
const EMPTY_DEV_DESTINATIONS: ReadonlyArray<{
  id: string;
  label: string;
  coords: [number, number];
}> = [];

// How long the map must sit still before the cluster pass re-runs — debounced so
// markers don't flicker in/out across the grouping threshold on every pan/zoom
// frame (flushed immediately on move/zoom end). Mirrors the GL renderer.
const DECLUTTER_SETTLE_MS = 150;

/**
 * Keyless raster basemap, per the app theme — the same OSM Standard (light) /
 * Carto dark (dark) tiles the MapLibre renderer uses, so the two engines look
 * identical. Leaflet pulls them straight as `<img>` tiles (no WebGL).
 */
function makeTileLayer(dark: boolean): L.TileLayer {
  // maxNativeZoom caps the deepest tiles the provider actually serves; maxZoom
  // sits above it so Leaflet upscales (overzooms) those tiles for the extra-close
  // park levels instead of blanking out.
  return dark
    ? L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png", {
        subdomains: "abcd",
        maxNativeZoom: 20,
        maxZoom: 21,
        attribution:
          '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors © <a href="https://carto.com/attributions">CARTO</a>',
      })
    : L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        subdomains: "abc",
        maxNativeZoom: 19,
        maxZoom: 21,
        attribution:
          '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      });
}

/**
 * A marker's z-lift, reference-counted. Leaflet computes each marker's z-index
 * from its latitude; a large offset wins. Also wires hover to the same lift;
 * returns the `raise(on)` to hand the cluster controller.
 */
function makeRaise(el: HTMLElement, marker: L.Marker): (on: boolean) => void {
  let count = 0;
  // Recompute the marker's resting z-offset from its lift count.
  const applyZ = () => marker.setZIndexOffset(count > 0 ? 1000 : 0);
  const raise = (on: boolean) => {
    count += on ? 1 : -1;
    applyZ();
  };
  el.addEventListener("mouseenter", () => {
    raise(true);
    // The hovered marker jumps to an exclusive z-offset above every other marker
    // so its expanded label always clears its neighbors. Demote the previously
    // hovered marker back to its resting z first, so only one ever holds the top
    // slot (no DOM reorder, which would drop :hover and cancel the click).
    if (topHover && topHover !== applyZ) topHover();
    topHover = applyZ;
    marker.setZIndexOffset(3000);
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

/**
 * Wrap a marker element in a zero-size DivIcon centered on its point. Leaflet
 * anchors a DivIcon by its top-left corner; the wrapper's translate(-50%, -50%)
 * recenters it so it sits on the coordinate exactly like a MapLibre marker
 * (whose default anchor is the center). The translate lives on the wrapper, not
 * the element, so the element's own hover/selection scaling never fights it.
 */
function pointIcon(el: HTMLElement): L.DivIcon {
  const wrap = document.createElement("div");
  wrap.style.transform = "translate(-50%, -50%)";
  wrap.appendChild(el);
  return L.divIcon({ html: wrap, className: "parkfi-marker", iconSize: [0, 0] });
}

/**
 * DOM/raster fallback for the park map, used when the browser can't give us a
 * WebGL context (so MapLibre would crash). Mirrors `ParkMap` feature-for-feature
 * — park badges, attraction pins, decluttering, popups, and the same fly/fit
 * camera — using Leaflet, which renders everything as plain DOM + `<img>` tiles.
 */
export function ParkMapLeaflet({
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
  onUserInteract,
  roam = false,
  filter,
  onRoamFocusChange,
}: {
  activeSlug: string | null;
  selectedId?: number | null;
  onSelectAttraction?: (item: { id: number; name: string }) => void;
  /** Clicking the empty map clears the current selection. */
  onDeselect?: () => void;
  onMapRef?: (map: MapHandle | null) => void;
  /** True only while the map is lent to a visible slot. Camera flies are gated
   *  on it — flying into a 0×0 parked container yields NaN LatLngs and throws. */
  attached?: boolean;
  /** The user's live position ([lng,lat] + accuracy + GPS heading), drawn as a
   *  "you are here" dot with a facing cone. Null when location is off/denied. */
  userLocation?: { coords: [number, number]; accuracy: number; heading: number | null } | null;
  /** Live device-compass heading (degrees clockwise from north), preferred over
   *  GPS course-over-ground for the facing cone since it works standing still.
   *  Null when unavailable. */
  deviceHeading?: number | null;
  /** Active walking route geometry ([lng,lat] points) to draw, or null. */
  route?: Array<[number, number]> | null;
  /** Breadcrumb of where the user has already walked ([lng,lat]) — a grayed trail
   *  behind the remaining route. Null when not navigating. */
  traveled?: Array<[number, number]> | null;
  /** March the route dashes toward the destination (active nav); static otherwise. */
  animateRoute?: boolean;
  /** A "Directions" tap in an attraction popup — asks the stage to route here. */
  onRequestDirections?: (d: { id: number; name: string; coords: [number, number] }) => void;
  /** While actively navigating, the destination's [lng,lat]. Set, it hides every
   *  other marker so only the destination + route remain; null when idle. */
  navDest?: [number, number] | null;
  /** The dev picker's test destinations — temporary pins shown while navigating
   *  so a dev target (not a real attraction) is visible. Empty for normal users. */
  devDestinations?: ReadonlyArray<{ id: string; label: string; coords: [number, number] }>;
  /** Nav follow-cam: recenter on the user as their position updates. */
  follow?: boolean;
  /** Heading-up rotation — accepted for prop parity with the GL renderer, but a
   *  no-op here (vanilla Leaflet can't rotate). */
  headingUp?: boolean;
  /** Accepted for parity with the GL renderer; never called (no rotation). */
  onBearingChange?: (bearing: number) => void;
  /** Fires on a real user gesture (drag/zoom) so the stage can drop follow-cam. */
  onUserInteract?: () => void;
  /** Free-roam mode (`/map`): zoom reveals rides, no route navigation. */
  roam?: boolean;
  /** Shared ride filter — hides ride markers that don't match. */
  filter?: RideFilter;
  /** Roam only: reports which park's rides are currently revealed (or null). */
  onRoamFocusChange?: (slug: string | null) => void;
}) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { resolvedTheme } = useTheme();
  const dark = resolvedTheme === "dark";

  const [mounted, setMounted] = React.useState(false);
  const [ready, setReady] = React.useState(false);
  // Free-roam focus (see park-map.tsx) — which park's rides are revealed.
  const [focusSlug, setFocusSlug] = React.useState<string | null>(null);
  const focusSlugRef = React.useRef<string | null>(null);
  focusSlugRef.current = focusSlug;
  const effectiveSlug = roam ? focusSlug : activeSlug;
  const effectiveSlugRef = React.useRef<string | null>(effectiveSlug);
  effectiveSlugRef.current = effectiveSlug;
  // Stable dep for the marker effect — rebuilds when navigation starts/ends or
  // the destination changes, but not on every re-route/GPS tick (see GL renderer).
  const navDestKey = navDest ? `${navDest[0]},${navDest[1]}` : "";
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const mapRef = React.useRef<L.Map | null>(null);
  const tileRef = React.useRef<L.TileLayer | null>(null);
  const markersRef = React.useRef<Array<L.Marker>>([]);
  // Dev-destination pins (nav QA tools' test spots), a temporary overlay shown
  // only while navigating — kept apart from the ride cluster's bookkeeping.
  const devMarkersRef = React.useRef<Array<L.Marker>>([]);
  const markerElsRef = React.useRef<Map<number, HTMLElement>>(new Map());
  // Cluster controller (shared with the MapLibre renderer); see park-map.tsx.
  const layerRef = React.useRef<MarkerCluster | null>(null);
  const declutterTimerRef = React.useRef(0);
  // The currently-expanded marker card (see openAttractionCard), so any new
  // interaction can collapse it first.
  const cardRef = React.useRef<{ close: () => void } | null>(null);
  const userMarkerRef = React.useRef<L.Marker | null>(null);
  const boundaryRef = React.useRef<L.GeoJSON | null>(null);
  const onUserInteractRef = React.useRef(onUserInteract);
  onUserInteractRef.current = onUserInteract;
  const onSelectRef = React.useRef(onSelectAttraction);
  onSelectRef.current = onSelectAttraction;
  const onDeselectRef = React.useRef(onDeselect);
  onDeselectRef.current = onDeselect;
  const onRequestDirectionsRef = React.useRef(onRequestDirections);
  onRequestDirectionsRef.current = onRequestDirections;
  // Live mirror of `follow`, read inside effects that must not re-run when it
  // toggles: engaging follow shouldn't itself recenter (the imperative
  // `flyToLocation` owns the zoom-in — a panTo fired on the toggle would
  // interrupt that fly and drop the zoom). It fires on new fixes instead.
  const followRef = React.useRef(follow);
  followRef.current = follow;
  // Live compass heading, read inside the marker effect without re-running it at
  // sensor rate; a dedicated repaint effect keys off `deviceHeading` instead.
  const deviceHeadingRef = React.useRef(deviceHeading);
  deviceHeadingRef.current = deviceHeading;
  // True while an engage fly (flyToLocation) animates — a GPS fix landing mid-fly
  // must not fire the zoom-less panTo and interrupt the zoom-in. Cleared on the
  // fly's moveend.
  const engagingRef = React.useRef(false);
  const routeRef = React.useRef<L.Polyline | null>(null);
  const traveledRef = React.useRef<L.Polyline | null>(null);
  const selectedIdRef = React.useRef(selectedId);
  selectedIdRef.current = selectedId;

  const listQ = useQuery(trpc.parks.list.queryOptions());
  const overviewQ = useQuery(trpc.parks.overview.queryOptions());
  const boardQ = useQuery({
    ...trpc.parks.board.queryOptions({ parkSlug: effectiveSlug ?? "" }),
    enabled: !!effectiveSlug,
  });

  // Optional map overlay layers (dining / shops / POIs), driven by the shared
  // filter — same as the GL engine. Resort-wide feeds, fetched once a park is
  // focused and the board has loaded, then clipped to the park boundary at
  // render; a long staleTime keeps them warm as the user roams.
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
  const poiQ = useQuery({
    ...trpc.parks.poi.queryOptions(),
    enabled: poisEnabled,
    staleTime: POI_STALE_MS,
    gcTime: POI_STALE_MS,
  });

  const parks = listQ.data;
  const overview = overviewQ.data;
  const board = boardQ.data;
  const parksRef = React.useRef(parks);
  parksRef.current = parks;

  // SSR guard: Leaflet needs the DOM. Render a placeholder until mounted.
  React.useEffect(() => setMounted(true), []);

  // Init map once.
  React.useEffect(() => {
    if (!mounted || !containerRef.current || mapRef.current) return;
    const map = L.map(containerRef.current, {
      center: [ORLANDO_CENTER[1], ORLANDO_CENTER[0]],
      zoom: ORLANDO_ZOOM,
      zoomControl: false,
      attributionControl: true,
      // Solid wall at maxBounds (no elastic rubber-band). A popup's autoPan can
      // still slide within the padded bounds to reveal itself, but the view no
      // longer springs back toward the park when it reaches the edge.
      maxBoundsViscosity: 1.0,
    });
    // No native zoom control — our own 3D zoom buttons (in the stage) drive zoom
    // via the MapHandle below, so the map's controls match the app.
    tileRef.current = makeTileLayer(dark).addTo(map);
    layerRef.current = new MarkerCluster(
      DECLUTTER_SIZE,
      () => selectedIdRef.current ?? null,
      // Tap a cluster head -> zoom in on its members (layer points back to
      // lat/lng) so the group splits apart on the way in. A tight, near-coincident
      // group barely changes the fit zoom, which would just re-form the cluster, so
      // we always land at least a couple levels closer than we are now and allow a
      // deeper max so repeated taps keep progressing.
      (points) => {
        const lls = points.map((p) => map.layerPointToLatLng(L.point(p.x, p.y)));
        const bounds = L.latLngBounds(lls);
        // Reserve space for the chrome overlaying the map (top search/chips, the
        // bottom nav + zoom/locate controls) so the split-apart members land in
        // the visible band, not behind a button. Cap the fit at SPREAD_ZOOM: past
        // it the layout spreads markers apart anyway, so over-zooming a tight
        // two-node group just flings its members to opposite edges.
        const pad = chromePadding(containerRef.current, { sides: 70 });
        const fit = map.getBoundsZoom(
          bounds,
          false,
          L.point(pad.left + pad.right, pad.top + pad.bottom),
        );
        const target = Math.min(SPREAD_ZOOM, Math.max(fit, map.getZoom() + 2));
        // Offset the center at the target zoom so the group sits in the visible
        // band — clear of the top chrome and bottom controls — instead of the raw
        // viewport center (which tucks the top members under the chip rows).
        const dx = (pad.right - pad.left) / 2;
        const dy = (pad.bottom - pad.top) / 2;
        const center =
          dx || dy
            ? map.unproject(map.project(bounds.getCenter(), target).add(L.point(dx, dy)), target)
            : bounds.getCenter();
        map.flyTo(center, target, { duration: FLY_SECONDS });
      },
      // Any marker click collapses an open ride card before it zooms/activates.
      () => {
        cardRef.current?.close();
        cardRef.current = null;
      },
    );
    map.whenReady(() => setReady(true));
    // A manual pan drops follow-cam. `dragstart` fires only for pointer drags —
    // our follow-cam uses panTo/flyTo, which fire `movestart` (not `dragstart`) —
    // so this cleanly distinguishes the user grabbing the map from our own moves.
    map.on("dragstart", () => onUserInteractRef.current?.());
    mapRef.current = map;
    onMapRef?.({
      resize: () => {
        const c = containerRef.current;
        if (c && c.clientWidth > 0 && c.clientHeight > 0) {
          map.invalidateSize({ animate: false });
        }
      },
      zoomIn: () => map.zoomIn(),
      zoomOut: () => map.zoomOut(),
      flyToPark: (slug) => flyToPark(slug),
      flyToLocation: (coords, opts) => {
        const dur = opts?.duration ?? 700;
        engagingRef.current = true;
        const done = () => {
          engagingRef.current = false;
        };
        // Clear on the fly's end, with a timeout fallback for a no-op move that
        // never fires `moveend` (a stuck flag would disable the follow-cam).
        map.once("moveend", done);
        setTimeout(done, dur + 200);
        map.flyTo([coords[1], coords[0]], opts?.zoom ?? map.getZoom(), {
          duration: dur / 1000,
        });
      },
      // Leaflet can't rotate — bearing is meaningless here.
      setBearing: () => {},
    });
    return () => {
      map.remove();
      mapRef.current = null;
      tileRef.current = null;
      layerRef.current = null;
      onMapRef?.(null);
      setReady(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mounted]);

  // Theme swap — markers live in their own pane, so just swap the tile layer.
  React.useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    tileRef.current?.remove();
    tileRef.current = makeTileLayer(dark).addTo(map);
  }, [dark, ready]);

  // Keep the canvas correct as the layout width animates. Skip invalidateSize when
  // the container is hidden at 0×0 (parked off-screen) — Leaflet corrupts its
  // internal pixel origin when the container has no size, causing NaN LatLng errors.
  React.useEffect(() => {
    if (!mounted || !containerRef.current) return;
    const ro = new ResizeObserver(() => {
      const c = containerRef.current;
      if (c && c.clientWidth > 0 && c.clientHeight > 0) {
        mapRef.current?.invalidateSize({ animate: false });
      }
    });
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
  // relayout. Reached through the debounced helpers below so marker visibility
  // doesn't toggle on every frame.
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

  // Debounced relayout for continuous motion (trailing timer, reset per frame) so
  // a whole pan/zoom collapses into one pass instead of flickering markers.
  const scheduleRefresh = React.useCallback(() => {
    if (declutterTimerRef.current) clearTimeout(declutterTimerRef.current);
    declutterTimerRef.current = window.setTimeout(() => {
      declutterTimerRef.current = 0;
      runRefresh();
    }, DECLUTTER_SETTLE_MS);
  }, [runRefresh]);

  // Immediate relayout, cancelling any pending debounce — used on move/zoom end so
  // the settled layout snaps in without waiting out the debounce.
  const flushRefresh = React.useCallback(() => {
    if (declutterTimerRef.current) {
      clearTimeout(declutterTimerRef.current);
      declutterTimerRef.current = 0;
    }
    runRefresh();
  }, [runRefresh]);

  // Fly to a park's bounds (free-roam park-badge taps). No max-bounds cap.
  const flyToPark = React.useCallback((slug: string) => {
    const map = mapRef.current;
    const park = parksRef.current?.find((p) => p.slug === slug);
    if (!map || !park) return;
    map.setMaxZoom(21);
    map.setMaxBounds(null as unknown as L.LatLngBoundsExpression);
    if (park.bounds) {
      const pad = chromePadding(containerRef.current);
      map.flyToBounds(
        L.latLngBounds([
          [park.bounds.latMin, park.bounds.lngMin],
          [park.bounds.latMax, park.bounds.lngMax],
        ]),
        {
          paddingTopLeft: L.point(pad.left, pad.top),
          paddingBottomRight: L.point(pad.right, pad.bottom),
          maxZoom: 17,
          duration: FLY_SECONDS,
        },
      );
    } else if (park.latitude != null && park.longitude != null) {
      map.flyTo([park.latitude, park.longitude], park.mapZoom ?? 15, { duration: FLY_SECONDS });
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
        // Actively navigating: show only the destination, hide everything else.
        if (navDest && !sameCoords([p.longitude, p.latitude], navDest)) continue;
        const latLng: [number, number] = [p.latitude, p.longitude];
        const { el, detail } = buildParkBadgeEl(p);
        const marker = L.marker(latLng, { icon: pointIcon(el) }).addTo(map);
        const raise = makeRaise(el, marker);
        if (containerRef.current) wireHoverLabelFlip(el, containerRef.current);
        markersRef.current.push(marker);
        items.push({
          id: p.id,
          point: () => map.latLngToLayerPoint(latLng),
          detail,
          raise,
          onActivate: () => {
            if (roam) {
              setFocusSlug(p.slug);
              flyToPark(p.slug);
            } else {
              void navigate({ to: "/park/$slug", params: { slug: p.slug } });
            }
          },
          priority: p.operating,
        });
      }
    } else {
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
        // Actively navigating: show only the destination, hide every other ride.
        if (navDest && !sameCoords([a.longitude, a.latitude], navDest)) continue;
        const latLng: [number, number] = [a.latitude, a.longitude];
        const { el, detail } = buildAttractionEl(a, a.id === selectedIdRef.current);
        const waitLabel = waitLabelFor(a);
        const rideHref = `/park/${effectiveSlug}/ride/${a.slug}`;
        const marker = L.marker(latLng, { icon: pointIcon(el) }).addTo(map);
        const raise = makeRaise(el, marker);
        if (containerRef.current) wireHoverLabelFlip(el, containerRef.current);
        markersRef.current.push(marker);
        markerElsRef.current.set(a.id, detail);
        items.push({
          id: a.id,
          point: () => map.latLngToLayerPoint(latLng),
          detail,
          raise,
          onActivate: () => {
            const wasSelected = a.id === selectedIdRef.current;
            onSelectRef.current?.({ id: a.id, name: a.name });
            // Warm the ride page's data as its card opens, so "More info"
            // navigates instantly instead of blocking on the route loader.
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
              bodyHtml: attractionCardBodyHtml(a, waitLabel, rideHref),
              wasSelected,
              onClose: () => raise(false),
            });
            cardRef.current = { close };
            card.querySelector<HTMLAnchorElement>("[data-spa]")?.addEventListener("click", (e) => {
              e.preventDefault();
              void navigate({
                to: "/park/$slug/ride/$rideSlug",
                params: { slug: effectiveSlug, rideSlug: a.slug },
              });
            });
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

      // Optional POI overlay layers (dining / shops / guest-services /
      // entertainment / tours), folded into the SAME cluster as the rides so
      // they group + collision-avoid together. Clipped to the focused park's
      // boundary (the resort-wide feed scoped to this park); no boundary → plot
      // nothing. Negative ids keep them clear of the attraction/park id space.
      const boundary = parks?.find((p) => p.slug === effectiveSlug)?.boundary ?? null;
      if (boundary && layers && anyMapLayerActive(layers)) {
        // The park_poi feed carries all three overlay categories; pick the ones
        // whose layer is lit (Live folds entertainment + character meets).
        const overlayPoi = (poiQ.data ?? []).filter(
          (p) =>
            (layers.services && p.category === "info") ||
            (layers.entertainment &&
              (p.category === "entertainment" || p.category === "character")) ||
            (layers.tours && p.category === "tour"),
        );
        const pois = [
          ...(layers.dining ? (diningQ.data ?? []) : []),
          ...(layers.shops ? (shopsQ.data ?? []) : []),
          ...overlayPoi,
        ];
        pois.forEach((poi, i) => {
          if (poi.latitude == null || poi.longitude == null) return;
          const lngLat: [number, number] = [poi.longitude, poi.latitude];
          if (!pointInPolygon(lngLat, boundary)) return;
          // Actively navigating: show only the destination, hide every other POI.
          if (navDest && !sameCoords(lngLat, navDest)) return;
          const latLng: [number, number] = [poi.latitude, poi.longitude];
          const { el, detail } = buildPoiEl(poi);
          const marker = L.marker(latLng, { icon: pointIcon(el) }).addTo(map);
          const raise = makeRaise(el, marker);
          if (containerRef.current) wireHoverLabelFlip(el, containerRef.current);
          markersRef.current.push(marker);
          items.push({
            id: -(i + 1),
            point: () => map.latLngToLayerPoint(latLng),
            detail,
            raise,
            onActivate: () => {
              cardRef.current?.close();
              if (!containerRef.current) return;
              raise(true);
              const { card, close } = openAttractionCard({
                detail,
                container: containerRef.current,
                bodyHtml: poiCardBodyHtml(poi),
                wasSelected: false,
                onClose: () => raise(false),
              });
              cardRef.current = { close };
              // Internal shop/dining links carry data-spa; overlay POIs link out
              // to the operator (a plain target=_blank anchor the browser handles).
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
            // POIs never anchor a cluster over a ride; they fold under its dot.
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
    map.on("move zoom", scheduleRefresh);
    map.on("moveend zoomend", flushRefresh);
    map.on("click", onMapClick);
    return () => {
      map.off("move zoom", scheduleRefresh);
      map.off("moveend zoomend", flushRefresh);
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

  // Dev-destination pins — the nav QA tools' test spots, drawn as temporary
  // markers only while actively navigating so a dev target (not a real
  // attraction) is visible; the one we're routing to is highlighted + labeled.
  // Cleared the moment navigation ends. No-op for normal users (empty list).
  React.useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    for (const m of devMarkersRef.current) m.remove();
    devMarkersRef.current = [];
    if (!navDest || devDestinations.length === 0) return;
    for (const spot of devDestinations) {
      const el = buildDevSpotEl(spot.label, sameCoords(spot.coords, navDest));
      const marker = L.marker([spot.coords[1], spot.coords[0]], {
        icon: pointIcon(el),
        interactive: false,
        zIndexOffset: 400,
      }).addTo(map);
      devMarkersRef.current.push(marker);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navDestKey, devDestinations, ready]);

  // Free-roam focus watcher: reveal a park's rides once zoomed in over it; fall
  // back to park badges when zoomed out (mirrors the GL renderer).
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

  // Roam auto-focus: the first fix inside a park flies in and reveals its rides.
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
    scheduleRefresh();
  }, [selectedId, board, ready, scheduleRefresh]);

  // "You are here" marker — created on the first fix, moved on later updates,
  // removed when location turns off. Non-interactive so it never eats a click.
  React.useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    if (!userLocation) {
      userMarkerRef.current?.remove();
      userMarkerRef.current = null;
      return;
    }
    const latLng: [number, number] = [userLocation.coords[1], userLocation.coords[0]];
    if (!userMarkerRef.current) {
      userMarkerRef.current = L.marker(latLng, {
        icon: pointIcon(buildUserLocationEl()),
        interactive: false,
        zIndexOffset: 500,
      });
    }
    userMarkerRef.current.setLatLng(latLng).addTo(map);
    // Point the facing cone along the heading — the live device compass when we
    // have it (works standing still), else GPS course-over-ground. Leaflet
    // doesn't rotate, so there's no map bearing to subtract — screen degrees ==
    // heading.
    const el = userMarkerRef.current.getElement();
    if (el) setUserHeading(el, deviceHeadingRef.current ?? userLocation.heading);

    // Follow-cam: recenter on the user as their fix updates (no rotation). A
    // manual pan clears `follow` upstream; panTo fires `movestart`, not
    // `dragstart`, so it won't trip the user-interaction guard. Read via ref so
    // toggling follow doesn't re-run this and interrupt the engage-time fly.
    if (followRef.current && !engagingRef.current) {
      map.panTo(latLng, { animate: true, duration: 0.5 });
    }
  }, [userLocation, ready]);

  // Re-point the facing cone on each new compass reading — cheap DOM write, no
  // marker rebuild — so it tracks a turn-in-place even without a new GPS fix.
  React.useEffect(() => {
    const el = userMarkerRef.current?.getElement();
    if (el) setUserHeading(el, deviceHeading ?? userLocation?.heading ?? null);
  }, [deviceHeading, userLocation]);

  // Draw / update / clear the active walking route (+ grayed traveled trail), and
  // frame it when it appears.
  React.useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    routeRef.current?.remove();
    routeRef.current = null;
    traveledRef.current?.remove();
    traveledRef.current = null;
    // Where you've been — a trail of static gray dots (zero-length round-capped
    // dashes), drawn first so the live route sits on top of it. Same dotted
    // language as the route, but gray and not marching, so "walked" reads as the
    // route with the motion drained out of it.
    if (traveled && traveled.length > 1) {
      traveledRef.current = L.polyline(
        traveled.map(([lng, lat]) => [lat, lng] as [number, number]),
        {
          color: "#94a3b8",
          weight: 7,
          opacity: 0.85,
          dashArray: "0.1 14",
          lineCap: "round",
          interactive: false,
        },
      ).addTo(map);
    }
    if (!route || route.length < 2) return;
    const latLngs = route.map(([lng, lat]) => [lat, lng] as [number, number]);
    routeRef.current = L.polyline(latLngs, {
      color: "#2563eb",
      weight: 6,
      opacity: 0.9,
      // Short round-capped dashes; the CSS class marches them toward the
      // destination via an animated stroke-dashoffset while navigating.
      dashArray: "1 10",
      lineCap: "round",
      className: animateRoute ? "route-antpath" : undefined,
      interactive: false,
    }).addTo(map);
    // Frame the whole route in preview only — while following, a mid-trip
    // re-route redraws the line without yanking the camera off the user.
    if (followRef.current) return;
    // Reserve space for the nav overlays (green turn sign + bottom ETA bar,
    // tagged `data-map-chrome`) so the route's endpoints land in the visible
    // band instead of under the UI.
    const pad = chromePadding(containerRef.current);
    map.flyToBounds(L.latLngBounds(latLngs), {
      paddingTopLeft: L.point(pad.left, pad.top),
      paddingBottomRight: L.point(pad.right, pad.bottom),
      maxZoom: 17,
      duration: FLY_SECONDS,
    });
  }, [route, traveled, animateRoute, ready]);

  // Draw the park outline(s): all parks on the overview, just the active park in
  // a park view. Lives in the overlayPane (above tiles, below markers) and is
  // non-interactive so clicks fall through to the map/markers.
  React.useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    boundaryRef.current?.remove();
    boundaryRef.current = null;
    const shapes = effectiveSlug
      ? (parks ?? []).filter((p) => p.slug === effectiveSlug)
      : (overview?.parks ?? []);
    const fc = boundaryFeatureCollection(shapes);
    if (fc.features.length === 0) return;
    const layer = L.geoJSON(fc, {
      interactive: false,
      style: (f) => ({
        color: f?.properties?.color ?? "#475569",
        weight: 2,
        opacity: 0.9,
        fillColor: f?.properties?.color ?? "#475569",
        fillOpacity: 0.07,
      }),
    }).addTo(map);
    boundaryRef.current = layer;
    return () => {
      layer.remove();
    };
  }, [effectiveSlug, parks, overview, ready]);

  // Camera: fit both resorts on the overview, fly into the active park. Stashed
  // in a ref so the delayed scheduler reads fresh data without re-firing on
  // every query refetch.
  const runFly = () => {
    const map = mapRef.current;
    if (!map || !attached) return;
    // Leaflet removes the cap when handed invalid/empty bounds.
    const clearMaxBounds = () => map.setMaxBounds(null as unknown as L.LatLngBoundsExpression);

    if (roam) {
      // Free-roam: frame all parks but allow full zoom-in (rides reveal by zoom).
      map.setMaxZoom(18);
      clearMaxBounds();
      // Returning to the map: restore the exact camera the user left (so a round
      // trip through a ride page doesn't snap back to the all-parks overview).
      const saved = getRoamCamera();
      if (saved) {
        map.setView([saved.center[1], saved.center[0]], saved.zoom, { animate: false });
        return;
      }
      const coords = (overview?.parks ?? [])
        .filter((p) => p.latitude != null && p.longitude != null)
        .map((p) => [p.latitude!, p.longitude!] as [number, number]);
      if (coords.length === 0) {
        map.flyTo([ORLANDO_CENTER[1], ORLANDO_CENTER[0]], ORLANDO_ZOOM, { duration: FLY_SECONDS });
        return;
      }
      map.flyToBounds(L.latLngBounds(coords), {
        padding: [80, 80],
        maxZoom: 12,
        duration: FLY_SECONDS,
      });
      return;
    }

    if (!activeSlug) {
      // Overview is a regional picture — cap zoom-in so it can't dive to street level.
      map.setMaxZoom(13);
      clearMaxBounds();
      const coords = (overview?.parks ?? [])
        .filter((p) => p.latitude != null && p.longitude != null)
        .map((p) => [p.latitude!, p.longitude!] as [number, number]);
      if (coords.length === 0) {
        map.flyTo([ORLANDO_CENTER[1], ORLANDO_CENTER[0]], ORLANDO_ZOOM, { duration: FLY_SECONDS });
        return;
      }
      const b = L.latLngBounds(coords);
      map.flyToBounds(b, { padding: [80, 80], maxZoom: 12, duration: FLY_SECONDS });
      map.once("moveend", () => map.setMaxBounds(b.pad(0.6)));
      return;
    }

    const park = parks?.find((p) => p.slug === activeSlug);
    if (!park) return;
    // Park views need close zoom; lift the overview's cap.
    map.setMaxZoom(21);
    if (park.bounds) {
      const bd = park.bounds;
      const b = L.latLngBounds([
        [bd.latMin, bd.lngMin],
        [bd.latMax, bd.lngMax],
      ]);
      clearMaxBounds();
      const pad = chromePadding(containerRef.current);
      map.flyToBounds(b, {
        paddingTopLeft: L.point(pad.left, pad.top),
        paddingBottomRight: L.point(pad.right, pad.bottom),
        maxZoom: 17,
        duration: FLY_SECONDS,
      });
      map.once("moveend", () => map.setMaxBounds(b.pad(0.6)));
    } else if (park.latitude != null && park.longitude != null) {
      clearMaxBounds();
      map.flyTo([park.latitude, park.longitude], park.mapZoom ?? 15, { duration: FLY_SECONDS });
    }
  };
  const runFlyRef = React.useRef(runFly);
  runFlyRef.current = runFly;

  // Schedule the fly after the box morph settles (layout first, then zoom). Keyed
  // on the navigation target and data *presence* — not the data objects — so a
  // background refetch can't queue a second, competing fly.
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
