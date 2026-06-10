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
// stay expanded; the lower-priority one collapses to a dot.
export const DECLUTTER_SIZE = 34;

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

/** One park badge for the overview map. The caller wires the click (navigate). */
export function buildParkBadgeEl(
  p: {
    name: string;
    slug: string;
    operatorSlug: string | null;
    operating: number;
    avgWait: number | null;
  },
  onClick: () => void,
): HTMLButtonElement {
  const el = document.createElement("button");
  el.type = "button";
  el.title = p.name;
  el.className =
    "flex cursor-pointer items-center gap-1.5 rounded-full border border-border bg-card/95 py-1 pr-2.5 pl-1 shadow-md backdrop-blur transition-transform hover:scale-105";
  const wait = p.avgWait != null ? `${p.avgWait}m avg` : "—";
  el.innerHTML = `<span class="flex size-6 shrink-0 items-center justify-center rounded-full text-white shadow-inner" style="background:${operatorColor(
    p.operatorSlug,
  )}">${parkIconSvg(p.slug, p.operatorSlug)}</span><span class="flex flex-col items-start leading-none"><span class="text-[11px] font-semibold text-card-foreground">${escapeHtml(
    p.name,
  )}</span><span class="text-[10px] text-muted-foreground">${p.operating} open · ${wait}</span></span>`;
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
  el.className = "block cursor-pointer";

  const detail = document.createElement("div");
  detail.className =
    "relative flex size-7 items-center justify-center rounded-full border-2 border-white text-white shadow-md transition-transform hover:scale-110";
  detail.style.background = color;
  const waitBadge =
    operating && a.standbyWait != null
      ? `<span class="absolute -top-1.5 -right-1.5 min-w-[1rem] rounded-full border border-white bg-neutral-900 px-1 text-center text-[9px] leading-[14px] font-bold text-white shadow">${a.standbyWait}</span>`
      : "";
  detail.innerHTML = `${categoryIconSvg(a.category)}${waitBadge}`;
  if (selected) detail.classList.add(...SELECTED_CLASSES);

  const dot = document.createElement("div");
  dot.className = "hidden size-2.5 rounded-full border border-white shadow transition-transform";
  dot.style.background = color;

  el.append(detail, dot);
  return { el, detail, dot };
}
