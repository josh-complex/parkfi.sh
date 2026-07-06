/**
 * Engine-agnostic map bits shared by the MapLibre (WebGL) renderer and the
 * Leaflet (DOM/raster) fallback. Everything here is about *what* to draw — the
 * marker DOM, popup HTML, colors, icons, and a few shared constants — never
 * *how* to position or animate it (that's engine-specific and lives in each
 * renderer). Keeping the two engines pointed at one set of builders is what
 * keeps the fallback visually identical to the real thing.
 */
import { renderToStaticMarkup } from "react-dom/server";
import {
  CastleIcon,
  ClapperboardIcon,
  CompassIcon,
  DramaIcon,
  FerrisWheelIcon,
  FilmIcon,
  GlobeIcon,
  InfoIcon,
  RocketIcon,
  RollerCoasterIcon,
  ShoppingBagIcon,
  SmileIcon,
  TicketIcon,
  TreesIcon,
  UtensilsIcon,
  WavesIcon,
  XIcon,
} from "lucide-react";

import type { BoardItem } from "#/components/park-dashboard/types.ts";
import type { GeoPolygon } from "#/db/schema.ts";
import type { Feature, FeatureCollection, MultiPolygon, Polygon } from "geojson";

/** A renderer handle the map stage pokes: keep the canvas sized during the layout
 *  morph, and drive zoom from our own overlay controls (the engine's native
 *  +/- are hidden in favour of 3D buttons that match the app). */
export type MapHandle = {
  resize: () => void;
  zoomIn: () => void;
  zoomOut: () => void;
  flyToPark: (slug: string) => void;
  /** Fly the camera to a point at a zoom (and, on GL, a bearing) — the nav
   *  "Start"/"recenter" close-up. Leaflet ignores `bearing` (it can't rotate). */
  flyToLocation: (
    coords: [number, number],
    opts?: { zoom?: number; bearing?: number; duration?: number },
  ) => void;
  /** Rotate the map to a compass bearing (degrees). No-op on Leaflet. */
  setBearing: (bearing: number, opts?: { duration?: number }) => void;
};

/**
 * Last free-roam camera (center `[lng,lat]` + zoom), remembered across
 * navigations so returning to `/map` restores the exact view the user left
 * instead of re-fitting all parks (which read as a jarring zoom-out). Module-
 * scoped so it survives the singleton map being lent to other routes; shared by
 * both renderers (only one engine is live per session). Null until the user has
 * moved the roam map at least once — the first entry still frames all parks.
 */
export type RoamCamera = { center: [number, number]; zoom: number };
let roamCamera: RoamCamera | null = null;
export function saveRoamCamera(camera: RoamCamera): void {
  roamCamera = camera;
}
export function getRoamCamera(): RoamCamera | null {
  return roamCamera;
}

// Orlando theme-park area — fallback view before park coords load (covers WDW +
// Universal Orlando). Stored as [lng, lat] (MapLibre order); Leaflet flips it.
export const ORLANDO_CENTER: [number, number] = [-81.51, 28.43];
export const ORLANDO_ZOOM = 10.5;

// Camera fly duration (ms).
export const MAP_FLY_MS = 800;
// Must match MORPH_MS in map-stage.tsx. We wait this long after a navigation
// before flying so the shared-map box has finished morphing to its destination
// size — fitBounds reads the container's pixel dimensions, so flying before the
// box settles frames the view for the wrong size. Layout first, then zoom.
export const MORPH_MS = 420;

// Square (px) reserved around a full marker for collision avoidance. Two markers
// whose projected centers fall within this on both axes can't both stay expanded;
// the lower-priority one is absorbed into the anchor's cluster (a tap on which
// zooms in). Just under the photo disc (52px) so markers group as soon as their
// discs meaningfully overlap (a cluster tap still zooms in enough to split them).
export const DECLUTTER_SIZE = 56;

// At/above this zoom a park view stops clustering entirely and switches to the
// "spread" layout — every marker stays visible, overlapping ones just nudge
// apart. By this depth pins are close to their true spots, so a group badge is
// more annoying than the slight nudge, and the user can zoom that last bit to
// separate them fully.
export const SPREAD_ZOOM = 19;

// Ring highlight layered onto the selected attraction marker (no scale — the
// charted ride shouldn't balloon). Applied to the inner element, not the marker
// root whose transform the engine owns for positioning.
const SELECTED_CLASSES = ["ring-2", "ring-primary", "ring-offset-1"];

/**
 * Mark a marker selected/deselected: ring highlight on, and its hover label
 * suppressed (the charted ride is already identified — no need to expand it).
 * While a marker's card is expanded (`data-card-open`) the ring is suppressed —
 * the card itself is the selection indicator, and the disc has flown up into the
 * card header, so a ring around the empty footprint would just float untethered.
 */
export function applySelected(detail: HTMLElement, on: boolean): void {
  const open = detail.hasAttribute("data-card-open");
  for (const c of SELECTED_CLASSES) detail.classList.toggle(c, on && !open);
  detail.querySelector<HTMLElement>("[data-label]")?.classList.toggle("hidden", on || open);
}

/** Escape user-facing strings before injecting into marker/popup innerHTML. */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
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

function categoryIconSvg(category: string | null, size = 14): string {
  const Icon = CATEGORY_ICON[(category ?? "info") as keyof typeof CATEGORY_ICON] ?? InfoIcon;
  return renderToStaticMarkup(<Icon width={size} height={size} strokeWidth={2.5} />);
}

// Per-park glyph for the overview map — a recognizable landmark icon (the castle,
// Spaceship Earth's globe, a clapperboard for the studios, …). Unknown slugs fall
// back to an operator-level icon, then a generic ticket.
const PARK_ICON: Record<string, typeof CastleIcon> = {
  "magic-kingdom": CastleIcon,
  epcot: GlobeIcon,
  "animal-kingdom": TreesIcon,
  "hollywood-studios": ClapperboardIcon,
  "universal-studios-florida": FilmIcon,
  "islands-of-adventure": CompassIcon,
  "epic-universe": RocketIcon,
};
const OPERATOR_ICON: Record<string, typeof CastleIcon> = {
  disney: CastleIcon,
  universal: RocketIcon,
};

