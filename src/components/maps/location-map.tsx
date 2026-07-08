"use client";

import * as React from "react";
import { useTheme } from "next-themes";

import "maplibre-gl/dist/maplibre-gl.css";
import "leaflet/dist/leaflet.css";

import {
  MAPTILER_ATTRIBUTION,
  maptilerFallbackRasterTileUrl,
  maptilerStyleUrl,
} from "#/components/maps/maptiler-style.ts";
import { hasWebGl } from "#/components/park-map/webgl.ts";
import { cn } from "#/lib/utils.ts";

// A teardrop pin — a plain HTML/SVG element (not a library's default marker
// asset, which breaks under bundlers) so it renders identically under either
// engine and inherits a fixed brand blue regardless of theme.
const PIN_HTML = `<svg viewBox="0 0 24 24" width="30" height="30" fill="#2563eb" stroke="white" stroke-width="1.25" style="filter:drop-shadow(0 1px 2px rgba(0,0,0,.35))"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z"/><circle cx="12" cy="9" r="2.5" fill="white" stroke="none"/></svg>`;

/** Context-pin label pill: a white-or-slate background keeps it legible
 *  whether the app is light or dark themed. */
function contextPillStyle(dark: boolean): string {
  return dark
    ? "background:rgba(15,23,42,.82);color:#f1f5f9"
    : "background:rgba(255,255,255,.9);color:#0f172a";
}

/** MapLibre context pin: a small dot, sized to sit exactly on the point. */
const CONTEXT_DOT_HTML = `<span style="display:block;width:10px;height:10px;border-radius:50%;background:#0d9488;border:1.5px solid white;box-shadow:0 1px 2px rgba(0,0,0,.35)"></span>`;

/** MapLibre context pin's label — a separate marker offset from the dot, so
 *  the dot itself stays exactly on the point regardless of label length. */
function contextLabelHtmlGl(label: string, dark: boolean): string {
  return `<span style="${contextPillStyle(dark)};white-space:nowrap;font:600 10px/1.4 system-ui,sans-serif;padding:1px 5px;border-radius:5px;box-shadow:0 1px 2px rgba(0,0,0,.18)">${label}</span>`;
}

/** Leaflet context pin: dot + label combined into one `divIcon`, since
 *  Leaflet markers (unlike MapLibre's) can't take a per-marker pixel offset. */
function contextPinHtmlLeaflet(label: string, dark: boolean): string {
  return `<div style="display:flex;align-items:center;gap:4px;white-space:nowrap;transform:translateX(-5px)"><span style="width:10px;height:10px;border-radius:50%;background:#0d9488;border:1.5px solid white;box-shadow:0 1px 2px rgba(0,0,0,.35);flex:none"></span><span style="${contextPillStyle(dark)};font:600 10px/1.4 system-ui,sans-serif;padding:1px 5px;border-radius:5px;box-shadow:0 1px 2px rgba(0,0,0,.18)">${label}</span></div>`;
}

export interface MapMarker {
  latitude: number;
  longitude: number;
  label: string;
}

/**
 * A static location map: a single pin with the zoom locked and every
 * interaction/control disabled. Renders the same MapTiler vector style as the
 * interactive park map via MapLibre GL where WebGL is available, falling back
 * to Leaflet + a built-in MapTiler raster style otherwise (see
 * `maptiler-style.ts` — rasterizing our *custom* style needs a plan tier we
 * don't have, so the fallback doesn't match the GL map's look exactly). Both
 * libraries are loaded client-side only (dynamic import inside the effect) so
 * SSR never touches `window`.
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
    let cancelled = false;
    let cleanup: (() => void) | undefined;

    void (async () => {
      if (hasWebGl()) {
        const maplibregl = (await import("maplibre-gl")).default;
        if (cancelled || !ref.current) return;
        const map = new maplibregl.Map({
          container: ref.current,
          style: maptilerStyleUrl(),
          center: [longitude, latitude],
          zoom,
          attributionControl: false,
          // Disables every mouse/touch/keyboard handler in one go, so this
          // reads as a static image rather than an interactive map.
          interactive: false,
        });

        for (const m of markers ?? []) {
          const dotEl = document.createElement("div");
          dotEl.innerHTML = CONTEXT_DOT_HTML;
          new maplibregl.Marker({ element: dotEl, anchor: "center" })
            .setLngLat([m.longitude, m.latitude])
            .addTo(map);

          const labelEl = document.createElement("div");
          labelEl.innerHTML = contextLabelHtmlGl(m.label, dark);
          new maplibregl.Marker({ element: labelEl, anchor: "left", offset: [7, 0] })
            .setLngLat([m.longitude, m.latitude])
            .addTo(map);
        }

        const pinEl = document.createElement("div");
        pinEl.innerHTML = PIN_HTML;
        new maplibregl.Marker({ element: pinEl, anchor: "bottom" })
          .setLngLat([longitude, latitude])
          .addTo(map);

        // With context pins, frame the primary point and every marker (capped
        // so a tight cluster doesn't zoom to street level); otherwise hold the
        // fixed zoom.
        if (markers && markers.length > 0) {
          const bounds = markers.reduce(
            (b, m) => b.extend([m.longitude, m.latitude]),
            new maplibregl.LngLatBounds([longitude, latitude], [longitude, latitude]),
          );
          map.fitBounds(bounds, { padding: 30, maxZoom: 14, duration: 0 });
        }

        cleanup = () => map.remove();
        return;
      }

      const L = (await import("leaflet")).default;
      if (cancelled || !ref.current) return;
      const map = L.map(ref.current, {
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
      L.tileLayer(maptilerFallbackRasterTileUrl(), { maxZoom: 19, detectRetina: true }).addTo(map);

      for (const m of markers ?? []) {
        L.marker([m.latitude, m.longitude], {
          icon: L.divIcon({
            html: contextPinHtmlLeaflet(m.label, dark),
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

      if (markers && markers.length > 0) {
        const bounds = L.latLngBounds([
          [latitude, longitude],
          ...markers.map((m) => [m.latitude, m.longitude] as [number, number]),
        ]);
        map.fitBounds(bounds, { padding: [30, 30], maxZoom: 14 });
      }

      cleanup = () => map.remove();
    })();

    return () => {
      cancelled = true;
      cleanup?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [latitude, longitude, zoom, dark, markersKey]);

  return (
    <div className="flex flex-col gap-1.5">
      {/* `isolate` confines the map engine's internal high z-index elements to
          their own stacking context, so the map never paints over popovers/
          menus above it. */}
      <div
        ref={ref}
        role="img"
        aria-label={label ? `Map showing ${label}` : "Location map"}
        className={cn("isolate", className)}
      />
      <div className="flex flex-col text-[10px] text-muted-foreground">
        {caption && <p>{caption}</p>}
        <p>{MAPTILER_ATTRIBUTION}</p>
      </div>
    </div>
  );
}
