"use client";

import * as React from "react";
import { useTheme } from "next-themes";

import "leaflet/dist/leaflet.css";

import { cn } from "#/lib/utils.ts";

import type { Map as LeafletMap } from "leaflet";

// A teardrop pin rendered as a Leaflet `divIcon` — avoids Leaflet's default PNG
// marker assets (which break under bundlers) and inherits a fixed brand blue.
const PIN_HTML = `<svg viewBox="0 0 24 24" width="30" height="30" fill="#2563eb" stroke="white" stroke-width="1.25" style="filter:drop-shadow(0 1px 2px rgba(0,0,0,.35))"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z"/><circle cx="12" cy="9" r="2.5" fill="white" stroke="none"/></svg>`;

/** Secondary context pin: a labelled dot for nearby landmarks (parks etc.). */
function contextPinHtml(label: string, dark: boolean): string {
  // A white-or-slate pill keeps the label legible on both the light and dark
  // CARTO basemaps (a single themed text colour would wash out on one of them).
  const pill = dark
    ? "background:rgba(15,23,42,.82);color:#f1f5f9"
    : "background:rgba(255,255,255,.9);color:#0f172a";
  return `<div style="display:flex;align-items:center;gap:4px;white-space:nowrap;transform:translateX(-5px)"><span style="width:10px;height:10px;border-radius:50%;background:#0d9488;border:1.5px solid white;box-shadow:0 1px 2px rgba(0,0,0,.35);flex:none"></span><span style="${pill};font:600 10px/1.4 system-ui,sans-serif;padding:1px 5px;border-radius:5px;box-shadow:0 1px 2px rgba(0,0,0,.18)">${label}</span></div>`;
}

export interface MapMarker {
  latitude: number;
  longitude: number;
  label: string;
}

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
  markers,
}: {
  latitude: number;
  longitude: number;
  label?: string;
  zoom?: number;
  className?: string;
  /** Small attribution / context line under the map. */
  caption?: string;
  /**
   * Secondary context pins (e.g. nearby parks). When present, the view frames
   * the primary pin together with every marker instead of using `zoom`, so the
   * map shows the surroundings rather than an empty close-up.
   */
  markers?: ReadonlyArray<MapMarker>;
}) {
  const ref = React.useRef<HTMLDivElement>(null);
  const { resolvedTheme } = useTheme();
  const dark = resolvedTheme === "dark";

  // Serialised marker set, so the effect re-runs when the pins actually change
  // (the array prop's identity churns every render).
  const markersKey = markers?.map((m) => `${m.latitude},${m.longitude},${m.label}`).join("|");

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

      // Secondary context pins beneath the primary one.
      for (const m of markers ?? []) {
        L.marker([m.latitude, m.longitude], {
          icon: L.divIcon({
            html: contextPinHtml(m.label, dark),
            className: "",
            iconSize: [10, 10],
            iconAnchor: [5, 5],
          }),
          keyboard: false,
          interactive: false,
        }).addTo(map);
      }

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

      // With context pins, frame the primary point and every marker (capped so a
      // tight cluster doesn't zoom to street level); otherwise hold the fixed zoom.
      if (markers && markers.length > 0) {
        const bounds = L.latLngBounds([
          [latitude, longitude],
          ...markers.map((m) => [m.latitude, m.longitude] as [number, number]),
        ]);
        map.fitBounds(bounds, { padding: [30, 30], maxZoom: 14 });
      }
    })();
    return () => {
      cancelled = true;
      map?.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [latitude, longitude, zoom, dark, markersKey]);

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
