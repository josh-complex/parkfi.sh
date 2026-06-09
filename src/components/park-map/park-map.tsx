"use client";

import * as React from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import maplibregl from "maplibre-gl";
import { renderToStaticMarkup } from "react-dom/server";
import {
  CastleIcon,
  ClapperboardIcon,
  CompassIcon,
  DramaIcon,
  FerrisWheelIcon,
  FilmIcon,
  GlobeIcon,
  InfoIcon,
  RocketIcon,
  RollerCoasterIcon,
  ShoppingBagIcon,
  SmileIcon,
  TicketIcon,
  TreesIcon,
  UtensilsIcon,
  WavesIcon,
} from "lucide-react";
import { useTheme } from "next-themes";

import { useTRPC } from "#/integrations/trpc/react.ts";

import type { BoardItem } from "#/components/park-dashboard/types.ts";

import "maplibre-gl/dist/maplibre-gl.css";

/** Escape user-facing strings before injecting into marker/popup innerHTML. */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Build the attraction popup body. Disney rides carry rich `meta` (hero image,
 * tags, height/land, detail page); Universal (and un-enriched rows) degrade to
 * just the name + live wait line — no broken image. Maplibre's popup background
 * is always white, so fixed dark text (theme tokens would vanish in dark mode).
 */
function attractionPopupHtml(a: BoardItem, waitLabel: string): string {
  const meta = a.meta;
  const hero =
    (meta?.imageHeroUrl ?? meta?.imageThumbUrl)
      ? `<img src="${escapeHtml((meta?.imageHeroUrl ?? meta?.imageThumbUrl)!)}" alt="${escapeHtml(
          meta?.imageAlt ?? a.name,
        )}" class="mb-1.5 h-24 w-full rounded object-cover" loading="lazy" />`
      : "";
  const tags =
    meta?.tags && meta.tags.length > 0
      ? `<div class="mt-1 flex flex-wrap gap-1">${meta.tags
          .map(
            (t) =>
              `<span class="rounded bg-neutral-100 px-1.5 py-0.5 text-[10px] font-medium text-neutral-600">${escapeHtml(
                t,
              )}</span>`,
          )
          .join("")}</div>`
      : "";
  const detailBits = [meta?.heightRequirement, meta?.land].filter(Boolean) as Array<string>;
  const detail =
    detailBits.length > 0
      ? `<div class="mt-1 text-[11px] text-neutral-500">${detailBits
          .map(escapeHtml)
          .join(" · ")}</div>`
      : "";
  const moreInfo = meta?.detailUrl
    ? `<a href="${escapeHtml(
        meta.detailUrl,
      )}" target="_blank" rel="noreferrer" class="mt-1.5 inline-block text-[11px] font-medium text-blue-600 hover:underline">More info ↗</a>`
    : "";
  return `<div class="w-44 px-0.5">${hero}<div class="text-xs font-semibold text-neutral-900">${escapeHtml(
    a.name,
  )}</div><div class="text-[11px] text-neutral-500">${waitLabel}</div>${tags}${detail}${moreInfo}</div>`;
}

// Orlando theme-park area — fallback view before park coords load (covers WDW +
// Universal Orlando).
const ORLANDO_CENTER: [number, number] = [-81.51, 28.43];
const ORLANDO_ZOOM = 10.5;

// Camera fly duration.
const MAP_FLY_MS = 800;
// Must match MORPH_MS in map-stage.tsx (kept local to avoid a circular import).
// We wait this long after a navigation before flying so the shared-map box has
// finished morphing to its destination size — fitBounds reads the container's
// pixel dimensions, so flying before the box settles frames the view for the
// wrong size. Layout first, then zoom.
const MORPH_MS = 420;

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

const CATEGORY_ICON = {
  thrill: RollerCoasterIcon,
  attraction: FerrisWheelIcon,
  water: WavesIcon,
  show: DramaIcon,
  dine: UtensilsIcon,
  shop: ShoppingBagIcon,
  character: SmileIcon,
  info: InfoIcon,
} as const;

function categoryIconSvg(category: string | null, size = 14): string {
  const Icon = CATEGORY_ICON[(category ?? "info") as keyof typeof CATEGORY_ICON] ?? InfoIcon;
  return renderToStaticMarkup(<Icon width={size} height={size} strokeWidth={2.5} />);
}

// Per-park glyph for the overview map — a recognizable landmark icon (the castle,
// Spaceship Earth's globe, a clapperboard for the studios, …). Unknown slugs fall
// back to an operator-level icon, then a generic ticket.
const PARK_ICON: Record<string, typeof CastleIcon> = {
  "magic-kingdom": CastleIcon,
  epcot: GlobeIcon,
  "animal-kingdom": TreesIcon,
  "hollywood-studios": ClapperboardIcon,
  "universal-studios-florida": FilmIcon,
  "islands-of-adventure": CompassIcon,
  "epic-universe": RocketIcon,
};
const OPERATOR_ICON: Record<string, typeof CastleIcon> = {
  disney: CastleIcon,
  universal: RocketIcon,
};

function parkIconSvg(slug: string, operatorSlug: string | null, size = 15): string {
  const Icon = PARK_ICON[slug] ?? OPERATOR_ICON[operatorSlug ?? ""] ?? TicketIcon;
  return renderToStaticMarkup(<Icon width={size} height={size} strokeWidth={2.25} />);
}

