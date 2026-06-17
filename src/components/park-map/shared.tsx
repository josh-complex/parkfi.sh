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
} from "lucide-react";

import type { BoardItem } from "#/components/park-dashboard/types.ts";
import type { GeoPolygon } from "#/db/schema.ts";
import type { Feature, FeatureCollection, MultiPolygon, Polygon } from "geojson";

/** A renderer handle the map stage can poke to keep the canvas sized during the
 *  layout morph — the only capability the stage needs from either engine. */
export type MapHandle = { resize: () => void };

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

// Square (px) reserved around a full attraction marker for collision avoidance.
// Two markers whose projected centers fall within this on both axes can't both
// stay expanded; the lower-priority one collapses to a dot. Sized to the resting
// photo disc (size-9 = 36px) plus a hair of breathing room.
export const DECLUTTER_SIZE = 40;

// Ring highlight layered onto the selected attraction marker (no scale — the
// charted ride shouldn't balloon). Applied to the inner element, not the marker
// root whose transform the engine owns for positioning.
const SELECTED_CLASSES = ["ring-2", "ring-primary", "ring-offset-1"];

/**
 * Mark a marker selected/deselected: ring highlight on, and its hover label
 * suppressed (the charted ride is already identified — no need to expand it).
 */
export function applySelected(detail: HTMLElement, on: boolean): void {
  for (const c of SELECTED_CLASSES) detail.classList.toggle(c, on);
  detail.querySelector<HTMLElement>("[data-label]")?.classList.toggle("hidden", on);
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
 * Build the attraction popup body. Disney rides carry rich `meta` (hero image,
 * tags, height/land); Universal (and un-enriched rows) degrade to just the name +
 * live wait line — no broken image. Both engines' popups have a white background,
 * so fixed dark text (theme tokens would vanish in dark mode). The "More info"
 * link points at our own ride page (`rideHref`); the renderer intercepts its
 * click (marked `data-spa`) for client-side navigation.
 */
export function attractionPopupHtml(a: BoardItem, waitLabel: string, rideHref: string): string {
  const meta = a.meta;
  const hero =
    (meta?.imageHeroUrl ?? meta?.imageThumbUrl)
      ? `<img src="${escapeHtml((meta?.imageHeroUrl ?? meta?.imageThumbUrl)!)}" alt="${escapeHtml(
          meta?.imageAlt ?? a.name,
        )}" class="mb-1.5 h-24 w-full rounded object-cover" loading="lazy" />`
      : "";
  const tags =
    meta?.tags && meta.tags.length > 0
      ? `<div class="mt-1 flex flex-wrap gap-1">${meta.tags
          .map(
            (t) =>
              `<span class="rounded bg-neutral-100 px-1.5 py-0.5 text-[10px] font-medium text-neutral-600">${escapeHtml(
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
        `<div class="${i === 0 ? "mt-1 " : ""}text-[11px] text-neutral-500">${escapeHtml(bit as string)}</div>`,
    )
    .join("");
  const moreInfo = `<a href="${escapeHtml(
    rideHref,
  )}" data-spa class="mt-1.5 inline-block text-[11px] font-medium text-blue-600 hover:underline">More info →</a>`;
  return `<div class="w-44 px-0.5">${hero}<div class="text-xs font-semibold text-neutral-900">${escapeHtml(
    a.name,
  )}</div><div class="text-[11px] text-neutral-500">${waitLabel}</div>${tags}${detail}${moreInfo}</div>`;
}

// The wrapper that the cluster controller hides / translates / highlights: a
// disc-sized box (so the marker's footprint is just the photo, centered on the
// point) holding the photo plus an absolutely-positioned label that slides out on
// hover. `will-change-transform` keeps the spiderfy translate smooth.
const DETAIL_CLASS =
  "relative rounded-full transition-transform duration-200 will-change-transform";

/** A circular photo disc (white-bordered, colour-ringed) or, with no photo, the
 *  fallback icon disc. `badge` is optional overlay HTML (e.g. a ride's wait).
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
  const face = opts.url
    ? `<img src="${escapeHtml(opts.url)}" alt="${escapeHtml(
        opts.alt,
      )}" loading="lazy" class="size-full rounded-full border-2 border-white object-cover shadow-md ring-2" style="${ring}" />`
    : `<span class="flex size-full items-center justify-center rounded-full border-2 border-white text-white shadow-md ring-2" style="background:${opts.bg};${ring}">${opts.fallbackSvg}</span>`;
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
    px: 44,
  });
  const subtitle = `${p.operating} open · ${escapeHtml(wait)}`;
  const detail = document.createElement("div");
  detail.className = DETAIL_CLASS;
  detail.innerHTML = `${disc}${labelMarkup(p.name, subtitle)}`;
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
    px: 36,
    badge: waitBadge,
  });
  detail.innerHTML = `${disc}${labelMarkup(a.name, escapeHtml(waitLabelFor(a)))}`;
  applySelected(detail, selected);

  el.append(detail);
  return { el, detail };
}
