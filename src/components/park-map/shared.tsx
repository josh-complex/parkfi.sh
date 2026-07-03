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
export const DECLUTTER_SIZE = 44;

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
        `<div class="${i === 0 ? "mt-1.5 " : ""}text-[11px] text-muted-foreground">${escapeHtml(bit as string)}</div>`,
    )
    .join("");
  // "Directions" routes from the user's location to this attraction; the renderer
  // intercepts the click (marked `data-directions`) and reads the destination from
  // the data attributes. Only shown when we have coordinates to route to.
  const directions =
    a.latitude != null && a.longitude != null
      ? `<button type="button" data-directions data-lng="${a.longitude}" data-lat="${a.latitude}" class="inline-flex items-center gap-1 rounded-full bg-blue-600 px-2.5 py-1 text-[11px] font-medium text-white transition hover:bg-blue-700 active:scale-95">Directions</button>`
      : "";
  const moreInfo = `<a href="${escapeHtml(
    rideHref,
  )}" data-spa class="text-[13px] font-medium text-blue-600 hover:underline">More info →</a>`;
  const actions = `<div class="mt-3 flex items-center gap-2">${directions}${moreInfo}</div>`;
  return `<div class="text-[15px] font-semibold leading-tight text-card-foreground">${escapeHtml(
    a.name,
  )}</div><div class="mt-1 text-[12px] text-muted-foreground">${escapeHtml(
    waitLabel,
  )}</div>${tags}${detail}${actions}`;
}

// Expanded-card geometry (px). The disc grows in place into a CARD_W-wide photo
// header of CARD_HEADER_H tall; the body unfolds below it.
const CARD_W = 264;
const CARD_HEADER_H = 148;
const CARD_RADIUS = 16; // matches the card's rounded-2xl (1rem)
// Morph duration (ms): the disc→card container grow + body/close fade.
const CARD_MS = 360;
const CARD_EASE = "cubic-bezier(.16,1,.3,1)"; // smooth ease-out, no overshoot

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
    .filter((c): c is HTMLElement => c !== fill)
    .map((el) => ({ el, wasHidden: el.classList.contains("hidden") }));
  for (const b of badges) b.el.classList.add("hidden");

  // The details body, injected *inside* the wrap below the photo. Fixed to the
  // card width so its wrapped height is correct even while the wrap is still a
  // circle (it's clipped away below the fold until the card is tall enough).
  const card = document.createElement("div");
  card.className = "bg-card px-4 pt-3 pb-3.5";
  card.style.width = `${CARD_W}px`;
  card.style.opacity = "0";
  card.style.transition = "opacity 200ms ease 110ms";
  card.innerHTML = bodyHtml;
  card.addEventListener("click", (e) => e.stopPropagation());
  wrap.appendChild(card);
  const totalH = CARD_HEADER_H + card.offsetHeight;

  // Placement: header centered on the pin (grow in place), clamped on-screen.
  // Coords are detail-local — detail's box is the disc, its center the pin.
  const cRect = container.getBoundingClientRect();
  const dRect = detail.getBoundingClientRect();
  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(v, hi));
  const topLocal =
    clamp(
      dRect.top + size / 2 - CARD_HEADER_H / 2,
      cRect.top + 8,
      Math.max(cRect.top + 8, cRect.bottom - 8 - totalH),
    ) - dRect.top;
  const leftLocal =
    clamp(
      dRect.left + size / 2 - CARD_W / 2,
      cRect.left + 8,
      Math.max(cRect.left + 8, cRect.right - 8 - CARD_W),
    ) - dRect.left;

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
  const ringShadow = `0 0 0 3px ${ringColor}, 0 4px 6px -1px rgba(0,0,0,.12), 0 2px 4px -2px rgba(0,0,0,.12)`;
  const cardShadow = `0 0 0 0px transparent, 0 24px 48px -12px rgba(0,0,0,.28), 0 0 0 0 transparent`;

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
  });

  let closed = false;
  function close() {
    if (closed) return;
    closed = true;
    if (openCard === handle) openCard = null;
    onClose?.();
    // Reverse: collapse the container back to the disc; ring, radius, photo height
    // and body opacity all run back together.
    Object.assign(wrap.style, {
      left: "0px",
      top: "0px",
      width: `${size}px`,
      height: `${size}px`,
      borderRadius: `${size / 2}px`,
      boxShadow: ringShadow,
    });
    if (fill) fill.style.height = `${size}px`;
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
  alt: string;
  fallbackSvg: string;
  ring: string;
  bg: string;
  px: number;
  badge?: string;
}): string {
  const ring = `--tw-ring-color:${opts.ring}`;
  // `data-face-fill` tags the photo/icon face so the card animator can morph it
  // (border-radius + ring) as the disc flies up into the expanded card header.
  const face = opts.url
    ? `<img data-face-fill src="${escapeHtml(opts.url)}" alt="${escapeHtml(
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

/** The "you are here" marker: a solid blue dot with a soft pulsing halo. Built
 *  as plain DOM so both engines can drop it on the map like any other marker. */
export function buildUserLocationEl(): HTMLDivElement {
  const el = document.createElement("div");
  el.className = "relative flex size-4 items-center justify-center";
  el.setAttribute("aria-hidden", "true");
  el.innerHTML =
    '<span class="absolute inline-flex size-full animate-ping rounded-full bg-blue-500/40"></span>' +
    '<span class="relative inline-flex size-3.5 rounded-full border-2 border-white bg-blue-500 shadow-md"></span>';
  return el;
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
  const actions = link ? `<div class="mt-3 flex items-center gap-2">${link}</div>` : "";
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
  const color = waitColor(a.standbyWait, a.status);
  const operating = a.status === "OPERATING";

  const el = document.createElement("button");
  el.type = "button";
  el.setAttribute("aria-label", a.name);
  el.className = "group relative block cursor-pointer";

  // `detail` is the wrapper the controller clusters/translates/highlights: the
  // ride photo at rest, with a label that slides out on hover.
  const detail = document.createElement("div");
  detail.className = DETAIL_CLASS;
  const waitBadge =
    operating && a.standbyWait != null
      ? `<span class="absolute -top-1 -right-1 min-w-[1rem] rounded-full border border-white bg-neutral-900 px-1 text-center text-[9px] leading-[14px] font-bold text-white shadow">${a.standbyWait}</span>`
      : "";
  const disc = discMarkup({
    url: a.meta?.imageThumbUrl ?? a.meta?.imageHeroUrl ?? null,
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
