"use client";

import * as React from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import maplibregl from "maplibre-gl";
import { useTheme } from "next-themes";

import { useTRPC } from "#/integrations/trpc/react.ts";

import {
  attractionPopupHtml,
  attractionPriority,
  buildAttractionEl,
  buildParkBadgeEl,
  DECLUTTER_SIZE,
  type MapHandle,
  MAP_FLY_MS,
  MORPH_MS,
  ORLANDO_CENTER,
  ORLANDO_ZOOM,
  SELECTED_CLASSES,
  waitLabelFor,
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

/** Lift a marker above its neighbors while hovered, so its expanded hover panel
 *  isn't occluded by adjacent markers. MapLibre markers are positioned siblings
 *  with auto z-index, so an explicit z-index on the element wins. */
function raiseOnHover(el: HTMLElement): void {
  el.addEventListener("mouseenter", () => {
    el.style.zIndex = "1000";
  });
  el.addEventListener("mouseleave", () => {
    el.style.zIndex = "";
  });
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
  // Per-attraction declutter state: the two visual layers + projection input +
  // placement priority. Read by the collision pass on every pan/zoom.
  const declutterItemsRef = React.useRef<
    Array<{
      id: number;
      lngLat: [number, number];
      detail: HTMLElement;
      dot: HTMLElement;
      priority: number;
    }>
  >([]);
  const declutterRafRef = React.useRef(0);
  const popupRef = React.useRef<maplibregl.Popup | null>(null);
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
    map.on("load", () => setReady(true));
    mapRef.current = map;
    onMapRef?.({ resize: () => map.resize() });
    return () => {
      map.remove();
      mapRef.current = null;
      onMapRef?.(null);
      setReady(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mounted]);

  // Theme swap — DOM markers survive setStyle (they aren't style layers), so
  // swapping the basemap is all that's needed here.
  React.useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    map.setStyle(basemapStyle(dark));
  }, [dark, ready]);

  // Keep the canvas correct as the layout width animates.
  React.useEffect(() => {
    if (!mounted || !containerRef.current) return;
    const ro = new ResizeObserver(() => mapRef.current?.resize());
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, [mounted]);

  const clearMarkers = React.useCallback(() => {
    for (const m of markersRef.current) m.remove();
    markersRef.current = [];
    markerElsRef.current.clear();
    declutterItemsRef.current = [];
  }, []);

  // Collision pass: project every attraction marker to screen space and, walking
  // highest-priority first (selected, then busiest operating rides), keep a marker
  // expanded only if its reserved box clears every already-placed one — otherwise
  // collapse it to a dot. Re-runs cheaply on each frame of a pan/zoom (rAF-coalesced),
  // so detail reappears as the user zooms in and markers spread apart.
  const declutter = React.useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    const sel = selectedIdRef.current;
    const items = [...declutterItemsRef.current].sort(
      (a, b) => (b.id === sel ? Infinity : b.priority) - (a.id === sel ? Infinity : a.priority),
    );
    const placed: Array<{ x: number; y: number }> = [];
    for (const it of items) {
      const p = map.project(it.lngLat);
      const collides =
        it.id !== sel &&
        placed.some(
          (q) => Math.abs(p.x - q.x) < DECLUTTER_SIZE && Math.abs(p.y - q.y) < DECLUTTER_SIZE,
        );
      it.detail.classList.toggle("hidden", collides);
      it.dot.classList.toggle("hidden", !collides);
      if (!collides) placed.push(p);
    }
  }, []);

  const scheduleDeclutter = React.useCallback(() => {
    if (declutterRafRef.current) return;
    declutterRafRef.current = requestAnimationFrame(() => {
      declutterRafRef.current = 0;
      declutter();
    });
  }, [declutter]);

  // Rebuild markers: park badges on the overview, attraction pins when a park is
  // active.
  React.useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    clearMarkers();

    if (!activeSlug) {
      popupRef.current?.remove();
      popupRef.current = null;
      for (const p of overview?.parks ?? []) {
        if (p.latitude == null || p.longitude == null) continue;
        const el = buildParkBadgeEl(p, () => {
          void navigate({ to: "/park/$slug", params: { slug: p.slug } });
        });
        raiseOnHover(el);
        const marker = new maplibregl.Marker({ element: el })
          .setLngLat([p.longitude, p.latitude])
          .addTo(map);
        markersRef.current.push(marker);
      }
      return;
    }

    for (const a of board ?? []) {
      if (a.latitude == null || a.longitude == null) continue;
      if (a.entityType !== "ATTRACTION") continue;
      const lngLat: [number, number] = [a.longitude, a.latitude];
      const { el, detail, dot } = buildAttractionEl(a, a.id === selectedIdRef.current);
      raiseOnHover(el);
      const waitLabel = waitLabelFor(a);
      el.addEventListener("click", (e) => {
        e.stopPropagation();
        onSelectRef.current?.({ id: a.id, name: a.name });
        popupRef.current?.remove();
        popupRef.current = new maplibregl.Popup({ offset: 16, closeButton: false })
          .setLngLat(lngLat)
          .setHTML(attractionPopupHtml(a, waitLabel))
          .addTo(map);
        map.easeTo({ center: lngLat, duration: 500 });
      });

      markerElsRef.current.set(a.id, detail);
      declutterItemsRef.current.push({
        id: a.id,
        lngLat,
        detail,
        dot,
        priority: attractionPriority(a),
      });
      const marker = new maplibregl.Marker({ element: el }).setLngLat(lngLat).addTo(map);
      markersRef.current.push(marker);
    }

    // Initial placement, then keep it current as the user pans/zooms.
    scheduleDeclutter();
    map.on("move", scheduleDeclutter);
    return () => {
      map.off("move", scheduleDeclutter);
      if (declutterRafRef.current) {
        cancelAnimationFrame(declutterRafRef.current);
        declutterRafRef.current = 0;
      }
    };
  }, [activeSlug, overview, board, ready, navigate, clearMarkers, scheduleDeclutter]);

  // Update selection highlight in place (no marker rebuild, so a popup stays open).
  React.useEffect(() => {
    for (const [id, el] of markerElsRef.current) {
      const on = id === selectedId;
      for (const c of SELECTED_CLASSES) el.classList.toggle(c, on);
    }
    // Promote the selected marker out of any decluttered dot state.
    scheduleDeclutter();
  }, [selectedId, board, ready, scheduleDeclutter]);

  // Camera: fit both resorts on the overview, fly into the active park. Built
  // as a closure recomputed each render and stashed in a ref so the delayed
  // scheduler below always reads fresh data without re-firing the fly on every
  // query refetch.
  const runFly = () => {
    const map = mapRef.current;
    if (!map || !attached) return;

    if (!activeSlug) {
      // Overview/home: fit both resorts, then cap pan/zoom-out to that area.
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