function parkIconSvg(slug: string, operatorSlug: string | null, size = 15): string {
  const Icon = PARK_ICON[slug] ?? OPERATOR_ICON[operatorSlug ?? ""] ?? TicketIcon;
  return renderToStaticMarkup(<Icon width={size} height={size} strokeWidth={2.25} />);
}

/** Operator-brand accent for a park's icon disc — identity, not wait status. */
function operatorColor(operatorSlug: string | null): string {
  if (operatorSlug === "disney") return "#1d4ed8"; // blue
  if (operatorSlug === "universal") return "#7c3aed"; // violet
  return "#475569"; // slate fallback
}

/** A park-boundary feature: the OSM polygon plus its operator-brand color, read
 *  by both engines (Leaflet `style`, MapLibre `['get','color']`). */
export type BoundaryFeature = Feature<Polygon | MultiPolygon, { color: string }>;

/**
 * Build a GeoJSON FeatureCollection of park outlines (operator-colored) for the
 * map to draw beneath the markers — so we highlight just the actual theme-park
 * areas rather than the whole resort property. Parks without a stored boundary
 * are skipped. Both engines consume the same collection.
 */
export function boundaryFeatureCollection(
  parks: Array<{ boundary: GeoPolygon | null; operatorSlug?: string | null }>,
): FeatureCollection<Polygon | MultiPolygon, { color: string }> {
  const features: Array<BoundaryFeature> = [];
  for (const p of parks) {
    if (!p.boundary) continue;
    features.push({
      type: "Feature",
      properties: { color: operatorColor(p.operatorSlug ?? null) },
      geometry: p.boundary,
    });
  }
  return { type: "FeatureCollection", features };
}

/** Marker fill by wait/status — gray when not operating, green→red by wait. */
export function waitColor(wait: number | null, status: string | null): string {
  if (status && status !== "OPERATING") return "#6b7280"; // muted gray
  if (wait == null) return "#3b82f6"; // operating, no wait posted — blue
  if (wait < 20) return "#16a34a";
  if (wait < 45) return "#ca8a04";
  if (wait < 75) return "#ea580c";
  return "#dc2626";
}

/** Human-readable status line for an attraction's popup / title. */
export function waitLabelFor(a: BoardItem): string {
  const operating = a.status === "OPERATING";
  return operating && a.standbyWait != null
    ? `${a.standbyWait} min standby`
    : operating
      ? "Open · no wait posted"
      : a.status === "REFURBISHMENT"
        ? "In refurbishment"
        : a.status === "DOWN"
          ? "Temporarily down"
          : "Closed";
}

// The live wait pill's appearance, shared verbatim by the marker badge (anchored
// under the disc) and the expanded card's wait line, so the chip that flies from
// one to the other on expand is pixel-identical at both ends. Positioning classes
// (`absolute -bottom-2 …`) live only on the marker instance.
const WAIT_CHIP_CLASS =
  "inline-flex items-center whitespace-nowrap rounded-full border border-white bg-neutral-900 px-1.5 py-0.5 text-[10px] leading-none font-bold text-white shadow";

/**
 * Inner markup of a wait chip: the bold minutes plus a collapsible subtext (the
 * "standby" tail of the status line). The minutes live in their own
 * `[data-wait-num]` span because the cluster pass rewrites just that to a range
 * (see `setWaitRange`) — writing the whole chip's text would wipe the subtext.
 * The subtext is collapsed on the marker (`expanded=false`) and revealed when the
 * chip flies into the open card (`expanded=true`), so the pill grows to include it.
 */
function waitChipInner(minutes: number, label: string, expanded: boolean): string {
  const num = `${minutes} min`;
  const sub = label.startsWith(num) ? label.slice(num.length).trim() : "";
  const subCls = expanded ? "ml-1 max-w-[8rem] opacity-100" : "max-w-0 opacity-0";
  // `min-w-0` lets max-w-0 actually collapse the flex child (flex items default to
  // min-width:auto, which would otherwise keep it at content width). The subtext
  // inherits the chip's bold white type (no weight/opacity override) so the whole
  // "5 min standby" line reads as one consistent label; it snaps in quickly.
  return `<span data-wait-num>${num}</span><span data-wait-sub class="min-w-0 overflow-hidden whitespace-nowrap transition-all duration-200 ease-out ${subCls}">${escapeHtml(
    sub,
  )}</span>`;
}

/**
 * Placement priority for the cluster pass — the highest-priority marker in a
 * group becomes its visible head. Tiered so a ride with a posted wait always
 * heads its group (and, among several, the longest wait wins), then open rides
 * with no wait, then everything closed/down.
 */
export function attractionPriority(a: BoardItem): number {
  if (a.status === "OPERATING" && a.standbyWait != null) return 2000 + a.standbyWait;
  if (a.status === "OPERATING") return 1000;
  return 0;
}

/**
 * A map "type" — the four groups the on-map toggle chips stand for. Every marker
 * belongs to exactly one, and each has a signature accent colour shared by its
 * toggle pill (`map-stage`) and its cluster overflow dot (`declutter`), so a dot
 * always reads as the same category its chip lit.
 */
export type MapItemKind = "rides" | "shows" | "shops" | "eats";
export const MAP_TYPE_COLOR: Record<MapItemKind, string> = {
  rides: "#2563eb", // blue
  shows: "#e11d48", // rose
  shops: "#9333ea", // violet — matches the shop POI ring
  eats: "#d97706", // amber — matches the dining POI ring
};

// Attraction categories that roll up into the "Shows" group; everything else
// attraction-y (thrill / attraction / water) is a "ride".
const SHOW_KIND_CATEGORIES = new Set(["show", "character"]);

/** Which toggle group an attraction row belongs to ("Rides" vs "Shows"). */
export function attractionKind(category: string | null): MapItemKind {
  return category && SHOW_KIND_CATEGORIES.has(category) ? "shows" : "rides";
}

/** Which toggle group a POI belongs to ("Shops" vs "Eats" — dining/characters). */
export function poiKind(category: string): MapItemKind {
  return category === "shop" ? "shops" : "eats";
}

/**
 * Build the *body* of the expanded attraction card — everything below the photo
 * header (which is the marker's own disc, flown up by `openAttractionCard`, so
 * there's no separate hero image here). Disney rides carry rich `meta` (tags,
 * height/land); Universal (and un-enriched rows) degrade to just the name + live
 * wait line. The card lives in our themed DOM (not a white map popup), so it uses
 * theme tokens and reads correctly in dark mode. The "More info" link points at
 * our own ride page (`rideHref`); the renderer intercepts its click (`data-spa`)
 * for client-side navigation.
 */
