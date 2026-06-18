"use client";

import * as React from "react";
import { useTheme } from "next-themes";

import "leaflet/dist/leaflet.css";

import { cn } from "#/lib/utils.ts";

import type { Map as LeafletMap } from "leaflet";

// A teardrop pin rendered as a Leaflet `divIcon` — avoids Leaflet's default PNG
// marker assets (which break under bundlers) and inherits a fixed brand blue.
const PIN_HTML = `<svg viewBox="0 0 24 24" width="30" height="30" fill="#2563eb" stroke="white" stroke-width="1.25" style="filter:drop-shadow(0 1px 2px rgba(0,0,0,.35))"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z"/><circle cx="12" cy="9" r="2.5" fill="white" stroke="none"/></svg>`;

/**
 * A static location map: a single pin on a CARTO basemap with the zoom locked
 * and every interaction/control disabled. Leaflet is loaded client-side only
 * (dynamic import inside the effect) so SSR never touches `window`; the CARTO
 * light/dark tiles track the active theme.
 */
export function LocationMap({
  latitude,
  longitude,
  label,
  zoom = 15,
  className,
  caption,
}: {
  latitude: number;
  longitude: number;
  label?: string;
  zoom?: number;
  className?: string;
  /** Small attribution / context line under the map. */
  caption?: string;
}) {
  const ref = React.useRef<HTMLDivElement>(null);
  const { resolvedTheme } = useTheme();
  const dark = resolvedTheme === "dark";

  React.useEffect(() => {
    if (!ref.current) return;
    let map: LeafletMap | undefined;
    let cancelled = false;
    void (async () => {
      const L = (await import("leaflet")).default;
      if (cancelled || !ref.current) return;
      map = L.map(ref.current, {
        center: [latitude, longitude],
        zoom,
        zoomControl: false,
        attributionControl: false,
        dragging: false,
        scrollWheelZoom: false,
        doubleClickZoom: false,
        boxZoom: false,
        keyboard: false,
        touchZoom: false,
      });
      const tiles = dark
        ? "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
        : "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png";
      L.tileLayer(tiles, { maxZoom: 19 }).addTo(map);
      L.marker([latitude, longitude], {
        icon: L.divIcon({
          html: PIN_HTML,
          className: "",
          iconSize: [30, 30],
          iconAnchor: [15, 30],
        }),
        keyboard: false,
        interactive: false,
      }).addTo(map);
    })();
    return () => {
      cancelled = true;
      map?.remove();
    };
  }, [latitude, longitude, zoom, dark]);

  return (
    <div className="flex flex-col gap-1.5">
      {/* `isolate` confines Leaflet's internal high z-index panes to their own
          stacking context, so the map never paints over popovers/menus above it. */}
      <div
        ref={ref}
        role="img"
        aria-label={label ? `Map showing ${label}` : "Location map"}
        className={cn("isolate", className)}
      />
      <p className="text-[10px] text-muted-foreground">
        {caption ? `${caption} · ` : ""}© OpenStreetMap, © CARTO
      </p>
    </div>
  );
}
