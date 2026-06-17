/**
 * Engine-agnostic marker declutter + click-to-spiderfy controller, shared by the
 * MapLibre and Leaflet renderers. It owns three behaviors over a flat list of
 * markers:
 *
 *  1. **Cluster** — walking highest-priority first (selected, then busiest), each
 *     placed marker absorbs any later marker whose projected center falls within
 *     `clusterDist` px. Absorbed markers hide; the anchor shows a "+N" count chip.
 *  2. **Spiderfy** — clicking a cluster anchor fans its hidden members out on a
 *     ring around it (CSS transform on each member's chip) with dashed leader
 *     lines drawn into a shared SVG overlay. Clicking the anchor again, a member,
 *     or the map background collapses it; so does any pan/zoom (via `refresh`).
 *  3. **Activate** — a non-cluster marker (or a fanned-out member) routes its
 *     click to the caller's `onActivate` (navigate / select).
 *
 * Engine specifics stay in the renderer, handed in per item: `point()` projects
 * the marker to container px, `raise(on)` lifts it above neighbors. The renderer
 * also supplies the overlay `<svg>` (sized/stacked appropriately for its engine).
 */

export interface DeclutterItem {
  id: number;
  /** Current marker center in map-container pixels, or null if unprojectable. */
  point: () => { x: number; y: number } | null;
  /** The expanding chip element (carries the photo; we hide/translate it). */
  detail: HTMLElement;
  /** Lift this marker above its neighbors while fanned out / hovered. */
  raise: (on: boolean) => void;
  /** What a plain (non-cluster) click does — navigate to a park / select a ride. */
  onActivate: () => void;
  /** Placement priority — higher wins an anchor slot first. */
  priority: number;
}

const SVG_NS = "http://www.w3.org/2000/svg";

/**
 * Fan-out offsets (px, relative to the anchor) for `n` spiderfied members. Small
 * clusters use a single tight circle; larger ones switch to an Archimedean spiral
 * (à la Leaflet.markercluster) so the footprint stays compact instead of ballooning
 * with a radius that grows linearly in `n`.
 */
function fanOffsets(n: number): Array<{ x: number; y: number }> {
  const out: Array<{ x: number; y: number }> = [];
  if (n <= 9) {
    const radius = Math.max(44, (40 * n) / (2 * Math.PI));
    const step = (2 * Math.PI) / n;
    for (let i = 0; i < n; i++) {
      const a = step * i - Math.PI / 2;
      out.push({ x: radius * Math.cos(a), y: radius * Math.sin(a) });
    }
    return out;
  }
  let legLength = 24;
  let angle = 0;
  for (let i = 0; i < n; i++) {
    angle += 34 / legLength;
    out.push({ x: legLength * Math.cos(angle), y: legLength * Math.sin(angle) });
    legLength += (2 * Math.PI * 7) / angle;
  }
  return out;
}

/** Add / update / hide the "+N" cluster-count chip on an anchor's photo. */
function setClusterCount(detail: HTMLElement, count: number): void {
  const wrap = detail.firstElementChild as HTMLElement | null;
  if (!wrap) return;
  let badge = wrap.querySelector<HTMLElement>("[data-cluster-count]");
  if (count > 0) {
    if (!badge) {
      badge = document.createElement("span");
      badge.setAttribute("data-cluster-count", "");
      badge.className =
        "pointer-events-none absolute -top-1 -left-1 flex min-w-[1.15rem] items-center justify-center rounded-full border border-white bg-primary px-1 text-[9px] leading-[14px] font-bold text-primary-foreground shadow";
      wrap.appendChild(badge);
    }
    badge.textContent = `+${count}`;
    badge.classList.remove("hidden");
  } else if (badge) {
    badge.classList.add("hidden");
  }
}

export class MarkerCluster {
  private items: Array<DeclutterItem> = [];
  /** anchorId -> the markers it absorbed (empty array for a lone anchor). */
  private members = new Map<number, Array<DeclutterItem>>();
  private spiderAnchor: number | null = null;
  /**
   * Layout strategy. `cluster` (park view): absorb overlapping markers under a
   * "+N" anchor that fans out on click. `spread` (overview/home): never absorb —
   * keep every marker visible and just nudge overlapping ones apart, converging
   * back onto their true points as a zoom-in pulls them clear of each other.
   */
  private mode: "cluster" | "spread" = "cluster";

  constructor(
    private readonly overlay: SVGSVGElement,
    private readonly clusterDist: number,
    private readonly selectedId: () => number | null,
    /** Called at the start of every marker click (before spider/activate) so the
     *  renderer can dismiss any open popup — clicking any marker closes the modal. */
    private readonly onInteract?: () => void,
  ) {}

  /** Switch layout strategy (park view clusters; overview spreads). */
  setMode(mode: "cluster" | "spread"): void {
    this.mode = mode;
  }