/** Operator-brand accent for a park's icon disc — identity, not wait status. */
function operatorColor(operatorSlug: string | null): string {
  if (operatorSlug === "disney") return "#1d4ed8"; // blue
  if (operatorSlug === "universal") return "#7c3aed"; // violet
  return "#475569"; // slate fallback
}

// Square (px) reserved around a full attraction marker for collision avoidance.
// Two markers whose projected centers fall within this on both axes can't both
// stay expanded; the lower-priority one collapses to a dot.
const DECLUTTER_SIZE = 34;

// Classes layered onto the selected attraction marker. Applied to the inner
// element (not the marker root, whose transform maplibre owns for positioning).
const SELECTED_CLASSES = ["scale-125", "ring-2", "ring-primary", "ring-offset-1"];

/** Marker fill by wait/status — gray when not operating, green→red by wait. */
function waitColor(wait: number | null, status: string | null): string {
  if (status && status !== "OPERATING") return "#6b7280"; // muted gray
  if (wait == null) return "#3b82f6"; // operating, no wait posted — blue
  if (wait < 20) return "#16a34a";
  if (wait < 45) return "#ca8a04";
  if (wait < 75) return "#ea580c";
  return "#dc2626";
}

export function ParkMap({
  activeSlug,
  selectedId,
  onSelectAttraction,
  onMapRef,
}: {
  activeSlug: string | null;
  /** Currently charted attraction — its marker is highlighted. */
  selectedId?: number | null;
  /** Clicking an attraction marker selects it (drives the wait chart). */
  onSelectAttraction?: (item: { id: number; name: string }) => void;
  /** Exposes the live maplibre instance so a parent can resize it mid-animation. */
  onMapRef?: (map: maplibregl.Map | null) => void;
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
    onMapRef?.(map);
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
        const el = document.createElement("button");
        el.type = "button";
        el.title = p.name;
        el.className =
          "flex cursor-pointer items-center gap-1.5 rounded-full border border-border bg-card/95 py-1 pr-2.5 pl-1 shadow-md backdrop-blur transition-transform hover:scale-105";
        const wait = p.avgWait != null ? `${p.avgWait}m avg` : "—";
        el.innerHTML = `<span class="flex size-6 shrink-0 items-center justify-center rounded-full text-white shadow-inner" style="background:${operatorColor(
          p.operatorSlug,
        )}">${parkIconSvg(p.slug, p.operatorSlug)}</span><span class="flex flex-col items-start leading-none"><span class="text-[11px] font-semibold text-card-foreground">${escapeHtml(
          p.name,
        )}</span><span class="text-[10px] text-muted-foreground">${p.operating} open · ${wait}</span></span>`;
        el.addEventListener("click", () => {
          void navigate({ to: "/park/$slug", params: { slug: p.slug } });
        });
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
      const color = waitColor(a.standbyWait, a.status);
      const operating = a.status === "OPERATING";

      // Root button is positioned by maplibre (it owns the transform). It holds
      // two swappable layers — a full "detail" disc (ride icon + wait badge) and a
      // small "dot" — toggled by the declutter pass. Visual scale lives on the
      // children so hover/selection scaling never fights maplibre's positioning.
      const el = document.createElement("button");
      el.type = "button";
      el.title = a.name;
      el.className = "block cursor-pointer";

      const detail = document.createElement("div");
      detail.className =
        "relative flex size-7 items-center justify-center rounded-full border-2 border-white text-white shadow-md transition-transform hover:scale-110";
      detail.style.background = color;
      const waitBadge =
        operating && a.standbyWait != null
          ? `<span class="absolute -top-1.5 -right-1.5 min-w-[1rem] rounded-full border border-white bg-neutral-900 px-1 text-center text-[9px] leading-[14px] font-bold text-white shadow">${a.standbyWait}</span>`
          : "";
      detail.innerHTML = `${categoryIconSvg(a.category)}${waitBadge}`;
      if (a.id === selectedIdRef.current) detail.classList.add(...SELECTED_CLASSES);

      const dot = document.createElement("div");
      dot.className =
        "hidden size-2.5 rounded-full border border-white shadow transition-transform";
      dot.style.background = color;

      el.append(detail, dot);

      const waitLabel =
        operating && a.standbyWait != null
          ? `${a.standbyWait} min standby`
          : operating
            ? "Open · no wait posted"
            : a.status === "REFURBISHMENT"
              ? "In refurbishment"
              : a.status === "DOWN"
                ? "Temporarily down"
                : "Closed";
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
      // Busiest operating rides win a spot first; closed/no-wait rides yield.
      declutterItemsRef.current.push({
        id: a.id,
        lngLat,
        detail,
        dot,
        priority: operating ? 1000 + (a.standbyWait ?? 0) : 0,
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
    if (!map) return;

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
    if (!ready) return;
    const t = setTimeout(() => runFlyRef.current(), MORPH_MS);
    return () => clearTimeout(t);
  }, [activeSlug, ready, hasOverview, hasParks]);

  if (!mounted) {
    return <div className="size-full bg-muted" aria-hidden />;
  }
  return <div ref={containerRef} className="size-full" />;
}
