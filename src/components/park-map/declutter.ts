/**
 * Engine-agnostic marker declutter + click-to-zoom controller, shared by the
 * MapLibre and Leaflet renderers. It owns three behaviors over a flat list of
 * markers:
 *
 *  1. **Cluster** — walking highest-priority first (selected, then busiest), each
 *     placed marker absorbs any later marker whose projected center falls within
 *     `clusterDist` px. Absorbed markers hide; the anchor shows a "+N" count chip.
 *  2. **Zoom-to-cluster** — clicking a cluster anchor (one with absorbed members)
 *     asks the renderer to fit the camera to that cluster's footprint, so the
 *     group splits apart on the way in instead of fanning out in place. No spider.
 *  3. **Activate** — a lone (non-cluster) marker routes its click to the caller's
 *     `onActivate` (navigate / select).
 *
 * Engine specifics stay in the renderer, handed in per item: `point()` projects
 * the marker to container px, `raise(on)` lifts it above neighbors. The renderer
 * also supplies `onZoomToCluster`, which receives the projected points of the
 * cluster's members and flies/fits the camera to cover them (it unprojects back
 * to lng/lat in its own engine).
 */

import { MAP_TYPE_COLOR, type MapItemKind } from "./shared.tsx";

export interface DeclutterItem {
  id: number;
  /** Current marker center in map-container pixels, or null if unprojectable. */
  point: () => { x: number; y: number } | null;
  /** The expanding chip element (carries the photo; we hide/show it). */
  detail: HTMLElement;
  /** Lift this marker above its neighbors while hovered. */
  raise: (on: boolean) => void;
  /** What a plain (non-cluster) click does — navigate to a park / select a ride. */
  onActivate: () => void;
  /** Placement priority — higher wins an anchor slot first. */
  priority: number;
  /** Toggle group this marker belongs to, for the cluster's overflow dots. */
  kind?: MapItemKind;
}

// Fixed left-to-right order for the overflow dots, so a cluster's composition
// always reads the same way regardless of which marker anchored it.
const DOT_ORDER: ReadonlyArray<MapItemKind> = ["rides", "shows", "shops", "eats"];
const EMPTY_COUNTS: ReadonlyMap<MapItemKind, number> = new Map();

/**
 * Set the cluster's overflow indicator — one colour-coded count badge per *type*
 * of marker in the group (a group of 3 rides + 4 shops + 6 eats shows three
 * badges: blue "3", violet "4", amber "6"). Top-centered on the anchor's disc.
 * Passing empty counts clears it, so a lone marker carries no badges.
 */
function setClusterDots(detail: HTMLElement, counts: ReadonlyMap<MapItemKind, number>): void {
  const wrap = detail.firstElementChild as HTMLElement | null;
  if (!wrap) return;
  // `data-cluster-count` is reused so the card-morph's badge-hiding still finds it.
  let badge = wrap.querySelector<HTMLElement>("[data-cluster-count]");
  const present = DOT_ORDER.filter((k) => (counts.get(k) ?? 0) > 0);
  if (present.length > 0) {
    if (!badge) {
      badge = document.createElement("span");
      badge.setAttribute("data-cluster-count", "");
      badge.className =
        "pointer-events-none absolute -top-2 left-1/2 flex -translate-x-1/2 items-center gap-0.5";
      wrap.appendChild(badge);
    }
    badge.innerHTML = present
      .map(
        (k) =>
          `<span class="flex min-w-[1rem] items-center justify-center rounded-full border border-white px-1 text-[9px] leading-[14px] font-bold text-white shadow" style="background:${MAP_TYPE_COLOR[k]}">${counts.get(k)}</span>`,
      )
      .join("");
    badge.classList.remove("hidden");
  } else if (badge) {
    badge.classList.add("hidden");
    badge.innerHTML = "";
  }
}

export class MarkerCluster {
  private items: Array<DeclutterItem> = [];
  /** anchorId -> the markers it absorbed (empty array for a lone anchor). */
  private members = new Map<number, Array<DeclutterItem>>();
  /**
   * Layout strategy. `cluster` (park view): absorb overlapping markers under a
   * "+N" anchor that zooms in on click. `spread` (overview/home): never absorb —
   * keep every marker visible and just nudge overlapping ones apart, converging
   * back onto their true points as a zoom-in pulls them clear of each other.
   */
  private mode: "cluster" | "spread" = "cluster";

  constructor(
    private readonly clusterDist: number,
    private readonly selectedId: () => number | null,
    /** Fit the camera to a cluster's footprint (its members' projected points).
     *  The renderer unprojects them in its own engine and flies/fits. */
    private readonly onZoomToCluster: (points: Array<{ x: number; y: number }>) => void,
    /** Called at the start of every marker click (before zoom/activate) so the
     *  renderer can dismiss any open popup — clicking any marker closes the modal. */
    private readonly onInteract?: () => void,
  ) {}

  /** Switch layout strategy (park view clusters; overview spreads). */
  setMode(mode: "cluster" | "spread"): void {
    this.mode = mode;
  }

  /** Replace the marker set (after a rebuild) and wire each one's click. */
  setItems(items: Array<DeclutterItem>): void {
    this.items = items;
    this.members.clear();
    for (const it of items) {
      it.detail.addEventListener("click", (e) => {
        e.stopPropagation();
        this.onInteract?.();
        // Overview: no clustering — every marker is a plain activate.
        if (this.mode === "spread") {
          it.onActivate();
          return;
        }
        const mem = this.members.get(it.id);
        if (mem && mem.length > 0) {
          // Cluster head: zoom into the group rather than selecting the ride.
          const points = [it, ...mem]
            .map((m) => m.point())
            .filter((p): p is { x: number; y: number } => p != null);
          if (points.length > 0) this.onZoomToCluster(points);
          return;
        }
        it.onActivate();
      });
    }
  }