  /** Replace the marker set (after a rebuild) and wire each one's click. */
  setItems(items: Array<DeclutterItem>): void {
    this.unspiderfy();
    this.items = items;
    this.members.clear();
    for (const it of items) {
      it.detail.addEventListener("click", (e) => {
        e.stopPropagation();
        this.onInteract?.();
        // Overview: no clustering/spider — every marker is a plain activate.
        if (this.mode === "spread") {
          it.onActivate();
          return;
        }
        if (this.spiderAnchor === it.id) {
          // Clicking the open cluster's head opens *its* info modal; the fanned
          // spider stays put rather than collapsing.
          it.onActivate();
          return;
        }
        const mem = this.members.get(it.id);
        if (mem && mem.length > 0) {
          this.refresh();
          this.spiderfy(it.id);
          return;
        }
        this.unspiderfy();
        it.onActivate();
      });
    }
  }

  /** Re-lay-out per the active mode (cluster or spread). */
  private relayout(): void {
    if (this.mode === "spread") this.spread();
    else this.cluster();
  }

  /** Re-cluster; if a spider is open, collapse it first (which re-lays-out). */
  refresh(): void {
    if (this.spiderAnchor != null) {
      this.unspiderfy();
    } else {
      this.clearLines();
      this.relayout();
    }
  }

  clear(): void {
    this.unspiderfy();
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
      // Clear any leftover spiderfy transform so a marker that becomes visible
      // here always sits at its true position (a late rAF can't strand it offset).
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
      setClusterCount(q.item.detail, this.members.get(q.item.id)?.length ?? 0);
    }
  }

  private spiderfy(anchorId: number): void {
    const anchor = this.items.find((i) => i.id === anchorId);
    const mem = this.members.get(anchorId);
    const a = anchor?.point();
    if (!anchor || !mem || mem.length === 0 || !a) return;
    this.spiderAnchor = anchorId;
    // Clear the field so only this cluster's photos are on screen while fanned out.
    const keep = new Set<number>([anchorId, ...mem.map((m) => m.id)]);
    for (const it of this.items) {
      if (!keep.has(it.id)) it.detail.classList.add("hidden");
    }
    setClusterCount(anchor.detail, 0);
    anchor.raise(true);
    const offsets = fanOffsets(mem.length);
    mem.forEach((m, i) => {
      const mp = m.point();
      if (!mp) return;
      const tx = a.x + offsets[i].x;
      const ty = a.y + offsets[i].y;
      m.detail.classList.remove("hidden");
      m.raise(true);
      this.drawLine(a.x, a.y, tx, ty);
      // Translate on the next frame so the photo animates out from the cluster
      // (a transform set in the same tick as un-hiding wouldn't transition).
      const dx = tx - mp.x;
      const dy = ty - mp.y;
      requestAnimationFrame(() => {
        if (this.spiderAnchor === anchorId)
          m.detail.style.transform = `translate(${dx}px, ${dy}px)`;
      });
    });
  }

  unspiderfy(): void {
    this.clearLines();
    if (this.spiderAnchor == null) return;
    this.spiderAnchor = null;
    for (const it of this.items) {
      it.detail.style.transform = "";
      it.raise(false);
    }
    // Restore the normal clustered view (re-hides the folded-away members and the
    // markers that were hidden while the spider was open, and rebuilds "+N" chips).
    this.relayout();
  }

  /**
   * Overview layout: keep every marker on screen and resolve overlaps by nudging
   * markers apart with a short force-relaxation pass, applied as a CSS transform
   * offset from each marker's true projected point. Displacement is kept minimal
   * (only overlapping pairs push), so markers sit as close to their real location
   * as possible and slide back onto it as a zoom-in separates the underlying
   * points (the detail's `transition-transform` animates the convergence).
   */
  private spread(): void {
    this.clearLines();
    const nodes: Array<{ it: DeclutterItem; x: number; y: number; ox: number; oy: number }> = [];
    for (const it of this.items) {
      it.detail.style.transform = "";
      const p = it.point();
      if (!p) {
        it.detail.classList.add("hidden");
        continue;
      }
      it.detail.classList.remove("hidden");
      setClusterCount(it.detail, 0);
      nodes.push({ it, x: p.x, y: p.y, ox: 0, oy: 0 });
    }
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

  private drawLine(x1: number, y1: number, x2: number, y2: number): void {
    const line = document.createElementNS(SVG_NS, "line");
    line.setAttribute("x1", String(x1));
    line.setAttribute("y1", String(y1));
    line.setAttribute("x2", String(x2));
    line.setAttribute("y2", String(y2));
    line.setAttribute("stroke", "currentColor");
    line.setAttribute("stroke-width", "1.5");
    line.setAttribute("stroke-dasharray", "2 3");
    line.setAttribute("stroke-linecap", "round");
    this.overlay.appendChild(line);
  }

  private clearLines(): void {
    while (this.overlay.firstChild) this.overlay.removeChild(this.overlay.firstChild);
  }
}