/**
 * The in-card "Directions" button. Routes from the user's location to the point;
 * the renderer intercepts the click (marked `data-directions`) and reads the
 * destination from the data attributes. Empty string when we have no coordinates
 * to route to. A 3D-embossed button matching our `Button` primitive (border-3d /
 * shadow-3d), in blue to pair with the "More info"/"Details" link. Hand-written
 * classes rather than the React <Button> because the card body is injected HTML.
 */
export function directionsButtonHtml(lng: number | null, lat: number | null): string {
  if (lng == null || lat == null) return "";
  return `<button type="button" data-directions data-lng="${lng}" data-lat="${lat}" class="relative top-0 inline-flex shrink-0 items-center justify-center gap-1 rounded-full border-3d shadow-3d h-8 px-3.5 text-[12px] font-semibold whitespace-nowrap text-white outline-none select-none bg-blue-600 hover:bg-blue-500 [--btn-3d:var(--color-blue-800)] [--btn-glare:oklch(1_0_0_/_0.28)] transition-[box-shadow,top,background-color] duration-150 ease-out hover:-top-px hover:shadow-3d-hover active:top-[3px] active:[--btn-glare:var(--btn-3d)] active:shadow-3d-active">Directions</button>`;
}

export function attractionCardBodyHtml(a: BoardItem, waitLabel: string, rideHref: string): string {
  const meta = a.meta;
  const tags =
    meta?.tags && meta.tags.length > 0
      ? `<div class="mt-1.5 flex flex-wrap gap-1">${meta.tags
          .map(
            (t) =>
              `<span class="rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">${escapeHtml(
                t,
              )}</span>`,
          )
          .join("")}</div>`
      : "";
  // Height requirement first, then the land/location on its own line below it.
  const detail = [meta?.heightRequirement, meta?.land]
    .filter(Boolean)
    .map(
      (bit, i) =>
        `<div class="${i === 0 ? "mt-1 " : ""}text-[11px] text-muted-foreground">${escapeHtml(bit as string)}</div>`,
    )
    .join("");
  const directions = directionsButtonHtml(a.longitude, a.latitude);
  const moreInfo = `<a href="${escapeHtml(
    rideHref,
  )}" data-spa class="text-[13px] font-medium text-blue-600 hover:underline">More info →</a>`;
  const actions = `<div class="mt-2.5 flex items-center gap-2">${directions}${moreInfo}</div>`;
  // The wait line. When a live wait exists it renders as the very chip the marker
  // carries — the marker's chip physically flies onto this one on expand (see
  // openAttractionCard), growing to reveal the "standby" subtext held inside it.
  // `data-wait-chip` is that flight target. With no posted wait it's plain text.
  const minutes = a.status === "OPERATING" && a.standbyWait != null ? a.standbyWait : null;
  const waitLine =
    minutes != null
      ? `<div class="mt-0.5 flex text-[12px]"><span data-wait-chip class="${WAIT_CHIP_CLASS}">${waitChipInner(
          minutes,
          waitLabel,
          true,
        )}</span></div>`
      : `<div class="mt-0.5 text-[12px] text-muted-foreground">${escapeHtml(waitLabel)}</div>`;
  return `<div class="text-[15px] font-semibold leading-tight text-card-foreground">${escapeHtml(
    a.name,
  )}</div>${waitLine}${tags}${detail}${actions}`;
}

// Expanded-card geometry (px). The disc grows in place into a CARD_W-wide photo
// header of CARD_HEADER_H tall; the body unfolds below it.
const CARD_W = 264;
const CARD_HEADER_H = 132;
const CARD_RADIUS = 16; // matches the card's rounded-2xl (1rem)
// Morph duration (ms): the disc→card container grow + body/close fade.
const CARD_MS = 360;
const CARD_EASE = "cubic-bezier(.16,1,.3,1)"; // smooth ease-out, no overshoot
// On close, the "dressing" (3d shelf shadow, border, the chip's expanded subtext)
// clears faster than the geometry collapse so none of it lingers as a wide/heavy
// artifact once the disc has shrunk back — it's gone well before CARD_MS elapses.
const CARD_CLOSE_FX_MS = 170;

/** The single card currently expanded (across both engines), so opening one — or
 *  any other interaction — collapses the previous first. */
let openCard: { close: () => void } | null = null;

/**
 * Expand a tapped attraction marker into an info card as a true **container
 * morph**: the marker's own disc wrapper (`detail`'s first child) *becomes* the
 * card. It's a single `overflow:hidden` box that grows in place — its center stays
 * on the ground point — from a 52px circle into the full rounded rectangle, while
 * its border-radius eases from a full circle to the card's corner. Because there
 * is exactly one clipping container, there is exactly one radius: the photo (top)
 * and the details (below) live *inside* it and are clipped to the same rounded
 * shape throughout, so the rounding never looks inconsistent mid-flight. The disc
 * colour ring cross-fades into the card's drop shadow via one animated box-shadow.
 *
 * Engine-agnostic: it only touches the marker's `detail` element (which both
 * renderers position) and reads the map `container` to keep the card on-screen.
 * The returned `card` (the details body) is where the renderer wires the
 * `data-spa` / `data-directions` clicks; `close()` reverses the morph.
 */
