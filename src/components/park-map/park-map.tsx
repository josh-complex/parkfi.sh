"use client";

import * as React from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import maplibregl from "maplibre-gl";
import { useTheme } from "next-themes";

import { useTRPC } from "#/integrations/trpc/react.ts";

import { MarkerCluster, type DeclutterItem } from "./declutter.ts";
import {
  applySelected,
  attractionPopupHtml,
  attractionPriority,
  boundaryFeatureCollection,
  buildAttractionEl,
  buildParkBadgeEl,
  DECLUTTER_SIZE,
  type MapHandle,
  MAP_FLY_MS,
  MORPH_MS,
  ORLANDO_CENTER,
  ORLANDO_ZOOM,
  waitLabelFor,
  wireHoverLabelFlip,
} from "./shared.tsx";

import "maplibre-gl/dist/maplibre-gl.css";

/**
 * Keyless raster basemap, per the app theme:
 *  - **light** → OpenStreetMap "Standard" — the colorful, detailed style with
 *    in-park footpaths and POI icons (what makes Disney/Universal look so rich).
 *  - **dark** → Carto dark, since OSM Standard has no dark variant.
 */
function basemapStyle(dark: boolean): maplibregl.StyleSpecification {
  const source: maplibregl.RasterSourceSpecification = dark
    ? {
        type: "raster",
        tiles: ["a", "b", "c", "d"].map(
          (s) => `https://${s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png`,
        ),
        tileSize: 256,
        attribution:
          '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors © <a href="https://carto.com/attributions">CARTO</a>',
      }
    : {
        type: "raster",
        tiles: ["a", "b", "c"].map((s) => `https://${s}.tile.openstreetmap.org/{z}/{x}/{y}.png`),
        tileSize: 256,
        maxzoom: 19,
        attribution:
          '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      };
  return {
    version: 8,
    sources: { base: source },
    layers: [{ id: "base", type: "raster", source: "base" }],
  };
}

/**
 * A marker's z-lift, reference-counted so hover and spiderfy don't clobber each
 * other (a marker stays raised while *either* is active). MapLibre markers are
 * positioned siblings with auto z-index, so an explicit z-index wins. Returns the
 * `raise(on)` to hand the cluster controller; also wires hover to the same lift.
 */
function makeRaise(el: HTMLElement): (on: boolean) => void {
  let count = 0;
  // Recompute the marker's resting z from its lift count (spiderfy uses this).
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

/** Transparent SVG overlay for spiderfy leader lines, stacked under the markers
 *  (which MapLibre appends to the canvas-container after this) but over the map. */
function makeOverlay(): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", "pointer-events-none absolute inset-0 text-foreground/40");
  svg.style.width = "100%";
  svg.style.height = "100%";
  svg.style.overflow = "visible";
  return svg;
}

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
  onMapRef,
  attached = true,
}: {
  activeSlug: string | null;
  /** Currently charted attraction — its marker is highlighted. */
  selectedId?: number | null;
  /** Clicking an attraction marker selects it (drives the wait chart). */
  onSelectAttraction?: (item: { id: number; name: string }) => void;
  /** Exposes a resize handle so the stage can re-fit the canvas mid-morph. */
  onMapRef?: (map: MapHandle | null) => void;
  /** True only while the map is lent to a visible slot. The camera fly is gated
   *  on it so the fit re-runs when returning from a route with no map. */
  attached?: boolean;
}) {
  const trpc = useTRPC();
  const navigate = useNavigate();
  const { resolvedTheme } = useTheme();
  const dark = resolvedTheme === "dark";

  const [mounted, setMounted] = React.useState(false);
  const [ready, setReady] = React.useState(false);
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const mapRef = React.useRef<maplibregl.Map | null>(null);
  const markersRef = React.useRef<Array<maplibregl.Marker>>([]);
  // Attraction marker detail-layer elements by id, so selection highlight can
  // update in place without rebuilding (rebuilding would close an open popup).
  const markerElsRef = React.useRef<Map<number, HTMLElement>>(new Map());
  // Cluster/spiderfy controller (shared with the Leaflet renderer) + its leader-
  // line overlay. The controller owns the collision pass, the "+N" cluster chips,
  // and the click-to-fan interaction; we just feed it items and re-run on move.
  const overlayRef = React.useRef<SVGSVGElement | null>(null);
  const layerRef = React.useRef<MarkerCluster | null>(null);
  const declutterRafRef = React.useRef(0);
  const popupRef = React.useRef<maplibregl.Popup | null>(null);
  // Park-outline FeatureCollection + a (re-)installer. The basemap is rebuilt on
  // theme swap (setStyle wipes custom sources/layers), so we re-add on styledata.
  const boundaryFCRef = React.useRef(boundaryFeatureCollection([]));
  // Latest select callback / selection, read inside the marker effect so it
  // doesn't rebuild every render or on each selection change.
  const onSelectRef = React.useRef(onSelectAttraction);
  onSelectRef.current = onSelectAttraction;
  const selectedIdRef = React.useRef(selectedId);
  selectedIdRef.current = selectedId;

  const listQ = useQuery(trpc.parks.list.queryOptions());
  const overviewQ = useQuery(trpc.parks.overview.queryOptions());
  const boardQ = useQuery({
    ...trpc.parks.board.queryOptions({ parkSlug: activeSlug ?? "" }),
    enabled: !!activeSlug,
  });

  const parks = listQ.data;
  const overview = overviewQ.data;
  const board = boardQ.data;

  // SSR guard: maplibre needs the DOM. Render a placeholder until mounted.
  React.useEffect(() => setMounted(true), []);

  // Init map once.
  React.useEffect(() => {
    if (!mounted || !containerRef.current || mapRef.current) return;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: basemapStyle(dark),
      center: ORLANDO_CENTER,
      zoom: ORLANDO_ZOOM,
      attributionControl: { compact: true },
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    // Leader-line overlay + cluster controller. The overlay lives in the
    // canvas-container alongside the markers (so its coords match map.project);
    // appended now (after the canvas, before any markers) so lines sit above the
    // map but behind the marker discs that get added later.
    const overlay = makeOverlay();
    map.getCanvasContainer().appendChild(overlay);
    overlayRef.current = overlay;
    layerRef.current = new MarkerCluster(
      overlay,
      DECLUTTER_SIZE,
      () => selectedIdRef.current ?? null,
      // Any marker click dismisses an open ride popup before it spiders/activates.
      () => {
        popupRef.current?.remove();
        popupRef.current = null;
      },
    );
    map.on("load", () => setReady(true));
    mapRef.current = map;
    onMapRef?.({ resize: () => map.resize() });
    return () => {
      map.remove();
      mapRef.current = null;
      layerRef.current = null;
      overlayRef.current = null;
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

  // Theme swap — DOM markers survive setStyle (they aren't style layers), so
  // swapping the basemap is all that's needed here.
  React.useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    map.setStyle(basemapStyle(dark));
    // setStyle wipes custom sources/layers — re-add the outlines once it reloads.
    ensureBoundaries();
  }, [dark, ready, ensureBoundaries]);

  // Recompute the park outline(s) and (re)install the layers: all parks on the
  // overview, just the active park in a park view.
  React.useEffect(() => {
    if (!ready) return;
    const shapes = activeSlug
      ? (parks ?? []).filter((p) => p.slug === activeSlug)
      : (overview?.parks ?? []);
    boundaryFCRef.current = boundaryFeatureCollection(shapes);
    ensureBoundaries();
  }, [activeSlug, parks, overview, ready, ensureBoundaries]);

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

  // Re-run the cluster/spiderfy pass (rAF-coalesced) — cheap, so it fires on every
  // frame of a pan/zoom, letting clusters split and re-form as markers spread.
  const scheduleRefresh = React.useCallback(() => {
    if (declutterRafRef.current) return;
    declutterRafRef.current = requestAnimationFrame(() => {
      declutterRafRef.current = 0;
      layerRef.current?.refresh();
    });
  }, []);

  // Rebuild markers: park badges on the overview, attraction pins when a park is
  // active. Each marker becomes a DeclutterItem the cluster controller drives.
  React.useEffect(() => {
    const map = mapRef.current;
    const layer = layerRef.current;
    if (!map || !layer || !ready) return;
    clearMarkers();
    // Overview spreads its handful of parks apart; a park view clusters its rides.
    layer.setMode(activeSlug ? "cluster" : "spread");
    const items: Array<DeclutterItem> = [];

    if (!activeSlug) {
      popupRef.current?.remove();
      popupRef.current = null;
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
          onActivate: () => void navigate({ to: "/park/$slug", params: { slug: p.slug } }),
          // Busier parks anchor their cluster; tie-break is stable input order.
          priority: p.operating,
        });
      }
    } else {
      for (const a of board ?? []) {
        if (a.latitude == null || a.longitude == null) continue;
        if (a.entityType !== "ATTRACTION") continue;
        const lngLat: [number, number] = [a.longitude, a.latitude];
        const { el, detail } = buildAttractionEl(a, a.id === selectedIdRef.current);
        const raise = makeRaise(el);
        if (containerRef.current) wireHoverLabelFlip(el, containerRef.current);
        const waitLabel = waitLabelFor(a);
        const rideHref = `/park/${activeSlug}/ride/${a.slug}`;
        const marker = new maplibregl.Marker({ element: el }).setLngLat(lngLat).addTo(map);
        markersRef.current.push(marker);
        markerElsRef.current.set(a.id, detail);
        items.push({
          id: a.id,
          point: () => map.project(lngLat),
          detail,
          raise,
          onActivate: () => {
            onSelectRef.current?.({ id: a.id, name: a.name });
            popupRef.current?.remove();
            const popup = new maplibregl.Popup({ offset: 16, closeButton: false, maxWidth: "none" })
              .setLngLat(lngLat)
              .setHTML(attractionPopupHtml(a, waitLabel, rideHref))
              .addTo(map);
            popupRef.current = popup;
            // Intercept the in-popup "More info" link for client-side navigation.
            popup
              .getElement()
              ?.querySelector<HTMLAnchorElement>("[data-spa]")
              ?.addEventListener("click", (e) => {
                e.preventDefault();
                void navigate({
                  to: "/park/$slug/ride/$rideSlug",
                  params: { slug: activeSlug, rideSlug: a.slug },
                });
              });
            // No recentre: MapLibre auto-anchors the popup to keep it on screen,
            // so easing toward the marker only fought maxBounds (snapping the view
            // back to the park when the marker sat near the edge).
          },
          priority: attractionPriority(a),
        });
      }
    }

    layer.setItems(items);
    layer.refresh();
    // Click on empty map collapses any open spider (marker clicks stopPropagation).
    const onMapClick = () => layer.unspiderfy();
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
  }, [activeSlug, overview, board, ready, navigate, clearMarkers, scheduleRefresh]);

  // Update selection highlight in place (no marker rebuild, so a popup stays open).
  React.useEffect(() => {
    for (const [id, el] of markerElsRef.current) applySelected(el, id === selectedId);
    // Re-cluster so the selected marker is promoted to its own anchor.
    scheduleRefresh();
  }, [selectedId, board, ready, scheduleRefresh]);

  // Camera: fit both resorts on the overview, fly into the active park. Built
  // as a closure recomputed each render and stashed in a ref so the delayed
  // scheduler below always reads fresh data without re-firing the fly on every
  // query refetch.
  const runFly = () => {
    const map = mapRef.current;
    if (!map || !attached) return;

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
  }, [activeSlug, ready, hasOverview, hasParks, attached]);

  if (!mounted) {
    return <div className="size-full bg-muted" aria-hidden />;
  }
  return <div ref={containerRef} className="size-full" />;
}
