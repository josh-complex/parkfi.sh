"use client";

import * as React from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import maplibregl from "maplibre-gl";
import { useTheme } from "next-themes";

import { rideMatchesFilter, type RideFilter } from "#/components/rides/ride-filter.tsx";
import { useTRPC } from "#/integrations/trpc/react.ts";
import { pointInPolygon } from "#/server/living/geofence.ts";

import { MarkerCluster, type DeclutterItem } from "./declutter.ts";
import {
  applySelected,
  attractionCardBodyHtml,
  attractionPriority,
  boundaryFeatureCollection,
  buildAttractionEl,
  buildParkBadgeEl,
  buildPoiEl,
  buildUserLocationEl,
  DECLUTTER_SIZE,
  getRoamCamera,
  type MapHandle,
  MAP_FLY_MS,
  MORPH_MS,
  openAttractionCard,
  ORLANDO_CENTER,
  ORLANDO_ZOOM,
  poiCardBodyHtml,
  saveRoamCamera,
  waitLabelFor,
  wireHoverLabelFlip,
} from "./shared.tsx";

import "maplibre-gl/dist/maplibre-gl.css";

import type { FeatureCollection, LineString } from "geojson";

// MapTiler API key (client-side, domain-restricted — safe to expose via VITE_).
const MAPTILER_KEY = import.meta.env.VITE_MAPTILER_KEY as string | undefined;

/**
 * Vector basemap, per the app theme. We use MapTiler's OpenMapTiles-schema GL
 * styles — vector, not raster, so their labels live in addressable `symbol`
 * layers we can selectively strip (see `stripLabels`) instead of being baked
 * into tile pixels:
 *  - **light** → OpenStreetMap — MapTiler's vector rendition of the classic,
 *    vivid OSM Standard look (in-park detail, bold labels).
 *  - **dark** → OpenStreetMap Dark — its dark sibling.
 */