export function openAttractionCard(opts: {
  detail: HTMLElement;
  container: HTMLElement;
  bodyHtml: string;
  /** Was this marker already ring-selected before we opened? Restored on close. */
  wasSelected: boolean;
  /** Fired once when the card begins closing — e.g. to drop the marker's z-lift. */
  onClose?: () => void;
}): { card: HTMLElement; close: () => void } {
  openCard?.close();

  const { detail, container, bodyHtml, wasSelected, onClose } = opts;
  const wrap = detail.firstElementChild as HTMLElement; // the disc wrapper → the card
  const fill = wrap.querySelector<HTMLElement>("[data-face-fill]"); // photo / icon face
  const label = detail.querySelector<HTMLElement>("[data-label]");
  const size = wrap.offsetWidth || 52;

  // The live wait chip doesn't just vanish on expand — it's the shared element that
  // flies from under the disc up to the card's wait line. Grab it and its resting
  // screen box now (before any mutation), plus enough to reparent it back on close.
  const waitEl = wrap.querySelector<HTMLElement>("[data-wait-badge]");
  const waitStart = waitEl?.getBoundingClientRect() ?? null;
  const waitRestore = waitEl
    ? {
        next: waitEl.nextSibling,
        style: waitEl.getAttribute("style") ?? "",
        cls: waitEl.className,
      }
    : null;

  // Upgrade the header to the higher-res photo, lazily — only fetched when a card
  // actually opens. The disc's low-res thumbnail is already decoded and stays put
  // as the header until the hi-res copy finishes loading, so there's no blank flash;
  // we swap the src in only on load. It then stays cached for the collapsed disc too.
  if (fill instanceof HTMLImageElement) {
    const hires = fill.dataset.hires;
    if (hires && hires !== fill.currentSrc && hires !== fill.src) {
      const pre = new Image();
      pre.addEventListener("load", () => {
        fill.src = hires;
      });
      pre.src = hires;
    }
  }

  // Suppress the selection ring while open (see applySelected) and lock the detail
  // box so the wrap going position:absolute doesn't collapse it (which would
  // un-center the marker from its point).
  detail.setAttribute("data-card-open", "");
  for (const c of SELECTED_CLASSES) detail.classList.remove(c);
  detail.style.width = `${size}px`;
  detail.style.height = `${size}px`;

  // Snapshot the disc's resting look so close() can restore it verbatim.
  const wrapStyle = wrap.getAttribute("style") ?? "";
  const wrapClass = wrap.className;
  const fillStyle = fill?.getAttribute("style") ?? "";
  const ringColor = fill?.style.getPropertyValue("--tw-ring-color").trim() || "transparent";
  // Hide any badges riding on the disc (wait pill / "+N") while it's the card,
  // remembering each one's prior visibility. A "+N" cluster chip that was already
  // hidden (this marker isn't a cluster head) must stay hidden on restore — else it
  // pops back as a phantom "+1" grouping when the card collapses.
  const badges = Array.from(wrap.children)
    .filter((c): c is HTMLElement => c !== fill && c !== waitEl)
    .map((el) => ({ el, wasHidden: el.classList.contains("hidden") }));
  for (const b of badges) b.el.classList.add("hidden");

  // The details body, injected *inside* the wrap below the photo. Fixed to the
  // card width so its wrapped height is correct even while the wrap is still a
  // circle (it's clipped away below the fold until the card is tall enough).
  const card = document.createElement("div");
  card.className = "bg-card px-4 pt-3 pb-3.5 text-left";
  card.style.width = `${CARD_W}px`;
  card.style.opacity = "0";
  card.style.transition = "opacity 200ms ease 110ms";
  card.innerHTML = bodyHtml;
  card.addEventListener("click", (e) => e.stopPropagation());
  wrap.appendChild(card);
  const totalH = CARD_HEADER_H + card.offsetHeight;

  // Placement: the card always settles in the center of the map, so every button
  // (Directions / More info) is on-screen regardless of where the pin sits — the
  // disc morphs from its point and slides to center. Still clamped 8px inside the
  // edges so an unusually tall card can't run off the top. Coords are detail-local
  // — detail's box is the disc, so we subtract dRect to convert from viewport space.
  const cRect = container.getBoundingClientRect();
  const dRect = detail.getBoundingClientRect();
  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(v, hi));
  const topLocal =
    clamp(
      cRect.top + (cRect.height - totalH) / 2,
      cRect.top + 8,
      Math.max(cRect.top + 8, cRect.bottom - 8 - totalH),
    ) - dRect.top;
  const leftLocal =
    clamp(
      cRect.left + (cRect.width - CARD_W) / 2,
      cRect.left + 8,
      Math.max(cRect.left + 8, cRect.right - 8 - CARD_W),
    ) - dRect.left;

  // Wait-chip flight. Promote the marker's chip out of the (soon overflow-hidden,
  // transforming) wrap into `detail` — a stable, untransformed box — so it can
  // travel cleanly from its resting spot under the disc to the card's wait line.
  // The destination is the transparent placeholder chip in the card body; because
  // both chips share WAIT_CHIP_CLASS they're the same size, so the landing is exact.
  const waitTarget = card.querySelector<HTMLElement>("[data-wait-chip]");
  let flyWait: (() => void) | undefined;
  let unflyWait: (() => void) | undefined;
  if (waitEl && waitStart && waitTarget) {
    const cardRect0 = card.getBoundingClientRect();
    const tRect0 = waitTarget.getBoundingClientRect();
    const startLeft = waitStart.left - dRect.left;
    const startTop = waitStart.top - dRect.top;
    // The placeholder's offset within the fixed-width card body is layout-stable;
    // its final on-screen spot is the card's final origin + that offset.
    const destLeft = leftLocal + (tRect0.left - cardRect0.left);
    const destTop = topLocal + CARD_HEADER_H + (tRect0.top - cardRect0.top);
    waitTarget.style.opacity = "0"; // the flown chip is the only visible one
    waitEl.classList.remove("-bottom-2", "left-1/2", "-translate-x-1/2");
    Object.assign(waitEl.style, {
      position: "absolute",
      left: `${startLeft}px`,
      top: `${startTop}px`,
      margin: "0",
      zIndex: "46",
      transform: "none",
      transition: "none",
    });
    detail.append(waitEl);
    void waitEl.offsetWidth; // commit the start transform before animating
    // The collapsible "standby" tail inside the chip — revealed as the chip flies
    // up (so the pill grows to include it), re-collapsed as it flies back.
    const waitSub = waitEl.querySelector<HTMLElement>("[data-wait-sub]");
    flyWait = () => {
      waitEl.style.transition = `transform ${CARD_MS}ms ${CARD_EASE}`;
      if (waitSub) waitSub.style.transition = ""; // reveal at the class default pace
      waitSub?.classList.remove("max-w-0", "opacity-0");
      waitSub?.classList.add("ml-1", "max-w-[8rem]", "opacity-100");
      waitEl.style.transform = `translate(${destLeft - startLeft}px, ${destTop - startTop}px)`;
    };
    unflyWait = () => {
      // The pill travels back with the card (transform stays on CARD_MS), but its
      // width snaps narrow fast so it isn't left wide well after the disc has formed.
      waitEl.style.transform = "none";
      if (waitSub) waitSub.style.transition = `all ${CARD_CLOSE_FX_MS}ms ease`;
      waitSub?.classList.remove("ml-1", "max-w-[8rem]", "opacity-100");
      waitSub?.classList.add("max-w-0", "opacity-0");
    };
  }

  // While open, swallow clicks on the card container so they don't bubble to the
  // marker's own click handler (which would re-fire activate). Removed on close.
  const stopProp = (e: Event) => e.stopPropagation();
  wrap.addEventListener("click", stopProp);

  // Close (×), pinned to the header's top-right. A sibling of the wrap (in detail),
  // so the wrap's overflow-hidden can't clip it.
  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.setAttribute("aria-label", "Close");
  closeBtn.className =
    "absolute flex size-6 items-center justify-center rounded-full bg-black/45 text-white backdrop-blur transition hover:bg-black/60 active:scale-90";
  Object.assign(closeBtn.style, {
    left: `${leftLocal + CARD_W - 30}px`,
    top: `${topLocal + 6}px`,
    zIndex: "50",
    opacity: "0",
    transition: "opacity 200ms ease 140ms",
  });
  closeBtn.innerHTML = renderToStaticMarkup(<XIcon width={14} height={14} strokeWidth={2.5} />);
  closeBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    close();
  });
  detail.append(closeBtn);
  label?.classList.add("hidden");

  // The one animated box-shadow: disc colour ring → card drop shadow. Kept to three
  // layers on both ends so it interpolates smoothly (no layer-count mismatch jump).
  // The card end lands on the same 3d "shelf" (`0 3px 0 var(--btn-3d)`) the modals
  // use via shadow-3d, plus a soft drop shadow — the border-3d classes added below
  // supply the matching edge. `--btn-3d` comes from btn-3d-outline on the wrap.
  const ringShadow = `0 0 0 3px ${ringColor}, 0 4px 6px -1px rgba(0,0,0,.12), 0 2px 4px -2px rgba(0,0,0,.12)`;
  const cardShadow = `0 3px 0 0 var(--btn-3d), 0 24px 48px -12px rgba(0,0,0,.28), 0 0 0 0 transparent`;

  // Promote the wrap into the card container, starting *exactly* as the resting
  // disc (52px circle + colour ring), transition off, so the promotion is invisible.
  wrap.className = "absolute overflow-hidden";
  Object.assign(wrap.style, {
    left: "0px",
    top: "0px",
    width: `${size}px`,
    height: `${size}px`,
    margin: "0",
    borderRadius: `${size / 2}px`,
    boxShadow: ringShadow,
    zIndex: "40",
    transition: "none",
  });
  // The photo/icon becomes the header: fills the card's width, fixed header height,
  // no radius of its own (the wrap clips it — that's what keeps the radii single).
  if (fill) {
    Object.assign(fill.style, {
      width: "100%",
      height: `${size}px`,
      borderRadius: "0",
      boxShadow: "none",
      transition: "none",
    });
    if (fill.tagName === "IMG") fill.style.display = "block";
  }
  void wrap.offsetWidth; // commit the collapsed start state before animating

  requestAnimationFrame(() => {
    // Match the app's modals/popovers: 3d shelf shadow + a plain 1px border (no
    // thicker top edge). `--btn-3d` (from btn-3d-outline) drives both the shelf
    // shadow above and the border; in dark mode it goes transparent, so
    // dark:border-border keeps an edge.
    wrap.classList.add("border-3d", "btn-3d-outline", "dark:border-border");
    // Pin the resolved border colour inline. A border-color that lives on a class
    // (border-3d / dark:border-border) doesn't reliably animate when close()
    // overrides it to transparent — the edge holds its colour for the whole
    // collapse and then snaps off when the classes are stripped. Pinning the
    // concrete value here gives the close transition a real inline start point, so
    // the border fades out with the shelf instead of popping at the end.
    wrap.style.borderColor = getComputedStyle(wrap).borderColor;
    wrap.style.transition = ["left", "top", "width", "height", "border-radius", "box-shadow"]
      .map((p) => `${p} ${CARD_MS}ms ${CARD_EASE}`)
      .join(", ");
    Object.assign(wrap.style, {
      left: `${leftLocal}px`,
      top: `${topLocal}px`,
      width: `${CARD_W}px`,
      height: `${totalH}px`,
      borderRadius: `${CARD_RADIUS}px`,
      boxShadow: cardShadow,
    });
    if (fill) {
      fill.style.transition = `height ${CARD_MS}ms ${CARD_EASE}`;
      fill.style.height = `${CARD_HEADER_H}px`;
    }
    card.style.opacity = "1";
    closeBtn.style.opacity = "1";
    flyWait?.();
  });

  let closed = false;
  function close() {
    if (closed) return;
    closed = true;
    if (openCard === handle) openCard = null;
    onClose?.();
    // Reverse: geometry (position/size/radius) eases back over CARD_MS, but the
    // shelf shadow and border fade fast (CARD_CLOSE_FX_MS) so the 3d dressing is
    // gone early rather than popping off when the classes are stripped at the end.
    wrap.style.transition = [
      `left ${CARD_MS}ms ${CARD_EASE}`,
      `top ${CARD_MS}ms ${CARD_EASE}`,
      `width ${CARD_MS}ms ${CARD_EASE}`,
      `height ${CARD_MS}ms ${CARD_EASE}`,
      `border-radius ${CARD_MS}ms ${CARD_EASE}`,
      `box-shadow ${CARD_CLOSE_FX_MS}ms ease`,
      `border-color ${CARD_CLOSE_FX_MS}ms ease`,
    ].join(", ");
    Object.assign(wrap.style, {
      left: "0px",
      top: "0px",
      width: `${size}px`,
      height: `${size}px`,
      borderRadius: `${size / 2}px`,
      boxShadow: ringShadow,
      borderColor: "transparent",
    });
    if (fill) fill.style.height = `${size}px`;
    unflyWait?.(); // the wait chip flies back down to the disc
    card.style.opacity = "0";
    // Fade the close button out fast (its open transition carried a 140ms delay
    // that otherwise left it hanging in mid-air after the card had collapsed away).
    closeBtn.style.transition = "opacity 120ms ease";
    closeBtn.style.opacity = "0";
    window.setTimeout(() => {
      card.remove();
      closeBtn.remove();
      wrap.removeEventListener("click", stopProp);
      // Restore the disc + detail box to their resting state.
      wrap.className = wrapClass;
      wrap.setAttribute("style", wrapStyle);
      if (fill) fill.setAttribute("style", fillStyle);
      // Return the wait chip to its resting spot under the disc, verbatim.
      if (waitEl && waitRestore) {
        waitEl.className = waitRestore.cls;
        waitEl.setAttribute("style", waitRestore.style);
        wrap.insertBefore(waitEl, waitRestore.next);
      }
      for (const b of badges) b.el.classList.toggle("hidden", b.wasHidden);
      detail.removeAttribute("data-card-open");
      detail.style.width = "";
      detail.style.height = "";
      if (wasSelected) applySelected(detail, true);
      else label?.classList.remove("hidden");
    }, CARD_MS);
  }

  const handle = { close };
  openCard = handle;
  return { card, close };
}

