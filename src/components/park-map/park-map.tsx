"use client";

import * as React from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import maplibregl from "maplibre-gl";
import { renderToStaticMarkup } from "react-dom/server";
import {
  DramaIcon,
  FerrisWheelIcon,
  InfoIcon,
  RollerCoasterIcon,
  ShoppingBagIcon,
  SmileIcon,
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

function categoryIconSvg(category: string | null): string {
  const Icon = CATEGORY_ICON[(category ?? "info") as keyof typeof CATEGORY_ICON] ?? InfoIcon;
  return renderToStaticMarkup(<Icon width={12} height={12} strokeWidth={2.5} />);
}

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
  // Attraction marker elements by id, so selection highlight can update in place
  // without rebuilding (rebuilding would close an open popup).
  const markerElsRef = React.useRef<Map<number, HTMLElement>>(new Map());
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
  }, []);

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
        el.className =
          "flex cursor-pointer flex-col items-center gap-0.5 rounded-md border border-border bg-card/95 px-2 py-1 text-center shadow-md backdrop-blur transition-transform hover:scale-105";
        const wait = p.avgWait != null ? `${p.avgWait}m avg` : "—";
        el.innerHTML = `<span class="text-[11px] font-semibold leading-none text-card-foreground">${p.name}</span><span class="text-[10px] leading-none text-muted-foreground">${p.operating} open · ${wait}</span>`;
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

      // Wrapper is positioned by maplibre (it owns the root transform); the inner
      // button carries all the visuals so its hover/selected scale doesn't fight
      // that positioning transform.
      const wrapper = document.createElement("div");
      const el = document.createElement("button");
      el.type = "button";
      el.title = a.name;
      el.className =
        "flex size-7 cursor-pointer items-center justify-center rounded-full border-2 border-white text-[10px] font-bold leading-none text-white shadow-md transition-transform hover:scale-110";
      el.style.background = color;
      el.innerHTML =
        operating && a.standbyWait != null
          ? `<span>${a.standbyWait}</span>`
          : categoryIconSvg(a.category);
      if (a.id === selectedIdRef.current) el.classList.add(...SELECTED_CLASSES);

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

      wrapper.appendChild(el);
      markerElsRef.current.set(a.id, el);
      const marker = new maplibregl.Marker({ element: wrapper }).setLngLat(lngLat).addTo(map);
      markersRef.current.push(marker);
    }
  }, [activeSlug, overview, board, ready, navigate, clearMarkers]);

  // Update selection highlight in place (no marker rebuild, so a popup stays open).
  React.useEffect(() => {
    for (const [id, el] of markerElsRef.current) {
      const on = id === selectedId;
      for (const c of SELECTED_CLASSES) el.classList.toggle(c, on);
    }
  }, [selectedId, board, ready]);

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
