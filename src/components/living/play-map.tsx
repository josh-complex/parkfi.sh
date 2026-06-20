"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import maplibregl from "maplibre-gl";
import { useTheme } from "next-themes";

import { authClient } from "#/lib/auth-client.ts";
import { useTRPC } from "#/integrations/trpc/react.ts";
import { ORLANDO_CENTER, ORLANDO_ZOOM, escapeHtml } from "#/components/park-map/shared.tsx";

import "maplibre-gl/dist/maplibre-gl.css";

/** Minimal keyless raster basemap (mirrors the park-map style choice). */
function basemapStyle(dark: boolean): maplibregl.StyleSpecification {
  const tiles = dark
    ? ["a", "b", "c", "d"].map(
        (s) => `https://${s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png`,
      )
    : ["a", "b", "c"].map((s) => `https://${s}.tile.openstreetmap.org/{z}/{x}/{y}.png`);
  return {
    version: 8,
    sources: {
      base: {
        type: "raster",
        tiles,
        tileSize: 256,
        attribution:
          '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      },
    },
    layers: [{ id: "base", type: "raster", source: "base" }],
  };
}

/** Colored dot marker; `dimming` (system) = coral, `discovery` (user) = blue. */
function markerEl(kind: "dimming" | "discovery"): HTMLElement {
  const el = document.createElement("div");
  const color = kind === "dimming" ? "#D85A30" : "#378ADD";
  el.style.cssText = `width:18px;height:18px;border-radius:50%;background:${color};border:2px solid #fff;box-shadow:0 0 0 2px rgba(0,0,0,.15);cursor:pointer;`;
  if (kind === "dimming") el.style.boxShadow = `0 0 10px 2px ${color}`;
  return el;
}

interface PlayMapProps {
  parkSlug: string;
}

export function PlayMap({ parkSlug }: PlayMapProps) {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const { resolvedTheme } = useTheme();
  const dark = resolvedTheme === "dark";
  const { data: session } = authClient.useSession();
  const loggedIn = !!session?.user;

  const containerRef = React.useRef<HTMLDivElement>(null);
  const mapRef = React.useRef<maplibregl.Map | null>(null);
  const markersRef = React.useRef<maplibregl.Marker[]>([]);
  const [dropAt, setDropAt] = React.useState<{ lat: number; lng: number } | null>(null);
  const [note, setNote] = React.useState("");

  const parksQ = useQuery(trpc.parks.list.queryOptions());
  const park = parksQ.data?.find((p) => p.slug === parkSlug);
  const marksQ = useQuery({
    ...trpc.living.marks.queryOptions({ parkSlug }),
    refetchInterval: 30_000,
  });

  const leave = useMutation(
    trpc.living.leaveMark.mutationOptions({
      onSuccess: () => {
        setDropAt(null);
        setNote("");
        void qc.invalidateQueries({ queryKey: trpc.living.marks.queryKey({ parkSlug }) });
      },
    }),
  );
  const react = useMutation(
    trpc.living.reactMark.mutationOptions({
      onSuccess: () =>
        void qc.invalidateQueries({ queryKey: trpc.living.marks.queryKey({ parkSlug }) }),
    }),
  );

  // Init map once.
  React.useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const container = containerRef.current;
    const map = new maplibregl.Map({
      container,
      style: basemapStyle(dark),
      center: ORLANDO_CENTER,
      zoom: ORLANDO_ZOOM,
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    map.on("click", (e) => {
      if (!loggedIn) return;
      setDropAt({ lat: e.lngLat.lat, lng: e.lngLat.lng });
    });
    // The GL canvas can mount before the container is laid out (it renders blank
    // at 0×0 with the overlays still visible). Resize on load and whenever the
    // container's box changes so the basemap actually paints.
    map.on("load", () => {
      map.resize();
      const c = container.getBoundingClientRect();
      console.log(
        "[wayfarer map] loaded; container",
        Math.round(c.width),
        "x",
        Math.round(c.height),
      );
    });
    map.on("error", (e) => console.error("[wayfarer map] error:", e?.error ?? e));
    const ro = new ResizeObserver(() => map.resize());
    ro.observe(container);
    mapRef.current = map;
    return () => {
      ro.disconnect();
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Fly to the park once we know its center.
  React.useEffect(() => {
    if (!mapRef.current || !park?.latitude || !park?.longitude) return;
    mapRef.current.flyTo({
      center: [park.longitude, park.latitude],
      zoom: park.mapZoom ?? 15,
      duration: 800,
    });
  }, [park?.latitude, park?.longitude, park?.mapZoom]);

  // Render markers whenever marks change.
  React.useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    for (const m of markersRef.current) m.remove();
    markersRef.current = [];
    for (const mk of marksQ.data ?? []) {
      if (mk.latitude == null || mk.longitude == null) continue;
      const kind = mk.isSystem ? "dimming" : "discovery";
      const note = (mk.payload as { note?: string } | null)?.note;
      const title = mk.isSystem
        ? `The Dimming — ${escapeHtml(mk.attractionName ?? "a ride is down")}`
        : "Discovery";
      const body = mk.isSystem
        ? `A ride went down${mk.liveState?.standbyMin != null ? ` (was ${mk.liveState.standbyMin}m)` : ""}.`
        : escapeHtml(note ?? "");
      const popup = new maplibregl.Popup({ offset: 14 }).setHTML(
        `<div style="font:14px system-ui;max-width:220px">
           <strong>${title}</strong>
           <div style="margin-top:4px;color:#555">${body}</div>
           ${
             !mk.isSystem && loggedIn
               ? `<div style="margin-top:8px;display:flex;gap:8px">
                    <button data-react="found" data-id="${mk.id}">Found it (${mk.findCount})</button>
                    <button data-react="upvote" data-id="${mk.id}">▲ (${mk.upvoteCount})</button>
                    <button data-react="report" data-id="${mk.id}">Report</button>
                  </div>`
               : ""
           }
         </div>`,
      );
      popup.on("open", () => {
        const root = popup.getElement();
        root?.querySelectorAll<HTMLButtonElement>("button[data-react]").forEach((btn) => {
          btn.onclick = () =>
            react.mutate({
              markId: Number(btn.dataset.id),
              kind: btn.dataset.react as "found" | "upvote" | "report",
            });
        });
      });
      const marker = new maplibregl.Marker({ element: markerEl(kind) })
        .setLngLat([mk.longitude, mk.latitude])
        .setPopup(popup)
        .addTo(map);
      markersRef.current.push(marker);
    }
  }, [marksQ.data, loggedIn, react]);

  return (
    // Inline height is deliberate: an explicit, viewport-relative height that
    // doesn't depend on the parent flex chain resolving or on an arbitrary
    // Tailwind class. The map element fills it directly (h-full of a definite
    // parent) rather than via `absolute inset-0`, which was collapsing to 0px.
    <div
      className="relative w-full overflow-hidden rounded-lg border"
      style={{ height: "70vh", minHeight: 480 }}
    >
      <div ref={containerRef} className="h-full w-full" />

      {/* Legend */}
      <div className="bg-background/90 absolute left-3 top-3 rounded-md border px-3 py-2 text-xs shadow-sm">
        <div className="flex items-center gap-2">
          <span className="inline-block size-3 rounded-full" style={{ background: "#D85A30" }} />
          The Dimming (live ride-downs)
        </div>
        <div className="mt-1 flex items-center gap-2">
          <span className="inline-block size-3 rounded-full" style={{ background: "#378ADD" }} />
          Discovery pins
        </div>
      </div>

      {/* Drop-a-pin composer */}
      {dropAt ? (
        <div className="bg-background absolute bottom-3 left-1/2 w-[min(92%,420px)] -translate-x-1/2 rounded-lg border p-3 shadow-lg">
          <div className="mb-2 text-sm font-medium">Leave a discovery here</div>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={280}
            rows={2}
            placeholder="A tip, a hidden detail, a photo spot…"
            className="border-input bg-background w-full resize-none rounded-md border p-2 text-sm"
          />
          {leave.error ? (
            <div className="text-destructive mt-1 text-xs">{leave.error.message}</div>
          ) : null}
          <div className="mt-2 flex justify-end gap-2">
            <button
              className="rounded-md border px-3 py-1.5 text-sm"
              onClick={() => {
                setDropAt(null);
                setNote("");
              }}
            >
              Cancel
            </button>
            <button
              className="bg-primary text-primary-foreground rounded-md px-3 py-1.5 text-sm disabled:opacity-50"
              disabled={!note.trim() || leave.isPending}
              onClick={() => leave.mutate({ parkSlug, lat: dropAt.lat, lng: dropAt.lng, note })}
            >
              {leave.isPending ? "Dropping…" : "Drop pin"}
            </button>
          </div>
        </div>
      ) : loggedIn ? (
        <div className="bg-background/90 absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full border px-4 py-2 text-xs shadow-sm">
          Tap the map to leave a discovery
        </div>
      ) : (
        <div className="bg-background/90 absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full border px-4 py-2 text-xs shadow-sm">
          Sign in to leave discoveries
        </div>
      )}
    </div>
  );
}