// The wrapper that the cluster controller hides / translates / highlights: a
// disc-sized box (so the marker's footprint is just the photo, centered on the
// point) holding the photo plus an absolutely-positioned label that slides out on
// hover. `will-change-transform` keeps the declutter nudge translate smooth.
const DETAIL_CLASS =
  "relative rounded-full transition-transform duration-200 will-change-transform";

/** A circular photo disc (colour-ringed) or, with no photo, the fallback icon
 *  disc. No white border — a thicker colour ring hugs the image so the photo
 *  fills the whole disc. `badge` is optional overlay HTML (e.g. a ride's wait).
 *  `px` sizes the disc with an explicit square box (not a Tailwind size class)
 *  so it's guaranteed round — a non-square box would render the round-clipped
 *  photo as a wide oval. */
function discMarkup(opts: {
  url: string | null;
  /** A higher-res variant of `url`, lazily swapped in when the disc expands into
   *  the card header (see `openAttractionCard`). Tagged as `data-hires` so the
   *  small `url` still loads instantly for the tiny disc. */
  hiResUrl?: string | null;
  alt: string;
  fallbackSvg: string;
  ring: string;
  bg: string;
  px: number;
  badge?: string;
}): string {
  const ring = `--tw-ring-color:${opts.ring}`;
  const hires =
    opts.hiResUrl && opts.hiResUrl !== opts.url ? ` data-hires="${escapeHtml(opts.hiResUrl)}"` : "";
  // `data-face-fill` tags the photo/icon face so the card animator can morph it
  // (border-radius + ring) as the disc flies up into the expanded card header.
  const face = opts.url
    ? `<img data-face-fill${hires} src="${escapeHtml(opts.url)}" alt="${escapeHtml(
        opts.alt,
      )}" loading="lazy" class="size-full rounded-full object-cover shadow-md ring-[3px]" style="${ring}" />`
    : `<span data-face-fill class="flex size-full items-center justify-center rounded-full text-white shadow-md ring-[3px]" style="background:${opts.bg};${ring}">${opts.fallbackSvg}</span>`;
  return `<span class="relative block shrink-0" style="width:${opts.px}px;height:${opts.px}px">${face}${opts.badge ?? ""}</span>`;
}