  /** Re-lay-out per the active mode (cluster or spread). */
  private relayout(): void {
    if (this.mode === "spread") this.spread();
    else this.cluster();
  }

  /** Re-cluster (cheap; runs on every pan/zoom frame so groups split/re-form). */
  refresh(): void {
    this.relayout();
  }

  clear(): void {
    this.items = [];
    this.members.clear();
  }

  private cluster(): void {
    const sel = this.selectedId();
    const sorted = [...this.items].sort(
      (a, b) => (b.id === sel ? Infinity : b.priority) - (a.id === sel ? Infinity : a.priority),
    );
    this.members.clear();
    const placed: Array<{ item: DeclutterItem; x: number; y: number }> = [];
    for (const it of sorted) {
      // Clear any leftover transform so a marker that becomes visible here always
      // sits at its true position.
      it.detail.style.transform = "";
      const p = it.point();
      if (!p) {
        it.detail.classList.add("hidden");
        continue;
      }
      // The selected marker is never absorbed — it always stays its own anchor.
      const anchor =
        it.id === sel
          ? undefined
          : placed.find(
              (q) =>
                Math.abs(p.x - q.x) < this.clusterDist && Math.abs(p.y - q.y) < this.clusterDist,
            );
      if (anchor) {
        this.members.get(anchor.item.id)?.push(it);
        it.detail.classList.add("hidden");
      } else {
        placed.push({ item: it, x: p.x, y: p.y });
        this.members.set(it.id, []);
        it.detail.classList.remove("hidden");
      }
    }
    for (const q of placed) {
      const members = this.members.get(q.item.id) ?? [];
      // Badges tally the whole visible group (anchor + everyone it absorbed) by
      // type; a lone marker (no members) gets none.
      const counts = new Map<MapItemKind, number>();
      if (members.length > 0) {
        for (const it of [q.item, ...members]) {
          if (it.kind) counts.set(it.kind, (counts.get(it.kind) ?? 0) + 1);
        }
      }
      setClusterDots(q.item.detail, counts);
    }
    // Grouping only guarantees anchors are ≥ clusterDist apart — narrower than the
    // disc, so anchors can still overlap. Nudge them apart too, so overlap never
    // survives whether markers grouped or not.
    this.relax(placed.map((q) => ({ it: q.item, x: q.x, y: q.y, ox: 0, oy: 0 })));
  }

  /**
   * Spread layout: keep every marker on screen and resolve overlaps by nudging
   * markers apart with a short force-relaxation pass, applied as a CSS transform
   * offset from each marker's true projected point. Displacement is kept minimal
   * (only overlapping pairs push), so markers sit as close to their real location
   * as possible and slide back onto it as a zoom-in separates the underlying
   * points (the detail's `transition-transform` animates the convergence).
   */
  private spread(): void {
    const nodes: Array<{ it: DeclutterItem; x: number; y: number; ox: number; oy: number }> = [];
    for (const it of this.items) {
      it.detail.style.transform = "";
      const p = it.point();
      if (!p) {
        it.detail.classList.add("hidden");
        continue;
      }
      it.detail.classList.remove("hidden");
      setClusterDots(it.detail, EMPTY_COUNTS);
      nodes.push({ it, x: p.x, y: p.y, ox: 0, oy: 0 });
    }
    this.relax(nodes);
  }

  /**
   * Nudge overlapping markers apart with a short force-relaxation pass, applied as
   * a CSS transform offset from each marker's true projected point. Only
   * overlapping pairs push, so displacement stays minimal and markers slide back
   * onto their real spot as a zoom-in separates the underlying points (the
   * detail's `transition-transform` animates the convergence). Runs in *both*
   * modes — spread (all markers) and cluster (the surviving anchors) — so markers
   * never visually overlap regardless of zoom or grouping.
   */
  private relax(
    nodes: Array<{ it: DeclutterItem; x: number; y: number; ox: number; oy: number }>,
  ): void {
    // Desired center-to-center separation — the collision box plus a little air.
    const min = this.clusterDist + 12;
    const ITER = 60;
    for (let k = 0; k < ITER; k++) {
      let moved = false;
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const a = nodes[i];
          const b = nodes[j];
          let dx = b.x + b.ox - (a.x + a.ox);
          let dy = b.y + b.oy - (a.y + a.oy);
          let d = Math.hypot(dx, dy);
          if (d >= min) continue;
          if (d < 0.01) {
            // Coincident points — split along a deterministic golden-angle ray so
            // the result is stable frame-to-frame (no random jitter).
            const ang = i * 2.39996;
            dx = Math.cos(ang);
            dy = Math.sin(ang);
            d = 1;
          }
          const push = (min - d) / 2;
          const ux = dx / d;
          const uy = dy / d;
          a.ox -= ux * push;
          a.oy -= uy * push;
          b.ox += ux * push;
          b.oy += uy * push;
          moved = true;
        }
      }
      if (!moved) break;
    }
    for (const n of nodes) {
      n.it.detail.style.transform = n.ox || n.oy ? `translate(${n.ox}px, ${n.oy}px)` : "";
    }
  }
}
