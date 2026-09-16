"use client";

import * as React from "react";

import {
  BottomMapCluster,
  MapAttribution,
  ZoomControl,
} from "#/components/park-map/map-controls.tsx";
import { ParkMap } from "#/components/park-map/park-map.tsx";
import { hasWebGl } from "#/components/park-map/webgl.ts";
import { useRideFilter } from "#/components/rides/ride-filter.tsx";
import { cn } from "#/lib/utils.ts";

import type { MapHandle } from "#/components/park-map/shared.tsx";
import type { MapFrame } from "./waits-frame.ts";

/**
 * The Waits board's map pane.
 *
 * It is **the app's map**, not a second one: the same `ParkMap` renderer the
 * `/map` page runs, in the same free-roam mode — the same basemap with its
 * labels stripped, the park badges that open into ride markers as you zoom in,
 * the declutter that keeps two markers off one pixel, the photo cards, and the
 * app's own 3D zoom shelf and credits chip in place of the engine's native
 * controls. The first pass drew bespoke wait pills on a raw MapLibre instance
 * with `NavigationControl` and the native attribution bar showing: it looked
 * like a different product, and at resort zoom it stacked three markers on one
 * point. The roam map had already solved both.
 *
 * What this file adds is the two things the pane needs that `/map` doesn't: it
 * reports the camera's box up to the board (which narrows the list to it), and
 * it flies to a park when the board's filter picks exactly one.
 *
 * Markers come from the renderer's own feeds and are filtered by the shared
 * `useRideFilter` — the same state the rail and the modal write — so the pins
 * and the list can't disagree about what is being shown.
 *
 * Not the singleton: `MapStage` lends one live map between routes, and its
 * chrome (park chips, locate, nav overlay, play HUD) is written for a
 * full-bleed map page. This is a second instance of the renderer inside a card,
 * carrying only the chrome a card should have.
 */

export interface WaitsMapProps {
  /** Reports the visible box on load and after every camera move. */
  onFrameChange: (frame: MapFrame | null) => void;
  /** The board's selected park slugs. Exactly one flies the camera to it. */
  parks: ReadonlySet<string>;
  className?: string;
}

export function WaitsMap({ onFrameChange, parks, className }: WaitsMapProps) {
  const { filter } = useRideFilter();
  const [supported] = React.useState(() => hasWebGl());
  // Both a ref and state: the zoom buttons read the handle at click time, the
  // fly-to-park effect has to re-run when it arrives.
  const handleRef = React.useRef<MapHandle | null>(null);
  const [handle, setHandle] = React.useState<MapHandle | null>(null);
  const onMapRef = React.useCallback((h: MapHandle | null) => {
    handleRef.current = h;
    setHandle(h);
  }, []);

  // The board loses its frame when the pane goes away, so the list it leaves
  // behind is the whole filtered set rather than the last box the map held.
  const onFrameRef = React.useRef(onFrameChange);
  onFrameRef.current = onFrameChange;
  React.useEffect(() => () => onFrameRef.current(null), []);

  /**
   * Picking one park in the rail (or tapping its card in the band) is a
   * question about that park, so the camera goes there — `flyToPark` is the
   * same move the roam map's own park chips make. Only on a *change* to a
   * single park: re-flying whenever this renders would drag the map back every
   * time the reader panned away from the park they had filtered to.
   */
  const flownRef = React.useRef<string | null>(null);
  const only = parks.size === 1 ? [...parks][0]! : null;
  React.useEffect(() => {
    if (only == null) {
      flownRef.current = null;
      return;
    }
    if (!handle || flownRef.current === only) return;
    flownRef.current = only;
    handle.flyToPark(only);
  }, [handle, only]);

  if (!supported) {
    // Not an error state — plenty of hardened browsers simply have no WebGL,
    // and the board behind this panel is complete without it.
    return (
      <div className={className}>
        <div className="flex h-full flex-col items-center justify-center gap-2 rounded-[22px] border border-card-edge bg-card p-6 text-center">
          <span className="font-semibold">This browser can&rsquo;t draw the map</span>
          <span className="max-w-xs text-sm text-muted-foreground">
            WebGL is switched off or unavailable, so the list is showing every attraction rather
            than the ones in a map area.
          </span>
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-[22px] border border-card-edge bg-muted",
        className,
      )}
    >
      <ParkMap
        // Free-roam, exactly as `/map` runs it: park badges at resort zoom, a
        // park's own rides once the camera is inside it.
        roam
        attached
        activeSlug={null}
        filter={filter}
        onMapRef={onMapRef}
        onViewportChange={onFrameChange}
      />
      {/* The app's controls; the engine's are off inside the renderer. The
          credits chip is what carries the MapTiler/OSM attribution, so it is
          not optional. `fullBleed={false}` anchors the column to this card's
          own bottom edge rather than clearing a bottom nav that isn't under
          it. */}
      <BottomMapCluster side="right" fullBleed={false}>
        <ZoomControl
          onZoomIn={() => handleRef.current?.zoomIn()}
          onZoomOut={() => handleRef.current?.zoomOut()}
        />
        <MapAttribution />
      </BottomMapCluster>
    </div>
  );
}

export default WaitsMap;