/**
 * The hover-revealed label: a card pill anchored to the photo's right edge,
 * clipped to zero width at rest and expanding on `group-hover`. Its width is
 * capped at the smaller of 13rem and 50vw so it never overflows a narrow (mobile)
 * map, and the title wraps to two lines (`line-clamp-2`) instead of being cut off.
 * Carries `flip` variants so a renderer can re-anchor it to the LEFT (via
 * `wireHoverLabelFlip`) when the marker is near the container's right edge.
 * `pointer-events-none` so it never eats a click meant for the photo/map.
 * `subtitle` is pre-escaped markup; `title` is plain text.
 */
function labelMarkup(title: string, subtitle: string): string {
  return `<span data-label class="pointer-events-none absolute top-1/2 left-full z-20 ml-1.5 flex w-max max-w-0 -translate-y-1/2 flex-col items-start overflow-hidden rounded-xl bg-card/95 px-0 py-0 text-left leading-tight opacity-0 shadow-lg ring-1 ring-black/5 backdrop-blur transition-all duration-200 ease-out group-hover:max-w-[min(10rem,45vw)] group-hover:px-2.5 group-hover:py-1 group-hover:opacity-100 [&.flip]:left-auto [&.flip]:right-full [&.flip]:ml-0 [&.flip]:mr-1.5 [&.flip]:items-end [&.flip]:text-right"><span class="line-clamp-2 text-[11px] font-medium text-card-foreground">${escapeHtml(
    title,
  )}</span><span class="whitespace-nowrap text-[10px] font-normal text-muted-foreground">${subtitle}</span></span>`;
}

/**
 * On hover, flip a marker's label to the left when expanding it rightward would
 * spill past the map container's right edge (and there's room on the left).
 * Measured live since the marker's screen position changes with pan/zoom.
 */
export function wireHoverLabelFlip(el: HTMLElement, container: HTMLElement): void {
  const label = el.querySelector<HTMLElement>("[data-label]");
  if (!label) return;
  el.addEventListener("mouseenter", () => {
    // Flip to the left whenever the marker sits in the right half of the map:
    // the label (capped at min(13rem, 50vw)) always fits the wider side, so this
    // keeps it on-screen without depending on a fragile width estimate.
    const c = container.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    label.classList.toggle("flip", (r.left + r.right) / 2 > c.left + c.width / 2);
  });
}

/** The "you are here" marker: a solid blue dot with a soft pulsing halo, plus a
 *  facing cone. Built as plain DOM so both engines can drop it on the map like
 *  any other marker. Call {@link setUserHeading} to point/hide the cone. */
export function buildUserLocationEl(): HTMLDivElement {
  const el = document.createElement("div");
  el.className = "relative flex size-4 items-center justify-center";
  el.setAttribute("aria-hidden", "true");
  el.innerHTML =
    // Facing cone: the wrapper fills the dot box and rotates about its center
    // (via `setUserHeading`); the triangle is pinned just above center, pointing
    // up, so rotating the wrapper sweeps it around the dot. Hidden until we have
    // a heading. Rotation lives on the wrapper, centering on the triangle, so
    // the two transforms never fight.
    '<span data-user-cone class="absolute inset-0 hidden" style="transform:rotate(0deg)">' +
    '<span class="absolute bottom-1/2 left-1/2 mb-1 block size-0 -translate-x-1/2 border-x-[7px] border-b-[11px] border-x-transparent border-b-blue-500/70"></span>' +
    "</span>" +
    '<span class="absolute inline-flex size-full animate-ping rounded-full bg-blue-500/40"></span>' +
    '<span class="relative inline-flex size-3.5 rounded-full border-2 border-white bg-blue-500 shadow-md"></span>';
  return el;
}

