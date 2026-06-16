"use client";

import * as React from "react";

import { useSelection } from "#/components/park-dashboard/selection-context.tsx";

import type { MapHandle } from "./shared.tsx";
import { hasWebGl } from "./webgl.ts";

// Lazy-loaded so the heavy map libraries (maplibre-gl, leaflet) are never
// evaluated on the server — leaflet's UMD touches `window` at import time and
// crashes SSR. The engine is only ever chosen on the client (see `engine`
// below), so the chunks load exactly when a real renderer is mounted.
const ParkMap = React.lazy(() => import("./park-map.tsx").then((m) => ({ default: m.ParkMap })));
const ParkMapLeaflet = React.lazy(() =>
  import("./park-map-leaflet.tsx").then((m) => ({ default: m.ParkMapLeaflet })),
);

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

// Length of the hero⇄card morph. Snappy, then the camera fly follows (see
// MORPH_MS in park-map.tsx, kept in lockstep so the fly waits for the box).
export const MORPH_MS = 420;
const INLINE_PROPS = [
  "position",
  "margin",
  "z-index",
  "left",
  "top",
  "width",
  "height",
  "will-change",
] as const;

// easeOutBack — overshoots slightly past the target before settling, for a
// springy little landing. `c1` tunes the bounce (higher = more overshoot).
function ease(t: number): number {
  const c1 = 1.5;
  const c3 = c1 + 1;
  const u = t - 1;
  return 1 + c3 * u * u * u + c1 * u * u;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

// Tears down any morph currently in flight on a given host, so a fast second
// navigation can claim the map without the prior morph's resize loop stomping
// the new morph's inline geometry.
const morphCleanup = new WeakMap<HTMLElement, () => void>();

/**
 * Morph `host` from `first` toward `slot`'s box by animating its *real* geometry
 * — left/top/width/height — and calling MapLibre's own `resize()` on every frame
 * so the map re-lays-out to fill its container as the box changes. We transition
 * the parent and let the map track it, rather than scaling a fixed-size canvas
 * with a CSS transform (which leaves the map's dimensions stale mid-flight, so
 * the layout appears not to adjust while the camera flies).
 *
 * The target is re-read from `slot.getBoundingClientRect()` *every frame* rather
 * than snapshotted once: the destination slot's flex height can still be
 * settling when the morph starts (its content/scroll height isn't final until
 * after paint), and snapshotting a stale value is what made the box land short
 * and then "pop" to full size at the end. Tracking the live rect lands it
 * exactly, no pop.
 *
 * The host is lifted to <body> as a fixed overlay so no transformed/clipped
 * ancestor distorts the coordinates, then re-homed into `slot` when done.
 */
function morph(host: HTMLElement, first: DOMRect, slot: HTMLElement, resize: () => void) {
  morphCleanup.get(host)?.();
  document.body.appendChild(host);
  Object.assign(host.style, {
    position: "fixed",
    margin: "0",
    zIndex: "40",
    left: `${first.left}px`,
    top: `${first.top}px`,
    width: `${first.width}px`,
    height: `${first.height}px`,
    willChange: "left, top, width, height",
  });
  resize();

  let raf = 0;
  let start = 0;
  let done = false;
  const teardown = () => {
    done = true;
    cancelAnimationFrame(raf);
    morphCleanup.delete(host);
  };
  morphCleanup.set(host, teardown);

  const tick = (now: number) => {
    if (!start) start = now;
    const t = Math.min(1, (now - start) / MORPH_MS);
    const e = ease(t);
    // Live target — picks up the slot's settling height/width as it finalizes.
    const to = slot.getBoundingClientRect();
    host.style.left = `${lerp(first.left, to.left, e)}px`;
    host.style.top = `${lerp(first.top, to.top, e)}px`;
    host.style.width = `${lerp(first.width, to.width, e)}px`;
    host.style.height = `${lerp(first.height, to.height, e)}px`;
    resize();
    if (t < 1 && !done) {
      raf = requestAnimationFrame(tick);
      return;
    }
    teardown();
    // Re-home into the slot only if it's still the one we were animating into;
    // otherwise a newer navigation already claimed the map and we must not
    // steal it back.
    if (host.parentElement !== slot && slot.isConnected) slot.appendChild(host);
    for (const p of INLINE_PROPS) host.style.removeProperty(p);
    resize();
  };
  raf = requestAnimationFrame(tick);
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
  const mapRef = React.useRef<MapHandle | null>(null);
  // Pick the renderer once on the client: MapLibre (WebGL) when available, the
  // Leaflet DOM/raster renderer otherwise — so a WebGL-disabled browser degrades
  // gracefully instead of crashing. `null` until detected, so SSR and the first
  // paint render no engine (the host stays an empty box) and there's no
  // server/client engine mismatch to hydrate.
  const [engine, setEngine] = React.useState<"gl" | "leaflet" | null>(null);
  React.useEffect(() => setEngine(hasWebGl() ? "gl" : "leaflet"), []);
  // Whether the singleton map is currently lent to a visible slot. While false
  // it's parked in the 0×0 off-screen home, where camera flies must not run —
  // Leaflet computes NaN coordinates fitting bounds into a zero-size container
  // and throws "Invalid LatLng object: (NaN, NaN)". The engines gate their fly
  // on this and re-fit when it flips true.
  const [attached, setAttached] = React.useState(false);
  // Geometry of the slot we just left, carried into the next attach() to seed
  // the FLIP. Set on the outgoing slot's cleanup (mutation phase), consumed by
  // the incoming slot's layout effect.
  const prevRectRef = React.useRef<DOMRect | null>(null);
  const slotRef = React.useRef<HTMLElement | null>(null);

  const onMapRef = React.useCallback((m: MapHandle | null) => {
    mapRef.current = m;
  }, []);

  const attach = React.useCallback((slot: HTMLElement) => {
    const host = hostRef.current;
    if (!host) return;
    slotRef.current = slot;
    setAttached(true);
    const first = prevRectRef.current;
    prevRectRef.current = null;

    slot.appendChild(host);
    const last = host.getBoundingClientRect();
    const resize = () => mapRef.current?.resize();

    if (first && first.width > 4 && first.height > 4 && last.width > 4 && last.height > 4) {
      morph(host, first, slot, resize);
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
      setAttached(false);
    };
  }, []);

  const value = React.useMemo(() => ({ attach }), [attach]);

  return (
    <MapStageContext.Provider value={value}>
      {/* Off-screen home for the singleton map whenever no slot owns it. */}
      <div ref={parkRef} className="pointer-events-none fixed -z-10 size-0 opacity-0" aria-hidden>
        <div ref={hostRef} className="size-full overflow-hidden">
          <React.Suspense fallback={null}>
            {engine === "gl" && (
              <ParkMap
                activeSlug={activeSlug}
                selectedId={selected?.id ?? null}
                onSelectAttraction={setSelected}
                onMapRef={onMapRef}
                attached={attached}
              />
            )}
            {engine === "leaflet" && (
              <ParkMapLeaflet
                activeSlug={activeSlug}
                selectedId={selected?.id ?? null}
                onSelectAttraction={setSelected}
                onMapRef={onMapRef}
                attached={attached}
              />
            )}
          </React.Suspense>
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
