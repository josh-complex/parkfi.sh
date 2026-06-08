"use client";

import * as React from "react";
import type maplibregl from "maplibre-gl";

import { useSelection } from "#/components/park-dashboard/selection-context.tsx";

import { ParkMap } from "./park-map.tsx";

type StageCtx = {
  /**
   * Claim the live map for `slot`: teleports the singleton map's DOM into it
   * and animates from wherever it was. Returns a cleanup that parks the map.
   */
  attach: (slot: HTMLElement) => (() => void) | void;
};

const MapStageContext = React.createContext<StageCtx | null>(null);

function useMapStage() {
  const ctx = React.useContext(MapStageContext);
  if (!ctx) throw new Error("useMapStage must be used within a MapStageProvider");
  return ctx;
}

// Length of the hero⇄card morph. Kept in lockstep with the map's own camera fly
// (see MAP_FLY_MS in park-map.tsx) so the box and the imagery settle together.
export const MORPH_MS = 800;
const MORPH_EASE = "cubic-bezier(0.22, 1, 0.36, 1)";
const INLINE_PROPS = [
  "position",
  "margin",
  "z-index",
  "left",
  "top",
  "width",
  "height",
  "transform",
  "transform-origin",
  "will-change",
] as const;

/** translate+scale that maps the `big` footprint onto `r` (origin = top-left). */
function transformFor(r: DOMRect, big: DOMRect): string {
  return `translate(${r.left - big.left}px, ${r.top - big.top}px) scale(${r.width / big.width}, ${r.height / big.height})`;
}

/**
 * Morph `host` from `first` to `last` (both viewport rects) with a FLIP: the
 * canvas is rendered once at the *larger* of the two footprints (so it's only
 * ever scaled down — always crisp), then a GPU-composited `transform` is
 * animated between the two geometries. No per-frame resize, so the box glides
 * smoothly alongside the camera fly instead of snapping in discrete steps.
 *
 * The host is lifted to <body> as a fixed overlay so no transformed ancestor
 * distorts the coordinates, then re-homed into `slot` when the morph ends.
 */
function morph(
  host: HTMLElement,
  first: DOMRect,
  last: DOMRect,
  slot: HTMLElement,
  isCurrent: () => boolean,
  resize: () => void,
) {
  const big = first.width * first.height >= last.width * last.height ? first : last;
  document.body.appendChild(host);
  Object.assign(host.style, {
    position: "fixed",
    margin: "0",
    zIndex: "40",
    left: `${big.left}px`,
    top: `${big.top}px`,
    width: `${big.width}px`,
    height: `${big.height}px`,
    transformOrigin: "top left",
    willChange: "transform",
    transform: transformFor(first, big),
  });
  // Size the canvas to the larger footprint up front; the transform only ever
  // scales it down from here, so it stays sharp through the whole morph.
  resize();

  const anim = host.animate(
    [{ transform: transformFor(first, big) }, { transform: transformFor(last, big) }],
    { duration: MORPH_MS, easing: MORPH_EASE, fill: "both" },
  );

  anim.onfinish = () => {
    anim.cancel();
    // Re-home into the slot only if it's still the active one; otherwise a
    // newer navigation already claimed the map and we must not steal it back.
    if (isCurrent()) slot.appendChild(host);
    for (const p of INLINE_PROPS) host.style.removeProperty(p);
    resize();
  };
}

/**
 * Owns a single ParkMap instance and lends its DOM to whichever route mounts a
 * <MapSlot>. Because the same instance simply moves (it never unmounts), the
 * map — and its WebGL context, markers, and camera — survives navigation, so
 * the hero⇄card change is one smooth morph instead of a teardown/redraw.
 */
export function MapStageProvider({
  activeSlug,
  children,
}: {
  activeSlug: string | null;
  children: React.ReactNode;
}) {
  const { selected, setSelected } = useSelection();
  const hostRef = React.useRef<HTMLDivElement>(null);
  const parkRef = React.useRef<HTMLDivElement>(null);
  const mapRef = React.useRef<maplibregl.Map | null>(null);
  // Geometry of the slot we just left, carried into the next attach() to seed
  // the FLIP. Set on the outgoing slot's cleanup (mutation phase), consumed by
  // the incoming slot's layout effect.
  const prevRectRef = React.useRef<DOMRect | null>(null);
  const slotRef = React.useRef<HTMLElement | null>(null);

  const onMapRef = React.useCallback((m: maplibregl.Map | null) => {
    mapRef.current = m;
  }, []);

  const attach = React.useCallback((slot: HTMLElement) => {
    const host = hostRef.current;
    if (!host) return;
    slotRef.current = slot;
    const first = prevRectRef.current;
    prevRectRef.current = null;

    slot.appendChild(host);
    const last = host.getBoundingClientRect();
    const resize = () => mapRef.current?.resize();

    if (first && first.width > 4 && first.height > 4 && last.width > 4 && last.height > 4) {
      morph(host, first, last, slot, () => slotRef.current === slot, resize);
    } else {
      resize();
    }

    return () => {
      if (slotRef.current !== slot) return;
      // Remember where we are so the next slot can morph from here, then tuck
      // the map into its hidden parking spot until the next slot claims it.
      prevRectRef.current = host.getBoundingClientRect();
      parkRef.current?.appendChild(host);
      slotRef.current = null;
    };
  }, []);

  const value = React.useMemo(() => ({ attach }), [attach]);

  return (
    <MapStageContext.Provider value={value}>
      {/* Off-screen home for the singleton map whenever no slot owns it. */}
      <div ref={parkRef} className="pointer-events-none fixed -z-10 size-0 opacity-0" aria-hidden>
        <div ref={hostRef} className="size-full overflow-hidden">
          <ParkMap
            activeSlug={activeSlug}
            selectedId={selected?.id ?? null}
            onSelectAttraction={setSelected}
            onMapRef={onMapRef}
          />
        </div>
      </div>
      {children}
    </MapStageContext.Provider>
  );
}

/**
 * Reserves layout space for the shared map in a route and claims the live map
 * on mount. Style it like any container — the map fills it.
 */
export function MapSlot({ className }: { className?: string }) {
  const { attach } = useMapStage();
  const ref = React.useRef<HTMLDivElement>(null);

  // Layout effect (not passive) so the FLIP measures and starts before paint —
  // no flash of the map in its destination before it animates in.
  React.useLayoutEffect(() => {
    if (!ref.current) return;
    return attach(ref.current);
  }, [attach]);

  return <div ref={ref} className={className} />;
}