/** Two [lng,lat] points are the "same" destination — a tiny epsilon (~0.1 m)
 *  absorbs float round-trips between a trip's destination and a marker's coords,
 *  so the navigating-marker gate matches even if the values took different paths. */
export function sameCoords(a: [number, number], b: [number, number]): boolean {
  return Math.abs(a[0] - b[0]) < 1e-6 && Math.abs(a[1] - b[1]) < 1e-6;
}

/**
 * A temporary dev-destination pin — the `nav-test-tools` picker's spots, drawn on
 * the map only while actively navigating so a dev target (which isn't a real
 * attraction) is still visible. Fuchsia to match the dev panel; the one we're
 * routing to (`active`) gets a pulse ring and a name label. Bottom-anchored so
 * the dot tip sits on the coordinate.
 */
export function buildDevSpotEl(label: string, active: boolean): HTMLElement {
  const el = document.createElement("div");
  el.className = "relative flex flex-col items-center";
  el.setAttribute("aria-hidden", "true");
  el.innerHTML =
    (active
      ? '<span class="absolute top-0 inline-flex size-5 animate-ping rounded-full bg-fuchsia-500/50"></span>'
      : "") +
    '<span class="relative inline-flex items-center justify-center rounded-full border-2 border-white shadow-md ' +
    (active ? "size-5 bg-fuchsia-600" : "size-3.5 bg-fuchsia-700/90") +
    '"><span class="block size-1.5 rounded-full bg-white/90"></span></span>' +
    (active
      ? '<span class="mt-1 whitespace-nowrap rounded-full bg-fuchsia-600 px-2 py-0.5 text-[10px] font-semibold text-white shadow">' +
        escapeHtml(label) +
        "</span>"
      : "");
  return el;
}

/** Point the facing cone on a {@link buildUserLocationEl} marker at `deg` (screen
 *  degrees, clockwise from up), or hide it when `deg` is null (heading unknown). */
export function setUserHeading(el: HTMLElement, deg: number | null): void {
  const cone = el.querySelector<HTMLElement>("[data-user-cone]");
  if (!cone) return;
  if (deg == null) {
    cone.classList.add("hidden");
    return;
  }
  cone.classList.remove("hidden");
  cone.style.transform = `rotate(${deg}deg)`;
}

/**
 * One park badge for the overview map: just the park photo at rest, expanding on
 * hover to reveal the name + live "N open · Ym avg" line. The caller wires the
 * click (navigate) and a hover z-lift so the expanded panel clears its neighbors.
 */
export function buildParkBadgeEl(p: {
  name: string;
  slug: string;
  operatorSlug: string | null;
  operating: number;
  avgWait: number | null;
  imageUrl?: string | null;
  imageAlt?: string | null;
}): { el: HTMLButtonElement; detail: HTMLDivElement } {
  const el = document.createElement("button");
  el.type = "button";
  el.setAttribute("aria-label", p.name);
  el.className = "group relative block cursor-pointer";
  const color = operatorColor(p.operatorSlug);
  const wait = p.avgWait != null ? `${p.avgWait}m avg` : "—";
  const disc = discMarkup({
    url: p.imageUrl ?? null,
    alt: p.imageAlt ?? p.name,
    fallbackSvg: parkIconSvg(p.slug, p.operatorSlug),
    ring: color,
    bg: color,
    px: 64,
  });
  const subtitle = `${p.operating} open · ${escapeHtml(wait)}`;
  const detail = document.createElement("div");
  detail.className = DETAIL_CLASS;
  detail.innerHTML = `${disc}${labelMarkup(p.name, subtitle)}`;
  el.append(detail);
  return { el, detail };
}

/** A plottable dining/shop point (from `parks.dining` / `parks.shops`). */
export type PoiItem = {
  id: string;
  name: string;
  latitude: number | null;
  longitude: number | null;
  land: string | null;
  /** finder map-pin: 'dine' | 'characters' | 'shop'. */
  category: string;
  imageUrl: string | null;
  detailUrl?: string | null;
  /** Finder slug — present on shops (deep-links `/shop/$slug`); absent on dining. */
  slug?: string | null;
};

/**
 * Body of the shared POI info card (dining + shops) — the same layout both
 * overlay layers pop, mirroring the attraction card below the photo header (the
 * marker's own disc, flown up by `openAttractionCard`). Shows the name, a
 * kind · land subtitle, and a "Details →" link to *our own* page — never the
 * operator's site: shops → `/shop/$slug`, dining/character spots →
 * `/dining/$facilityId` (the POI id). The link carries `data-spa` plus the
 * target ids in data attributes; the renderer intercepts it for client-side nav.
 * Lives in themed DOM (reads correctly in dark).
 */
export function poiCardBodyHtml(poi: PoiItem): string {
  const kindLabel =
    poi.category === "shop" ? "Shop" : poi.category === "characters" ? "Character Spot" : "Dining";
  const subtitle = [kindLabel, poi.land].filter(Boolean).join(" · ");
  // Shops key their page on the finder slug; dining on the facility id (our
  // `/dining/$facilityId` route). A shop missing its slug has no page to link.
  const link =
    poi.category === "shop"
      ? poi.slug
        ? `<a href="/shop/${escapeHtml(poi.slug)}" data-spa data-shop-slug="${escapeHtml(
            poi.slug,
          )}" class="text-[13px] font-medium text-blue-600 hover:underline">Details →</a>`
        : ""
      : `<a href="/dining/${escapeHtml(poi.id)}" data-spa data-dining-id="${escapeHtml(
          poi.id,
        )}" class="text-[13px] font-medium text-blue-600 hover:underline">Details →</a>`;
  // Shops/dining route from the user's location too — same button as rides.
  const directions = directionsButtonHtml(poi.longitude, poi.latitude);
  const actions =
    directions || link
      ? `<div class="mt-3 flex items-center gap-2">${directions}${link}</div>`
      : "";
  return `<div class="text-[15px] font-semibold leading-tight text-card-foreground">${escapeHtml(
    poi.name,
  )}</div><div class="mt-1 text-[12px] text-muted-foreground">${escapeHtml(
    subtitle,
  )}</div>${actions}`;
}

