"use client";

import * as React from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import * as L from "leaflet";
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

import "leaflet/dist/leaflet.css";
import "./park-map-leaflet.css";

const FLY_SECONDS = MAP_FLY_MS / 1000;

/**
 * Keyless raster basemap, per the app theme — the same OSM Standard (light) /
 * Carto dark (dark) tiles the MapLibre renderer uses, so the two engines look
 * identical. Leaflet pulls them straight as `<img>` tiles (no WebGL).
 */
function makeTileLayer(dark: boolean): L.TileLayer {
  return dark
    ? L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png", {
        subdomains: "abcd",
        maxZoom: 20,
        attribution:
          '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors © <a href="https://carto.com/attributions">CARTO</a>',
      })
    : L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        subdomains: "abc",
        maxZoom: 19,
        attribution:
          '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      });
}

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
  onMapRef,
  attached = true,
}: {
  activeSlug: string | null;
  selectedId?: number | null;
  onSelectAttraction?: (item: { id: number; name: string }) => void;
  onMapRef?: (map: MapHandle | null) => void;
  /** True only while the map is lent to a visible slot. Camera flies are gated
   *  on it — flying into a 0×0 parked container yields NaN LatLngs and throws. */
  attached?: boolean;
}) {
  const trpc = useTRPC();
  const navigate = useNavigate();
  const { resolvedTheme } = useTheme();
  const dark = resolvedTheme === "dark";

  const [mounted, setMounted] = React.useState(false);
  const [ready, setReady] = React.useState(false);
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const mapRef = React.useRef<L.Map | null>(null);
  const tileRef = React.useRef<L.TileLayer | null>(null);
  const markersRef = React.useRef<Array<L.Marker>>([]);
  const markerElsRef = React.useRef<Map<number, HTMLElement>>(new Map());
  const declutterItemsRef = React.useRef<
    Array<{
      id: number;
      latLng: [number, number];
      detail: HTMLElement;
      dot: HTMLElement;
      priority: number;
    }>
  >([]);
  const declutterRafRef = React.useRef(0);
  const popupRef = React.useRef<L.Popup | null>(null);
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
    });
    L.control.zoom({ position: "topright" }).addTo(map);
    tileRef.current = makeTileLayer(dark).addTo(map);
    map.whenReady(() => setReady(true));
    mapRef.current = map;
    onMapRef?.({
      resize: () => {
        const c = containerRef.current;
        if (c && c.clientWidth > 0 && c.clientHeight > 0) {
          map.invalidateSize({ animate: false });
        }
      },
    });
    return () => {
      map.remove();
      mapRef.current = null;
      tileRef.current = null;
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
    for (const m of markersRef.current) m.remove();
    markersRef.current = [];
    markerElsRef.current.clear();
    declutterItemsRef.current = [];
  }, []);

  // Collision pass — identical strategy to the MapLibre renderer, projecting via
  // Leaflet's container-point transform.
  const declutter = React.useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    const sel = selectedIdRef.current;
    const items = [...declutterItemsRef.current].sort(
      (a, b) => (b.id === sel ? Infinity : b.priority) - (a.id === sel ? Infinity : a.priority),
    );
    const placed: Array<{ x: number; y: number }> = [];
    for (const it of items) {
      const p = map.latLngToContainerPoint(it.latLng);
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
        const marker = L.marker([p.latitude, p.longitude], { icon: pointIcon(el) }).addTo(map);
        markersRef.current.push(marker);
      }
      return;
    }

    for (const a of board ?? []) {
      if (a.latitude == null || a.longitude == null) continue;
      if (a.entityType !== "ATTRACTION") continue;
      const latLng: [number, number] = [a.latitude, a.longitude];
      const { el, detail, dot } = buildAttractionEl(a, a.id === selectedIdRef.current);
      const waitLabel = waitLabelFor(a);
      const marker = L.marker(latLng, { icon: pointIcon(el) }).addTo(map);
      marker.on("click", () => {
        onSelectRef.current?.({ id: a.id, name: a.name });
        popupRef.current?.remove();
        popupRef.current = L.popup({
          offset: [0, -16],
          closeButton: false,
          className: "parkfi-popup",
        })
          .setLatLng(latLng)
          .setContent(attractionPopupHtml(a, waitLabel));
        popupRef.current.openOn(map);
        map.panTo(latLng, { animate: true, duration: 0.5 });
      });

      markerElsRef.current.set(a.id, detail);
      declutterItemsRef.current.push({
        id: a.id,
        latLng,
        detail,
        dot,
        priority: attractionPriority(a),
      });
      markersRef.current.push(marker);
    }

    // Initial placement, then keep it current as the user pans/zooms.
    scheduleDeclutter();
    map.on("move zoom", scheduleDeclutter);
    return () => {
      map.off("move zoom", scheduleDeclutter);
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
    scheduleDeclutter();
  }, [selectedId, board, ready, scheduleDeclutter]);

  // Camera: fit both resorts on the overview, fly into the active park. Stashed
  // in a ref so the delayed scheduler reads fresh data without re-firing on
  // every query refetch.
  const runFly = () => {
    const map = mapRef.current;
    if (!map || !attached) return;
    // Leaflet removes the cap when handed invalid/empty bounds.
    const clearMaxBounds = () => map.setMaxBounds(null as unknown as L.LatLngBoundsExpression);

    if (!activeSlug) {
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
    if (park.bounds) {
      const bd = park.bounds;
      const b = L.latLngBounds([
        [bd.latMin, bd.lngMin],
        [bd.latMax, bd.lngMax],
      ]);
      clearMaxBounds();
      map.flyToBounds(b, { padding: [60, 60], maxZoom: 17, duration: FLY_SECONDS });
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
  }, [activeSlug, ready, hasOverview, hasParks, attached]);

  if (!mounted) {
    return <div className="size-full bg-muted" aria-hidden />;
  }
  return <div ref={containerRef} className="size-full" />;
}
