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

// Classes layered onto the selected attraction marker. Applied to the inner
// element (not the marker root, whose transform the engine owns for positioning).
export const SELECTED_CLASSES = ["scale-125", "ring-2", "ring-primary", "ring-offset-1"];

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

/** Placement priority for the declutter pass — busiest operating rides win a
 *  spot first; closed/no-wait rides yield to a collapsed dot. */
export function attractionPriority(a: BoardItem): number {
  return a.status === "OPERATING" ? 1000 + (a.standbyWait ?? 0) : 0;
}

/**
 * Build the attraction popup body. Disney rides carry rich `meta` (hero image,
 * tags, height/land, detail page); Universal (and un-enriched rows) degrade to
 * just the name + live wait line — no broken image. Both engines' popups have a
 * white background, so fixed dark text (theme tokens would vanish in dark mode).
 */
export function attractionPopupHtml(a: BoardItem, waitLabel: string): string {
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
  const detailBits = [meta?.heightRequirement, meta?.land].filter(Boolean) as Array<string>;
  const detail =
    detailBits.length > 0
      ? `<div class="mt-1 text-[11px] text-neutral-500">${detailBits
          .map(escapeHtml)
          .join(" · ")}</div>`
      : "";
  const moreInfo = meta?.detailUrl
    ? `<a href="${escapeHtml(
        meta.detailUrl,
      )}" target="_blank" rel="noreferrer" class="mt-1.5 inline-block text-[11px] font-medium text-blue-600 hover:underline">More info ↗</a>`
    : "";
  return `<div class="w-44 px-0.5">${hero}<div class="text-xs font-semibold text-neutral-900">${escapeHtml(
    a.name,
  )}</div><div class="text-[11px] text-neutral-500">${waitLabel}</div>${tags}${detail}${moreInfo}</div>`;
}

// The expanding "chip" that wraps every marker: a transparent rounded shell that
// holds just the circular photo at rest, and on hover (the root carries `group`)
// fades in a card background + slides out the detail panel. One class string so
// park badges and ride pins animate identically.
const CHIP_CLASS =
  "flex items-center rounded-full border border-transparent p-0.5 transition-all duration-200 ease-out group-hover:border-border group-hover:bg-card/95 group-hover:shadow-lg group-hover:backdrop-blur";

/** A circular photo disc (white-bordered, colour-ringed) or, with no photo, the
 *  fallback icon disc. `badge` is optional overlay HTML (e.g. a ride's wait). */
function discMarkup(opts: {
  url: string | null;
  alt: string;
  fallbackSvg: string;
  ring: string;
  bg: string;
  size: string;
  badge?: string;
}): string {
  const ring = `--tw-ring-color:${opts.ring}`;
  const face = opts.url
    ? `<img src="${escapeHtml(opts.url)}" alt="${escapeHtml(
        opts.alt,
      )}" loading="lazy" class="size-full rounded-full border-2 border-white object-cover shadow-md ring-2" style="${ring}" />`
    : `<span class="flex size-full items-center justify-center rounded-full border-2 border-white text-white shadow-md ring-2" style="background:${opts.bg};${ring}">${opts.fallbackSvg}</span>`;
  return `<span class="relative block ${opts.size} shrink-0">${face}${opts.badge ?? ""}</span>`;
}

/** The hover-revealed detail panel: clipped to zero width at rest, expands +
 *  fades in on `group-hover`. `subtitle` is pre-escaped/markup; `title` is plain. */
function labelMarkup(title: string, subtitle: string): string {
  return `<span class="flex max-w-0 flex-col items-start overflow-hidden whitespace-nowrap pl-0 leading-tight opacity-0 transition-all duration-200 ease-out group-hover:max-w-[14rem] group-hover:pl-2 group-hover:pr-1 group-hover:opacity-100"><span class="text-[11px] font-semibold text-card-foreground">${escapeHtml(
    title,
  )}</span><span class="text-[10px] text-muted-foreground">${subtitle}</span></span>`;
}

/**
 * One park badge for the overview map: just the park photo at rest, expanding on
 * hover to reveal the name + live "N open · Ym avg" line. The caller wires the
 * click (navigate) and a hover z-lift so the expanded panel clears its neighbors.
 */
export function buildParkBadgeEl(
  p: {
    name: string;
    slug: string;
    operatorSlug: string | null;
    operating: number;
    avgWait: number | null;
    imageUrl?: string | null;
    imageAlt?: string | null;
  },
  onClick: () => void,
): HTMLButtonElement {
  const el = document.createElement("button");
  el.type = "button";
  el.title = p.name;
  el.className = "group relative block cursor-pointer";
  const color = operatorColor(p.operatorSlug);
  const wait = p.avgWait != null ? `${p.avgWait}m avg` : "—";
  const disc = discMarkup({
    url: p.imageUrl ?? null,
    alt: p.imageAlt ?? p.name,
    fallbackSvg: parkIconSvg(p.slug, p.operatorSlug),
    ring: color,
    bg: color,
    size: "size-11",
  });
  const subtitle = `${p.operating} open · ${escapeHtml(wait)}`;
  el.innerHTML = `<div class="${CHIP_CLASS}">${disc}${labelMarkup(p.name, subtitle)}</div>`;
  el.addEventListener("click", onClick);
  return el;
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
): { el: HTMLButtonElement; detail: HTMLDivElement; dot: HTMLDivElement } {
  const color = waitColor(a.standbyWait, a.status);
  const operating = a.status === "OPERATING";

  const el = document.createElement("button");
  el.type = "button";
  el.title = a.name;
  el.className = "group relative block cursor-pointer";

  // `detail` IS the expanding chip (decluttered in/out and highlighted on
  // select): the ride photo at rest, expanding on hover to its name + wait line.
  const detail = document.createElement("div");
  detail.className = CHIP_CLASS;
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
    size: "size-9",
    badge: waitBadge,
  });
  detail.innerHTML = `${disc}${labelMarkup(a.name, escapeHtml(waitLabelFor(a)))}`;
  if (selected) detail.classList.add(...SELECTED_CLASSES);

  const dot = document.createElement("div");
  dot.className = "hidden size-2.5 rounded-full border border-white shadow transition-transform";
  dot.style.background = color;

  el.append(detail, dot);
  return { el, detail, dot };
}