// Accent per POI kind — warm amber for dining, violet for shops, pink for
// character spots. Distinct from the wait-status palette so POIs never read as
// a ride's crowd level.
const POI_COLOR: Record<string, string> = {
  dine: "#d97706",
  characters: "#db2777",
  shop: "#9333ea",
};

/**
 * Build a dining/shop POI marker: a colour-ringed photo disc (or category icon)
 * with a hover label of its name + land. Same 52px disc as a ride marker so the
 * POI layers sit as equal citizens on the map. Folded into the ride cluster by
 * the renderer, so overlapping markers group + collision-avoid together. Returns
 * the root plus the `detail` layer (for the hover-label flip), like the others.
 */
export function buildPoiEl(poi: PoiItem): { el: HTMLButtonElement; detail: HTMLDivElement } {
  // Normalize the finder pin to a CATEGORY_ICON key ("characters" -> "character").
  const iconKey = poi.category === "characters" ? "character" : poi.category;
  const color = POI_COLOR[poi.category] ?? "#64748b";

  const el = document.createElement("button");
  el.type = "button";
  el.setAttribute("aria-label", poi.name);
  el.className = "group relative block cursor-pointer";

  const detail = document.createElement("div");
  detail.className = DETAIL_CLASS;
  const disc = discMarkup({
    url: poi.imageUrl,
    alt: poi.name,
    fallbackSvg: categoryIconSvg(iconKey),
    ring: color,
    bg: color,
    px: 52,
  });
  detail.innerHTML = `${disc}${labelMarkup(poi.name, escapeHtml(poi.land ?? ""))}`;
  el.append(detail);
  return { el, detail };
}

/**
 * Pixel padding for a fit/zoom so the framed markers land in the *visible* band of
 * the map — not tucked behind the chrome floating over it (the top search bar +
 * chip rows and the bottom nav island + zoom/locate controls). We measure the real
 * overlay elements (tagged `data-map-chrome="top"|"bottom"`) relative to the map
 * container, so the reserve tracks safe-area insets, breakpoints, and whichever
 * controls are actually mounted — instead of drifting from hard-coded rem math.
 * `base`/`sides` are the minimum pad when nothing overlaps a given edge; the result
 * is clamped so top+bottom / left+right always leave a usable band (maplibre throws
 * on padding that swallows the viewport).
 */
export function chromePadding(
  container: HTMLElement | null,
  opts: { base?: number; sides?: number } = {},
): { top: number; bottom: number; left: number; right: number } {
  const base = opts.base ?? 48;
  const sides = opts.sides ?? 24;
  const air = 12; // a little breathing room past the chrome's edge
  const pad = { top: base, bottom: base, left: sides, right: sides };
  if (!container || typeof document === "undefined") return pad;
  const root = container.getBoundingClientRect();
  if (root.width === 0 || root.height === 0) return pad;
  for (const node of document.querySelectorAll<HTMLElement>("[data-map-chrome]")) {
    // Skip hidden controls (display:none via breakpoints, unmounted HUD).
    if (node.offsetParent === null && node.getClientRects().length === 0) continue;
    const r = node.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    if (node.dataset.mapChrome === "top") pad.top = Math.max(pad.top, r.bottom - root.top + air);
    else if (node.dataset.mapChrome === "bottom")
      pad.bottom = Math.max(pad.bottom, root.bottom - r.top + air);
  }
  const maxV = root.height * 0.4;
  const maxH = root.width * 0.4;
  pad.top = Math.min(pad.top, maxV);
  pad.bottom = Math.min(pad.bottom, maxV);
  pad.left = Math.min(pad.left, maxH);
  pad.right = Math.min(pad.right, maxH);
  return pad;
}

/**
 * Build an attraction marker's DOM: a root button holding two swappable layers —
 * a full "detail" disc (ride icon + wait badge) and a small "dot" — toggled by
 * the declutter pass. Visual scale lives on the children so hover/selection
 * scaling never fights the engine's positioning of the root. The caller wires
 * the click and positions the root.
 */
export function buildAttractionEl(
  a: BoardItem,
  selected: boolean,
): { el: HTMLButtonElement; detail: HTMLDivElement } {
  // Ring the disc in its toggle-group colour (blue rides / rose shows) so a
  // marker's outline reads as the same category its chip lit — matching the POI
  // rings and the cluster overflow dots. Live wait/status still shows via the
  // numeric wait badge below, so the ring is free to signal *kind* not crowd.
  const color = MAP_TYPE_COLOR[attractionKind(a.category)];
  const operating = a.status === "OPERATING";

  const el = document.createElement("button");
  el.type = "button";
  el.setAttribute("aria-label", a.name);
  el.className = "group relative block cursor-pointer";

  // `detail` is the wrapper the controller clusters/translates/highlights: the
  // ride photo at rest, with a label that slides out on hover.
  const detail = document.createElement("div");
  detail.className = DETAIL_CLASS;
  // Wait time reads as a larger chip anchored to the disc's bottom edge — kept
  // clear of the crowd-count dots that cluster along the top so the two numbers
  // never get mistaken for each other. `data-wait-badge` lets the cluster pass
  // rewrite it to a min–max range when this marker heads a group.
  const waitBadge =
    operating && a.standbyWait != null
      ? `<span data-wait-badge class="absolute -bottom-2 left-1/2 -translate-x-1/2 ${WAIT_CHIP_CLASS}">${waitChipInner(
          a.standbyWait,
          waitLabelFor(a),
          false,
        )}</span>`
      : "";
  const disc = discMarkup({
    url: a.meta?.imageThumbUrl ?? a.meta?.imageHeroUrl ?? null,
    hiResUrl: a.meta?.imageHeroUrl ?? null,
    alt: a.meta?.imageAlt ?? a.name,
    fallbackSvg: categoryIconSvg(a.category),
    ring: color,
    bg: color,
    px: 52,
    badge: waitBadge,
  });
  detail.innerHTML = `${disc}${labelMarkup(a.name, escapeHtml(waitLabelFor(a)))}`;
  applySelected(detail, selected);

  el.append(detail);
  return { el, detail };
}