function basemapStyleUrl(dark: boolean): string {
  const style = dark ? "openstreetmap-dark" : "openstreetmap";
  return `https://api.maptiler.com/maps/${style}/style.json?key=${MAPTILER_KEY}`;
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

// Zoom at/above which free-roam reveals a park's rides (and below which it falls
// back to park badges). Park-bounds fits land around 15–16, comfortably above.
const ROAM_RIDE_ZOOM = 14;

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
  route,
  onRequestDirections,
  roam = false,
  filter,
  onRoamFocusChange,
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
  /** The user's live position ([lng,lat] + accuracy), drawn as a "you are here"
   *  dot. Null when location is off/denied. */
  userLocation?: { coords: [number, number]; accuracy: number } | null;
  /** Active walking route geometry ([lng,lat] points) to draw, or null. */
  route?: Array<[number, number]> | null;
  /** A "Directions" tap in an attraction popup — asks the stage to route here. */
  onRequestDirections?: (d: { id: number; name: string; coords: [number, number] }) => void;
  /** Free-roam mode (the `/map` page): the map self-manages which park is in
   *  focus from the zoom level + viewport (no route navigation). Zooming into a
   *  park reveals its rides; zooming back out shows park badges again. */
  roam?: boolean;
  /** Shared ride filter — hides ride markers that don't match. */
  filter?: RideFilter;
  /** Roam only: reports which park's rides are currently revealed (or null), so
   *  the stage can offer a "view park details" shortcut. */
  onRoamFocusChange?: (slug: string | null) => void;
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
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const mapRef = React.useRef<maplibregl.Map | null>(null);
  const markersRef = React.useRef<Array<maplibregl.Marker>>([]);
  // Attraction marker detail-layer elements by id, so selection highlight can
  // update in place without rebuilding (rebuilding would close an open popup).
  const markerElsRef = React.useRef<Map<number, HTMLElement>>(new Map());
  // Cluster controller (shared with the Leaflet renderer). It owns the collision
  // pass, the "+N" cluster chips, and the click-to-zoom interaction; we just feed
  // it items and re-run on move.
  const layerRef = React.useRef<MarkerCluster | null>(null);
  const declutterRafRef = React.useRef(0);
  // The currently-expanded marker card (see openAttractionCard), so any new
  // interaction can collapse it first.
  const cardRef = React.useRef<{ close: () => void } | null>(null);
  const userMarkerRef = React.useRef<maplibregl.Marker | null>(null);
  const routeCoordsRef = React.useRef<Array<[number, number]> | null>(null);
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
  const selectedIdRef = React.useRef(selectedId);
  selectedIdRef.current = selectedId;

  const listQ = useQuery(trpc.parks.list.queryOptions());
  const overviewQ = useQuery(trpc.parks.overview.queryOptions());
  const boardQ = useQuery({
    ...trpc.parks.board.queryOptions({ parkSlug: effectiveSlug ?? "" }),
    enabled: !!effectiveSlug,
  });

  // Optional map overlay layers, driven by the shared filter. All three only
  // render once a park is focused (`effectiveSlug`): the POI markers are scoped
  // to the focused park's boundary and realms are per-park. The queries are
  // resort/park-wide (small, cached) and gated so they don't fetch until a layer
  // is switched on inside a park.
  const layers = filter?.layers;
  const diningQ = useQuery({
    ...trpc.parks.dining.queryOptions(),
    enabled: !!effectiveSlug && !!layers?.dining,
  });
  const shopsQ = useQuery({
    ...trpc.parks.shops.queryOptions(),
    enabled: !!effectiveSlug && !!layers?.shops,
  });

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
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: basemapStyleUrl(dark),
      center: ORLANDO_CENTER,
      zoom: ORLANDO_ZOOM,
      attributionControl: { compact: true },
    });
    // No native NavigationControl — our own 3D zoom buttons (in the stage) drive
    // zoom via the MapHandle below, so the map's controls match the app.
    layerRef.current = new MarkerCluster(
      DECLUTTER_SIZE,
      () => selectedIdRef.current ?? null,
      // Tap a cluster head -> fit the camera to its members so the group splits
      // apart on the way in (unproject the projected points back to lng/lat).
      (points) => {
        const b = new maplibregl.LngLatBounds();
        for (const p of points) b.extend(map.unproject([p.x, p.y]));
        map.fitBounds(b, { padding: 80, maxZoom: 18, duration: 500 });
      },
      // Any marker click collapses an open ride card before it zooms/activates.
      () => {
        cardRef.current?.close();
        cardRef.current = null;
      },
    );
    map.on("load", () => setReady(true));
    mapRef.current = map;
    onMapRef?.({
      resize: () => map.resize(),
      zoomIn: () => map.zoomIn(),
      zoomOut: () => map.zoomOut(),
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

  // Install/refresh the active route as a GeoJSON line layer. Like the
  // boundaries, it must re-install on `styledata` (a theme swap's setStyle wipes
  // custom sources/layers). An empty FeatureCollection clears the line in place.
  const ensureRoute = React.useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    if (!map.isStyleLoaded()) {
      map.once("styledata", ensureRoute);
      return;
    }
    const coords = routeCoordsRef.current;
    const fc: FeatureCollection<LineString> = {
      type: "FeatureCollection",
      features:
        coords && coords.length > 1
          ? [
              {
                type: "Feature",
                properties: {},
                geometry: { type: "LineString", coordinates: coords },
              },
            ]
          : [],
    };
    const src = map.getSource("route");
    if (src) {
      (src as maplibregl.GeoJSONSource).setData(fc);
      return;
    }
    map.addSource("route", { type: "geojson", data: fc });
    map.addLayer({
      id: "route-line",
      type: "line",
      source: "route",
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": "#2563eb", "line-width": 5, "line-opacity": 0.85 },
    });
  }, []);

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

  // Draw / update / clear the active walking route, and frame it when it appears.
  React.useEffect(() => {
    routeCoordsRef.current = route ?? null;
    if (!ready) return;
    ensureRoute();
    if (route && route.length > 1 && mapRef.current) {
      const b = new maplibregl.LngLatBounds();
      for (const c of route) b.extend(c);
      mapRef.current.fitBounds(b, { padding: 60, maxZoom: 17, duration: 500 });
    }
  }, [route, ready, ensureRoute]);

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

  // Re-run the cluster pass (rAF-coalesced) — cheap, so it fires on every
  // frame of a pan/zoom, letting clusters split and re-form as markers spread.
  const scheduleRefresh = React.useCallback(() => {
    if (declutterRafRef.current) return;
    declutterRafRef.current = requestAnimationFrame(() => {
      declutterRafRef.current = 0;
      layerRef.current?.refresh();
    });
  }, []);

  // Fly the camera to a park's bounds (used by free-roam park-badge taps). No
  // max-bounds cap here — roam keeps the whole region pannable.
  const flyToPark = React.useCallback((slug: string) => {
    const map = mapRef.current;
    const park = parksRef.current?.find((p) => p.slug === slug);
    if (!map || !park) return;
    map.setMaxZoom(19);
    map.setMaxBounds(null);
    if (park.bounds) {
      map.fitBounds(
        [
          [park.bounds.lngMin, park.bounds.latMin],
          [park.bounds.lngMax, park.bounds.latMax],
        ],
        { padding: 60, maxZoom: 17, duration: MAP_FLY_MS },
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
    // Overview spreads its handful of parks apart; a park view clusters its rides.
    layer.setMode(effectiveSlug ? "cluster" : "spread");
    const items: Array<DeclutterItem> = [];

    if (!effectiveSlug) {
      cardRef.current?.close();
      cardRef.current = null;
      for (const p of overview?.parks ?? []) {
        if (p.latitude == null || p.longitude == null) continue;
        const lngLat: [number, number] = [p.longitude, p.latitude];
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
          )
        )
          continue;
        const lngLat: [number, number] = [a.longitude, a.latitude];
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
              bodyHtml: attractionCardBodyHtml(a, waitLabel, rideHref),
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
        });
      }

      // Optional POI overlay layers (dining/shops), folded into the SAME cluster
      // as the rides so they group + collision-avoid together. Scoped to the
      // focused park's boundary (the resort-wide feed clipped to this park — the
      // same containment test roam uses); no boundary → plot nothing rather than
      // dumping every WDW venue here. Negative ids keep them clear of the
      // positive attraction/park id space the cluster + selection use.
      const boundary = parks?.find((p) => p.slug === effectiveSlug)?.boundary ?? null;
      if (boundary && (layers?.dining || layers?.shops)) {
        const pois = [
          ...(layers?.dining ? (diningQ.data ?? []) : []),
          ...(layers?.shops ? (shopsQ.data ?? []) : []),
        ];
        pois.forEach((poi, i) => {
          if (poi.latitude == null || poi.longitude == null) return;
          const lngLat: [number, number] = [poi.longitude, poi.latitude];
          if (!pointInPolygon(lngLat, boundary)) return;
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
            },
            // POIs never anchor a cluster over a ride — a nearby ride heads the
            // group, the POI folds under its "+N".
            priority: 0,
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
    map.on("click", onMapClick);
    return () => {
      map.off("move", scheduleRefresh);
      map.off("click", onMapClick);
      if (declutterRafRef.current) {
        cancelAnimationFrame(declutterRafRef.current);
        declutterRafRef.current = 0;
      }
    };
  }, [
    effectiveSlug,
    overview,
    board,
    parks,
    diningQ.data,
    shopsQ.data,
    ready,
    navigate,
    clearMarkers,
    scheduleRefresh,
    roam,
    filter,
    flyToPark,
    queryClient,
    trpc,
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
  // so the cluster pass never touches it.
  React.useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    if (!userLocation) {
      userMarkerRef.current?.remove();
      userMarkerRef.current = null;
      return;
    }
    if (!userMarkerRef.current) {
      userMarkerRef.current = new maplibregl.Marker({ element: buildUserLocationEl() });
    }
    userMarkerRef.current.setLngLat(userLocation.coords).addTo(map);
  }, [userLocation, ready]);

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
      map.fitBounds(b, { padding: 80, maxZoom: 12, duration: MAP_FLY_MS });
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
      map.fitBounds(b, { padding: 80, maxZoom: 12, duration: MAP_FLY_MS });
      void map.once("moveend", () => map.setMaxBounds(paddedBounds(b, 0.6)));
      return;
    }

    const park = parks?.find((p) => p.slug === activeSlug);
    if (!park) return;
    // Park views need close zoom; lift the overview's cap.
    map.setMaxZoom(19);
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
        { padding: 60, maxZoom: 17, duration: MAP_FLY_MS },
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
  return <div ref={containerRef} className="size-full" />;
}
