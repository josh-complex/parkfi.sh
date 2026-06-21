"use client";

import * as React from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import * as L from "leaflet";
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
/**
 * A marker's z-lift, reference-counted so hover and spiderfy don't clobber each
 * other (a marker stays raised while *either* is active). Leaflet computes each
 * marker's z-index from its latitude; a large offset wins. Also wires hover to
 * the same lift; returns the `raise(on)` to hand the cluster controller.
 */
function makeRaise(el: HTMLElement, marker: L.Marker): (on: boolean) => void {
  let count = 0;
  // Recompute the marker's resting z-offset from its lift count (spiderfy uses this).
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

/** Transparent SVG overlay for spiderfy leader lines. It's prepended INTO the
 *  marker pane and drawn in layer-point coords (same space Leaflet positions
 *  markers in), so the lines sit behind the discs and stay aligned. */
function makeOverlay(): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", "pointer-events-none absolute top-0 left-0 text-foreground/40");
  svg.style.overflow = "visible";
  return svg;
}

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
  // Cluster/spiderfy controller (shared with the MapLibre renderer) + its leader-
  // line overlay; see park-map.tsx for the rationale.
  const overlayRef = React.useRef<SVGSVGElement | null>(null);
  const layerRef = React.useRef<MarkerCluster | null>(null);
  const declutterRafRef = React.useRef(0);
  const popupRef = React.useRef<L.Popup | null>(null);
  const boundaryRef = React.useRef<L.GeoJSON | null>(null);
  const onSelectRef = React.useRef(onSelectAttraction);
  onSelectRef.current = onSelectAttraction;
  const onDeselectRef = React.useRef(onDeselect);
  onDeselectRef.current = onDeselect;
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
      // Solid wall at maxBounds (no elastic rubber-band). A popup's autoPan can
      // still slide within the padded bounds to reveal itself, but the view no
      // longer springs back toward the park when it reaches the edge.
      maxBoundsViscosity: 1.0,
    });
    L.control.zoom({ position: "topright" }).addTo(map);
    tileRef.current = makeTileLayer(dark).addTo(map);
    // Leader-line overlay + cluster controller. The overlay is prepended into the
    // marker pane so its leader lines render behind the marker discs but over the
    // tiles; it's drawn in layer-point coords (the space markers are placed in).
    const overlay = makeOverlay();
    map.getPanes().markerPane.prepend(overlay);
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
      layerRef.current = null;
      overlayRef.current = null;
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

  // Re-run the cluster/spiderfy pass (rAF-coalesced) on every pan/zoom frame.
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
          onActivate: () => void navigate({ to: "/park/$slug", params: { slug: p.slug } }),
          priority: p.operating,
        });
      }
    } else {
      for (const a of board ?? []) {
        if (a.latitude == null || a.longitude == null) continue;
        if (a.entityType !== "ATTRACTION") continue;
        const latLng: [number, number] = [a.latitude, a.longitude];
        const { el, detail } = buildAttractionEl(a, a.id === selectedIdRef.current);
        const waitLabel = waitLabelFor(a);
        const rideHref = `/park/${activeSlug}/ride/${a.slug}`;
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
            onSelectRef.current?.({ id: a.id, name: a.name });
            popupRef.current?.remove();
            // autoPan slides the map once so the popup is fully on-screen.
            // (keepInView is intentionally off — it re-pans on every moveend and,
            // when the popup can't fully fit a small map, loops into a stack
            // overflow. autoPan alone positions it without the feedback loop.)
            const popup = L.popup({
              offset: [0, -16],
              closeButton: false,
              className: "parkfi-popup",
              autoPan: true,
              autoPanPadding: [16, 16],
            })
              .setLatLng(latLng)
              .setContent(attractionPopupHtml(a, waitLabel, rideHref));
            popupRef.current = popup;
            popup.openOn(map);
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
          },
          priority: attractionPriority(a),
        });
      }
    }

    layer.setItems(items);
    layer.refresh();
    // Click on empty map collapses any open spider and clears the selection
    // (marker clicks stopPropagation, so this only fires on the bare map).
    const onMapClick = () => {
      layer.unspiderfy();
      popupRef.current?.remove();
      onDeselectRef.current?.();
    };
    map.on("move zoom", scheduleRefresh);
    map.on("click", onMapClick);
    return () => {
      map.off("move zoom", scheduleRefresh);
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
    scheduleRefresh();
  }, [selectedId, board, ready, scheduleRefresh]);

  // Draw the park outline(s): all parks on the overview, just the active park in
  // a park view. Lives in the overlayPane (above tiles, below markers) and is
  // non-interactive so clicks fall through to the map/markers.
  React.useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    boundaryRef.current?.remove();
    boundaryRef.current = null;
    const shapes = activeSlug
      ? (parks ?? []).filter((p) => p.slug === activeSlug)
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
  }, [activeSlug, parks, overview, ready]);

  // Camera: fit both resorts on the overview, fly into the active park. Stashed
  // in a ref so the delayed scheduler reads fresh data without re-firing on
  // every query refetch.
  const runFly = () => {
    const map = mapRef.current;
    if (!map || !attached) return;
    // Leaflet removes the cap when handed invalid/empty bounds.
    const clearMaxBounds = () => map.setMaxBounds(null as unknown as L.LatLngBoundsExpression);

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
    map.setMaxZoom(19);
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
