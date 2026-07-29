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
  MapPinIcon,
  PopcornIcon,
  RocketIcon,
  RollerCoasterIcon,
  ShoppingBagIcon,
  SmileIcon,
  SparklesIcon,
  TicketIcon,
  TreesIcon,
  UserIcon,
  UtensilsIcon,
  WavesIcon,
  XIcon,
} from "lucide-react";

import {
  formatPriceCents,
  paidLineInfo,
  paidLineProduct,
} from "#/components/park-dashboard/lightning-lane.ts";

import {
  attractionMarkerKey,
  parkMarkerKey,
  poiMarkerKey,
  type CardFlightNodes,
} from "#/components/park-map/card-flight.ts";
import { cfImagesStore } from "#/integrations/posthog/feature-flags.ts";
import { cfImageUrl } from "#/lib/image.ts";
import { formatParkName } from "#/lib/parks.ts";
import { capacityLabel, type CapacityLevel } from "#/lib/ticket-scarcity.ts";
import { pointInPolygon } from "#/server/living/geofence.ts";

import type { MapLayers } from "#/components/rides/ride-filter.tsx";
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
   *  "Start"/"recenter" close-up. `tilt` engages the walking-nav framing (pitched
   *  camera, puck dropped to the lower third). Leaflet ignores `bearing`/`tilt`
   *  (it can't rotate or pitch). */
  flyToLocation: (
    coords: [number, number],
    opts?: { zoom?: number; bearing?: number; duration?: number; tilt?: boolean },
  ) => void;
  /** Rotate the map to a compass bearing (degrees), optionally pitching for the
   *  nav view (`tilt`). No-op on Leaflet. */
  setBearing: (bearing: number, opts?: { duration?: number; tilt?: boolean }) => void;
  /** Frame the whole route flat + north-up — the nav "overview" peek. Returns to
   *  follow via the recenter button. No-op for a degenerate route. */
  fitRoute: (coords: Array<[number, number]> | null) => void;
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
// The stage's hero⇄card morph duration. The renderers wait this long after a
// navigation before flying so the shared-map box has finished morphing to its
// destination size — fitBounds reads the container's pixel dimensions, so
// flying before the box settles frames the view for the wrong size. Layout
// first, then zoom.
export { MORPH_MS } from "./map-morph.ts";

// Center-to-center px radius reserved around a full marker for collision
// avoidance. Two markers whose projected centers fall within this of each other
// can't both stay expanded; the lower-priority one is absorbed into the anchor's
// cluster (a tap on which zooms in). Sized a touch past the photo disc (52px) so
// markers group as soon as their discs overlap — including diagonal neighbors the
// old axis-aligned box test left ~1.4× further out and un-merged (which let a
// near-coincident marker sit atop a cluster and steal its tap). A cluster tap
// still zooms in enough to split them.
export const DECLUTTER_SIZE = 64;

// At/above this zoom a park view stops clustering entirely and switches to the
// "spread" layout — every marker stays visible, overlapping ones just nudge
// apart. By this depth pins are close to their true spots, so a group badge is
// more annoying than the slight nudge, and the user can zoom that last bit to
// separate them fully.
export const SPREAD_ZOOM = 19;

// Declutter radius at the tightest cluster-mode zoom. Far out, pins are jammed
// together and want the full DECLUTTER_SIZE grouping berth; but as a park view
// closes in on SPREAD_ZOOM, rides that are genuinely a few metres apart are
// spread wide enough on screen to stand on their own — a wide berth there just
// swallows a distinct ride into its neighbour. Sized under the photo disc (52px)
// so near-but-separate discs stay separate anchors (relax still nudges any true
// overlap apart).
export const DECLUTTER_SIZE_MIN = 34;

// Effective declutter radius for the current zoom: the full berth until the last
// couple levels before spread mode, then a linear ramp down to DECLUTTER_SIZE_MIN
// right at SPREAD_ZOOM. Only park-view clustering uses this; overview spread never
// groups so its radius is immaterial.
export function declutterSizeForZoom(zoom: number): number {
  const rampStart = SPREAD_ZOOM - 2;
  if (zoom <= rampStart) return DECLUTTER_SIZE;
  const t = Math.min(1, (zoom - rampStart) / (SPREAD_ZOOM - rampStart));
  return Math.round(DECLUTTER_SIZE + (DECLUTTER_SIZE_MIN - DECLUTTER_SIZE) * t);
}

// Ring highlight layered onto the selected attraction marker (no scale — the
// charted ride shouldn't balloon). Applied to the inner element, not the marker
// root whose transform the engine owns for positioning.
const SELECTED_CLASSES = ["ring-2", "ring-primary", "ring-offset-1"];

/**
 * Mark a marker selected/deselected: ring highlight on. While a marker's card is
 * expanded (`data-card-open`) the ring is suppressed — the card itself is the
 * selection indicator, and the disc has flown up into the card header, so a ring
 * around the empty footprint would just float untethered.
 */
export function applySelected(detail: HTMLElement, on: boolean): void {
  const open = detail.hasAttribute("data-card-open");
  for (const c of SELECTED_CLASSES) detail.classList.toggle(c, on && !open);
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
  "quick-service": PopcornIcon,
  shop: ShoppingBagIcon,
  character: SmileIcon,
  info: InfoIcon,
  // POI overlay categories (park_poi): entertainment (parades/fireworks/shows)
  // and hard-ticket events + tours. Guest services use `info`; character meets
  // reuse `character`.
  entertainment: SparklesIcon,
  tour: TicketIcon,
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

// The pill look every marker chip shares (wait / name / capacity) minus the
// display mode, so each chip can pick its own box while staying pixel-identical.
const PILL_CLASS =
  "whitespace-nowrap rounded-full border border-white bg-neutral-900 px-1.5 py-0.5 text-[10px] leading-none font-bold text-white shadow";

// The live wait pill's appearance, shared verbatim by the marker badge (anchored
// under the disc) and the expanded card's wait line, so the chip that flies from
// one to the other on expand is pixel-identical at both ends. Positioning classes
// (`absolute -bottom-2 …`) live only on the marker instance.
const WAIT_CHIP_CLASS = `inline-flex items-center ${PILL_CLASS}`;

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

// The name chip's resting clamp: a long name is ellipsised at 7.5rem so it stays
// a compact one-line pill. Hover opens it to the name's *measured* width instead
// of a second class (see `wireNameChipHover`) — a `group-hover:max-w-…` cap would
// only look smooth in one direction, because the pill's used width is
// min(text, cap): easing the cap from 7.5rem up to some generous ceiling races
// past the text width in the first frames (a pop), while easing it back down
// doesn't start moving the pill until the cap dips under the text again. An
// exact target makes both directions the same 200ms glide.
const NAME_CHIP_WIDTH_CLASS = "max-w-[7.5rem] transition-[max-width] duration-200 ease-out";

// Ceiling for the hover-opened pill: never wider than 16rem, nor 60% of the
// viewport, so a very long name can't run off a narrow map.
const NAME_CHIP_MAX_PX = 256;
const NAME_CHIP_MAX_VW = 0.6;

/**
 * Ease a name chip open to exactly the width its full name needs, or leave it
 * alone when nothing is actually clipped. The inner span is looked up per call,
 * never captured: the card morph replaces it (`textContent = fullName`) and
 * `finalize` rebuilds it from saved markup, so a reference held across an
 * open/close cycle points at a detached node that measures 0 — which read as
 * "nothing clipped" and killed hover for the rest of the marker's life.
 */
function expandNameChip(chip: HTMLElement): void {
  const inner = chip.firstElementChild;
  if (!(inner instanceof HTMLElement)) return;
  // Full pill width = the name's unclipped text width + the pill's own chrome
  // (padding + border). `scrollWidth` rounds to an integer, so allow a pixel of
  // slop before deciding a chip is clipped at all.
  const full = inner.scrollWidth + (chip.offsetWidth - inner.offsetWidth);
  if (full <= chip.offsetWidth + 1) return; // nothing clipped — nothing to open
  chip.style.maxWidth = `${Math.min(full + 1, NAME_CHIP_MAX_PX, window.innerWidth * NAME_CHIP_MAX_VW)}px`;
}

/**
 * Open a marker's name chip on hover, collapse it on exit. Pointer devices only
 * — `(hover: hover)` is checked live so a touch tap (which synthesizes a
 * `mouseenter`) never sticks a marker open. An open card's flown title is left
 * alone in both directions: it's mid-morph on its own inline geometry, and
 * clearing its width there would clamp the flying card title (see
 * `openAttractionCard`, which re-opens the chip itself on close if the pointer
 * never left).
 *
 * Takes `detail` (which owns the chip) separately from the hover target `el`,
 * because the builders wire this up *before* they append `detail` to `el` — a
 * lookup through `el` would find nothing and silently no-op.
 */
function wireNameChipHover(el: HTMLElement, detail: HTMLElement): void {
  const chip = detail.querySelector<HTMLElement>("[data-name-chip]");
  if (!chip) return;
  el.addEventListener("mouseenter", () => {
    if (!window.matchMedia("(hover: hover)").matches) return;
    if (chip.closest("[data-card-open]")) return;
    expandNameChip(chip);
  });
  el.addEventListener("mouseleave", () => {
    if (chip.closest("[data-card-open]")) return;
    chip.style.maxWidth = ""; // back to the resting class clamp, same easing
  });
}

/**
 * A persistent name pill under a marker — same pill design as the wait chip
 * (`PILL_CLASS`). When the marker carries a wait badge (`underWait`) the name
 * stacks right beneath it (`top-full mt-2`); with no wait badge it takes the wait
 * badge's own slot (`-bottom-2`) so the label never floats lower than a
 * neighbour's. The full name is always in the DOM — the clamp is CSS (`max-width`
 * + ellipsis on the inner span), so hover (`wireNameChipHover`) just eases that
 * clamp open instead of revealing a second element. The chip stays centred as it grows
 * (`-translate-x-1/2`), and the marker's hover z-lift (`makeRaise`) keeps the
 * widened pill above its neighbours. `pointer-events-none` so an overhanging
 * label never eats a map drag or a click meant for a neighbour. Lives inside the
 * disc wrap as a badge, so the card-morph's badge-hiding (see
 * `openAttractionCard`) tucks it away on expand.
 */
function nameChipMarkup(name: string, underWait: boolean): string {
  const pos = underWait ? "top-full mt-2" : "-bottom-2";
  return `<span data-name-chip class="pointer-events-none absolute ${pos} left-1/2 -translate-x-1/2 ${NAME_CHIP_WIDTH_CLASS} ${WAIT_CHIP_CLASS}"><span class="min-w-0 overflow-hidden text-ellipsis">${escapeHtml(
    name,
  )}</span></span>`;
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
export type MapItemKind =
  | "rides"
  | "shows"
  | "shops"
  | "eats"
  | "quickService"
  | "services"
  | "entertainment"
  | "tours";
export const MAP_TYPE_COLOR: Record<MapItemKind, string> = {
  rides: "#2563eb", // blue
  shows: "#e11d48", // rose
  shops: "#9333ea", // violet — matches the shop POI ring
  eats: "#d97706", // amber — matches the dining POI ring
  quickService: "#ea580c", // orange — walk-up quick service + snack carts/kiosks
  services: "#0d9488", // teal — guest-service POIs
  entertainment: "#c026d3", // fuchsia — parades/fireworks/character-meet POIs
  tours: "#059669", // emerald — events + tours POIs
};

// Attraction categories that roll up into the "Shows" group; everything else
// attraction-y (thrill / attraction / water) is a "ride".
const SHOW_KIND_CATEGORIES = new Set(["show", "character"]);

/** Which toggle group an attraction row belongs to ("Rides" vs "Shows"). */
export function attractionKind(category: string | null): MapItemKind {
  return category && SHOW_KIND_CATEGORIES.has(category) ? "shows" : "rides";
}

/**
 * Which toggle group a POI belongs to — drives the cluster overflow-dot colour.
 * Dining venues (`dine`, plus dining character spots keyed `characters`) are
 * "eats"; non-bookable walk-up dining (`quick-service` — counter-service
 * restaurants and snack carts/kiosks) is its own "quickService" group; shops
 * "shops"; and the `park_poi` overlays map to their own groups: guest services
 * (`info`) → services, character meets (`character`, singular) + `entertainment`
 * → entertainment, `tour` → tours.
 */
export function poiKind(category: string): MapItemKind {
  switch (category) {
    case "shop":
      return "shops";
    case "quick-service":
      return "quickService";
    case "info":
      return "services";
    case "tour":
      return "tours";
    case "entertainment":
    case "character":
      return "entertainment";
    default:
      return "eats";
  }
}

/**
 * How long the resort-wide POI feeds (dining / shops / park_poi) stay fresh in
 * the client cache. They're slow-moving catalogs, so a long window keeps them
 * from refetching as the user roams between parks. Shared so every observer of
 * these queries — both renderers *and* the chip row that counts them — agrees;
 * a shorter staleTime on any one of them would refetch the whole feed on mount.
 */
export const POI_STALE_MS = 30 * 60 * 1000;

// The ride categories each on-map chip stands for. "Rides" folds the three
// ride-type markers (coasters, flat/dark rides, water rides) into one toggle;
// "Shows" folds stage shows and character meets together. Kept as the single
// source of truth for the seeded roam-map default, the chip's active/toggle
// logic, and the renderers' show-marker gate.
export const RIDE_CATEGORY_KEYS = ["thrill", "attraction", "water"] as const;
export const SHOW_CATEGORY_KEYS = ["show", "character"] as const;

/** Is a chip's whole category group selected? (A group toggles as one unit.) */
export function categoryGroupLit(
  keys: ReadonlyArray<string>,
  categories: ReadonlySet<string>,
): boolean {
  return keys.every((k) => categories.has(k));
}

/**
 * Does the Shows chip currently draw? It gates two marker sources: show-
 * categorised ATTRACTION rows (plain markers, via `rideMatchesFilter`) and the
 * board's SHOW entities (showtime markers). The latter used to hang off the Live
 * layer, which left Shows drawing nothing at nine of ten parks — every show but
 * a handful is a SHOW row. Live now means what its feed is: the entertainment /
 * character `park_poi` pins.
 *
 * Deliberately literal about the chip rather than following `rideMatchesFilter`'s
 * "empty set = every category" convention: an empty filter is the park
 * dashboard's resting state, where these markers have never drawn, and reading it
 * as "all" would push showtime pins onto every park map nobody asked for.
 */
export function showsLit(filter: { categories: ReadonlySet<string> } | null | undefined): boolean {
  return !!filter && categoryGroupLit(SHOW_CATEGORY_KEYS, filter.categories);
}

/** Every chip in the map's toggle row: the two category groups, then the layers. */
export type MapToggleKey = "rides" | "shows" | keyof MapLayers;

/**
 * Which toggle chips have something to draw for the focused park — so a chip is
 * never offered over an empty layer (Tours at Islands of Adventure, Live/Tours
 * at the Disney water parks, every layer at a park we hold no boundary for).
 *
 * Mirrors what the renderers' marker pass actually plots: ride/show markers come
 * straight off the park-scoped board, while the POI layers are resort-wide feeds
 * clipped to the park boundary — so no boundary means no POI markers at all, and
 * all four layer chips drop. Shows counts both of its sources (show-categorised
 * ATTRACTION rows and SHOW rows with times today); it doesn't subtract the Live
 * POIs those showtime markers supersede, which can only over-count inside a chip
 * that already has something in it, never conjure one from nothing.
 *
 * A feed that hasn't loaded yet is `undefined`, and its chips stay visible — the
 * row settles by removing chips, rather than popping them in as each feed lands.
 */
export function availableMapToggles(input: {
  boundary: GeoPolygon | null;
  board: ReadonlyArray<BoardItem> | undefined;
  dining: ReadonlyArray<PoiItem> | undefined;
  shops: ReadonlyArray<PoiItem> | undefined;
  poi: ReadonlyArray<PoiItem> | undefined;
}): ReadonlySet<MapToggleKey> {
  const { boundary, board, dining, shops, poi } = input;
  const out = new Set<MapToggleKey>();
  const inside = (p: { latitude: number | null; longitude: number | null }) =>
    p.latitude != null &&
    p.longitude != null &&
    pointInPolygon([p.longitude, p.latitude], boundary);

  if (!board) {
    out.add("rides");
    out.add("shows");
  } else {
    for (const a of board) {
      if (a.latitude == null || a.longitude == null) continue;
      // Shows reach the map two ways, both under the Shows chip: a show-
      // categorised ATTRACTION row draws a plain marker, and a SHOW row draws a
      // showtime marker (only once it has times today — a dark act isn't
      // advertised, so it doesn't count as something the chip can draw).
      if (a.entityType === "ATTRACTION") {
        // An un-enriched duplicate carries no category and matches no chip.
        if (a.category) out.add(attractionKind(a.category) === "shows" ? "shows" : "rides");
      } else if (a.entityType === "SHOW" && a.showtimes.length > 0 && inside(a)) {
        out.add("shows");
      }
    }
  }

  // Every POI layer is boundary-clipped, so an unmapped park offers none of them.
  if (!boundary) return out;
  for (const p of dining ?? []) {
    if (inside(p)) out.add(p.category === "quick-service" ? "quickService" : "dining");
  }
  if (shops?.some(inside)) out.add("shops");
  for (const p of poi ?? []) {
    if (!inside(p)) continue;
    if (p.category === "info") out.add("services");
    else if (p.category === "tour") out.add("tours");
    else if (p.category === "entertainment" || p.category === "character") out.add("entertainment");
  }
  // Keep an unloaded feed's chips up rather than blinking them in behind it.
  if (!dining) {
    out.add("dining");
    out.add("quickService");
  }
  if (!shops) out.add("shops");
  if (!poi) {
    out.add("services");
    out.add("tours");
    out.add("entertainment");
  }
  return out;
}

/**
 * Build the *body* of the expanded attraction card — everything below the photo
 * header (which is the marker's own disc, flown up by `openAttractionCard`, so
 * there's no separate hero image here). Both operators carry rich `meta` (tags,
 * height/land) now that UOR heights and ride types are ingested; un-enriched
 * rows degrade to just the name + live wait line. The card lives in our themed
 * DOM (not a white map popup), so it uses
 * theme tokens and reads correctly in dark mode. There's no in-body link — the
 * whole card is a button (see `openAttractionCard` `onPress`) that navigates to
 * our ride page; the action row carries the Directions button and the walk-time
 * slot (filled by `wireCardWalkTime`).
 */
/**
 * The in-card "Directions" button. Routes from the user's location to the point;
 * the renderer intercepts the click (marked `data-directions`) and reads the
 * destination from the data attributes. Empty string when we have no coordinates
 * to route to. A 3D-embossed button matching our `Button` primitive (border-3d /
 * shadow-3d), in blue. Hand-written classes rather than the React <Button>
 * because the card body is injected HTML.
 */
export function directionsButtonHtml(lng: number | null, lat: number | null): string {
  if (lng == null || lat == null) return "";
  return `<button type="button" data-directions data-lng="${lng}" data-lat="${lat}" class="relative top-0 inline-flex shrink-0 items-center justify-center rounded-full border-3d shadow-3d min-h-8 px-3.5 py-1 text-[12px] font-semibold leading-tight whitespace-nowrap text-white outline-none select-none bg-blue-600 hover:bg-blue-500 [--btn-3d:var(--color-blue-800)] [--btn-glare:oklch(1_0_0_/_0.28)] transition-[box-shadow,top,background-color] duration-150 ease-out hover:-top-px hover:shadow-3d-hover active:top-[3px] active:[--btn-glare:var(--btn-3d)] active:shadow-3d-active">Directions</button>`;
}

/**
 * The walk-time slot for the action row — it takes the place the "More info" /
 * "Details" link used to occupy. Starts empty and invisible; `wireCardWalkTime`
 * fills it and eases it in once the route estimate resolves, so the number
 * fades/rises into place instead of popping (§4.1).
 */
const walkSlotHtml = `<span data-walk-time class="text-[13px] font-medium whitespace-nowrap text-muted-foreground translate-y-1 opacity-0 transition-[opacity,transform] duration-300 ease-out"></span>`;

/** Walk-duration copy for the in-card estimate — minutes under an hour, hours +
 *  minutes past it (a cross-resort "195 min walk" reads as a typo). */
function formatWalkEstimate(s: number): string {
  const mins = Math.max(1, Math.round(s / 60));
  if (mins < 60) return `${mins} min walk`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m === 0 ? `${h} hr walk` : `${h} hr ${m} min walk`;
}

/**
 * Fill a card's walk-time slot (in the action row, where "More info" used to be)
 * once the route estimate resolves (§4.1). The fetch is fired as the card opens
 * — the same query the Directions preview runs, so the tap that follows hits a
 * warm cache. The slot starts empty + invisible and eases in on arrival, so the
 * number fades/rises into place instead of popping. Best-effort: on failure (or
 * a card closed before the estimate lands) the slot simply stays hidden.
 */
export function wireCardWalkTime(
  card: HTMLElement,
  estimate: Promise<{ durationSeconds: number } | null>,
): void {
  const slot = card.querySelector<HTMLElement>("[data-walk-time]");
  if (!slot) return;
  void estimate
    .then((r) => {
      if (!r || r.durationSeconds <= 0 || !slot.isConnected) return;
      slot.textContent = formatWalkEstimate(r.durationSeconds);
      // Ease it in from its resting-invisible state (translate-y-1 / opacity-0).
      slot.classList.remove("translate-y-1", "opacity-0");
    })
    .catch(() => {
      /* no estimate — the slot stays hidden */
    });
}

/**
 * The paid-line row for the attraction card — Disney Lightning Lane (Multi /
 * Single) or Universal's Express/Virtual Line. Renders the product label, the
 * live state pill, any à-la-carte price, and the LL tier, mirroring the board's
 * `PaidLineCell` so the map card and the board tell the same story. Empty string
 * when the ride carries no paid line (a Universal ride with no Virtual Line, or
 * an un-enriched row), so the card simply omits the row.
 */
function paidLineCardHtml(a: BoardItem, operatorSlug: string | null): string {
  const ll = paidLineInfo(a, operatorSlug);
  // Universal publishes Express eligibility per ride, independently of whether
  // the ride has a Virtual Line — so an Express ride with no virtual queue
  // (36 of them) still earns this row.
  const expressHtml =
    ll.expressPass === true
      ? `<span class="rounded-md border px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">Express</span>`
      : "";
  if (!ll.has) {
    return expressHtml
      ? `<div class="mt-2 flex flex-wrap items-center gap-1.5 text-[12px]">${expressHtml}</div>`
      : "";
  }
  const price = formatPriceCents(ll.priceCents, a.lightningLane.currency);
  // Sold out reads destructive; any other live state reads as the secondary
  // chip; a capability-only line with no posted state reads as a plain "offered".
  const pill = ll.state
    ? `<span class="rounded-md px-1.5 py-0.5 text-[10px] font-semibold ${
        ll.soldOut ? "bg-destructive/15 text-destructive" : "bg-secondary text-secondary-foreground"
      }">${escapeHtml(ll.state.toLowerCase().replace("_", " "))}</span>`
    : `<span class="rounded-md border px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">offered</span>`;
  const priceHtml = price
    ? `<span class="tabular-nums font-medium text-card-foreground">${escapeHtml(price)}</span>`
    : "";
  const kindHtml = ll.kind
    ? `<span class="text-[10px] uppercase text-muted-foreground">${escapeHtml(ll.kind)}</span>`
    : "";
  return `<div class="mt-2 flex flex-wrap items-center gap-1.5 text-[12px]"><span class="font-medium text-muted-foreground">${escapeHtml(
    paidLineProduct(operatorSlug),
  )}</span>${pill}${priceHtml}${kindHtml}${expressHtml}</div>`;
}

// Most tag chips a card shows inline before the rest collapse into a "+N"
// counter — keeps the tag row to a single line instead of wrapping to a fourth.
const MAX_CARD_TAGS = 3;
// Small leading icons for the detail lines, rendered once: a person for the
// height requirement, a pin for the land/location.
const HEIGHT_LINE_ICON = renderToStaticMarkup(
  <UserIcon width={12} height={12} strokeWidth={2} className="shrink-0" />,
);
const LAND_LINE_ICON = renderToStaticMarkup(
  <MapPinIcon width={12} height={12} strokeWidth={2} className="shrink-0" />,
);

/** One muted detail line (height / land) with a leading icon. */
function detailLineHtml(icon: string, text: string, marginTop: string): string {
  return `<div class="${marginTop} flex items-center gap-1 text-[11px] text-muted-foreground"><span class="flex text-muted-foreground/80">${icon}</span><span>${escapeHtml(
    text,
  )}</span></div>`;
}

export function attractionCardBodyHtml(
  a: BoardItem,
  waitLabel: string,
  operatorSlug: string | null,
): string {
  const meta = a.meta;
  // Cap the tag row at MAX_CARD_TAGS chips; any beyond collapse into a single
  // "+N" chip so the row never wraps to a fourth line.
  const tags =
    meta?.tags && meta.tags.length > 0
      ? (() => {
          const shown = meta.tags.slice(0, MAX_CARD_TAGS);
          const extra = meta.tags.length - shown.length;
          const chip = (t: string) =>
            `<span class="rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">${escapeHtml(
              t,
            )}</span>`;
          const overflow =
            extra > 0
              ? `<span class="rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">+${extra}</span>`
              : "";
          return `<div class="mt-1.5 flex flex-wrap gap-1">${shown.map(chip).join("")}${overflow}</div>`;
        })()
      : "";
  // Height requirement first (person icon), then the land/location below it (pin).
  const heightLine = meta?.heightRequirement
    ? detailLineHtml(HEIGHT_LINE_ICON, meta.heightRequirement, "mt-1")
    : "";
  const landLine = meta?.land
    ? detailLineHtml(LAND_LINE_ICON, meta.land, heightLine ? "mt-0.5" : "mt-1")
    : "";
  const detail = heightLine + landLine;
  const directions = directionsButtonHtml(a.longitude, a.latitude);
  // The whole card is the button to the ride page now (see `openAttractionCard`
  // `onPress`); where "More info" used to sit, the walk time eases in instead.
  const actions = `<div class="mt-2.5 flex items-center gap-2">${directions}${walkSlotHtml}</div>`;
  // The wait line only renders in the body when there's *no* live posted wait
  // (closed / down / no standby). When a live wait exists, the marker's chip
  // flies up and settles as an overlay badge over the photo header (see
  // `openAttractionCard`), so nothing is shown here for it.
  const minutes = a.status === "OPERATING" && a.standbyWait != null ? a.standbyWait : null;
  const waitLine =
    minutes != null
      ? ""
      : `<div class="mt-0.5 text-[12px] text-muted-foreground">${escapeHtml(waitLabel)}</div>`;
  const paidLine = paidLineCardHtml(a, operatorSlug);
  // `data-name-target` is the landing slot for the marker's name pill, which flies
  // up and restyles into this title on expand (see `openAttractionCard`).
  return `<div data-name-target class="text-[15px] font-semibold leading-tight text-card-foreground">${escapeHtml(
    a.name,
  )}</div>${waitLine}${paidLine}${tags}${detail}${actions}`;
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
// The live-wait chip's overlay resting spot on the photo header (inset px from
// the card's top-left) and the little swell it does once the open morph settles.
const WAIT_OVERLAY_INSET = 8;
const WAIT_GROW = 1.16; // scale the chip grows to as it flies into its overlay spot

/** The single card currently expanded (across both engines), so opening one — or
 *  any other interaction — collapses the previous first. */
let openCard: { close: () => void } | null = null;

/**
 * Per-marker "finish the close right now" hooks. `close()` restores the disc's
 * resting DOM on a `CARD_MS` timer (it waits for the collapse animation). If the
 * *same* marker is re-tapped inside that window, its restore hasn't run yet — the
 * wrap is still mid-collapse (`overflow:hidden`, transient inline geometry). A
 * fresh open would then snapshot that transient state as the disc's "resting"
 * look and write it back on the next close, leaving the disc overflow-clipped for
 * good (chips cut off). So `openAttractionCard` runs this finalizer synchronously
 * first, settling the marker to its true resting state before it snapshots.
 */
const pendingClose = new WeakMap<HTMLElement, () => void>();

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
 * The whole card is a button: tapping anywhere on it (except the close button
 * and the in-card Directions button, which stops its own click) fires `onPress`;
 * the returned `card` (the details body) is where the renderer wires the
 * `data-directions` click; `close()` reverses the morph.
 */
export function openAttractionCard(opts: {
  detail: HTMLElement;
  container: HTMLElement;
  bodyHtml: string;
  /** Was this marker already ring-selected before we opened? Restored on close. */
  wasSelected: boolean;
  /** Fired once when the card begins closing — e.g. to drop the marker's z-lift. */
  onClose?: () => void;
  /** Fired when the card is tapped as a button (opens the detail page). Handed
   *  the card's shared elements (photo header, wait chip, title) so the press
   *  can fly them on to the destination page's hero — see `card-flight.ts`. */
  onPress?: (nodes: CardFlightNodes) => void;
}): { card: HTMLElement; close: () => void } {
  openCard?.close();

  const { detail, container, bodyHtml, wasSelected, onClose, onPress } = opts;
  // If this exact marker is still mid-close from a previous card, its resting DOM
  // hasn't been restored yet — finish that restore synchronously now, so the
  // snapshots below capture the true resting disc and not the collapsing wrap's
  // transient inline styles (which would otherwise get written back for good).
  pendingClose.get(detail)?.();
  const wrap = detail.firstElementChild as HTMLElement; // the disc wrapper → the card
  // A marker still mid fade-in (wireMarkerFadeIn) carries an inline opacity < 1
  // and its own transition on the wrap; force it opaque and drop that transition
  // before we snapshot, so neither the card nor the restored disc inherits a
  // half-faded look (the card's own morph sets the transition it needs below).
  wrap.style.opacity = "1";
  wrap.style.transition = "";
  const fill = wrap.querySelector<HTMLElement>("[data-face-fill]"); // photo / icon face
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

  // The name pill is the *other* shared element: it flies from under the disc up to
  // the card's title slot and restyles from the compact dark pill into the big card
  // name (see the name-chip flight below). Snapshot it and its resting box now,
  // before the disc mutates, plus everything needed to drop it back on close. Its
  // resting *markup* is remembered (not just the text) because the chip clamps its
  // name with an inner ellipsised span — the flight replaces that with the bare
  // full name, so close has to put the span back, not a flat string.
  const nameEl = wrap.querySelector<HTMLElement>("[data-name-chip]");
  const nameStart = nameEl?.getBoundingClientRect() ?? null;
  const nameChipHtml = nameEl?.innerHTML ?? "";
  // On a pointer device the marker is *hovered* at the moment it's clicked, so the
  // chip usually carries the hover-opened inline `max-width` (`expandNameChip`).
  // Drop it now that its box is measured: otherwise the snapshot below preserves
  // that one name's width and `finalize` writes it back as a permanent override.
  if (nameEl) nameEl.style.maxWidth = "";
  const nameRestore = nameEl
    ? {
        next: nameEl.nextSibling,
        style: nameEl.getAttribute("style") ?? "",
        cls: nameEl.className,
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
    .filter((c): c is HTMLElement => c !== fill && c !== waitEl && c !== nameEl)
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
  wrap.appendChild(card);
  const totalH = CARD_HEADER_H + card.offsetHeight;

  // Placement: the card always settles in the center of the map, so every button
  // (Directions / walk time) is on-screen regardless of where the pin sits — the
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
  // travel cleanly from its resting spot under the disc up to its overlay resting
  // spot on the photo header (top-left, inset WAIT_OVERLAY_INSET). It's
  // `pointer-events-none` so a tap over it presses the card beneath. Once the open
  // morph settles, the chip does a small swell (WAIT_GROW) as a final flourish.
  let flyWait: (() => void) | undefined;
  let unflyWait: (() => void) | undefined;
  if (waitEl && waitStart) {
    const startLeft = waitStart.left - dRect.left;
    const startTop = waitStart.top - dRect.top;
    // Overlay resting spot: the card's final top-left corner, inset a touch, so it
    // sits over the top-left of the photo header.
    const destLeft = leftLocal + WAIT_OVERLAY_INSET;
    const destTop = topLocal + WAIT_OVERLAY_INSET;
    const dx = destLeft - startLeft;
    const dy = destTop - startTop;
    waitEl.classList.remove("-bottom-2", "left-1/2", "-translate-x-1/2");
    Object.assign(waitEl.style, {
      position: "absolute",
      left: `${startLeft}px`,
      top: `${startTop}px`,
      margin: "0",
      zIndex: "46",
      transform: "none",
      transformOrigin: "top left",
      transition: "none",
      pointerEvents: "none",
    });
    detail.append(waitEl);
    void waitEl.offsetWidth; // commit the start transform before animating
    // The collapsible "standby" tail inside the chip — revealed as the chip flies
    // up (so the pill grows to include it), re-collapsed as it flies back.
    const waitSub = waitEl.querySelector<HTMLElement>("[data-wait-sub]");
    flyWait = () => {
      // The swell (scale) rides along *with* the fly over the same CARD_MS, so the
      // chip grows into place as it settles rather than popping bigger afterward.
      waitEl.style.transition = `transform ${CARD_MS}ms ${CARD_EASE}`;
      if (waitSub) waitSub.style.transition = ""; // reveal at the class default pace
      waitSub?.classList.remove("max-w-0", "opacity-0");
      waitSub?.classList.add("ml-1", "max-w-[8rem]", "opacity-100");
      waitEl.style.transform = `translate(${dx}px, ${dy}px) scale(${WAIT_GROW})`;
    };
    unflyWait = () => {
      // The pill travels back with the card (transform stays on CARD_MS), dropping
      // the swell as it goes; its width snaps narrow fast so it isn't left wide
      // well after the disc has formed.
      waitEl.style.transition = `transform ${CARD_MS}ms ${CARD_EASE}`;
      waitEl.style.transform = "none";
      if (waitSub) waitSub.style.transition = `all ${CARD_CLOSE_FX_MS}ms ease`;
      waitSub?.classList.remove("ml-1", "max-w-[8rem]", "opacity-100");
      waitSub?.classList.add("max-w-0", "opacity-0");
    };
  }

  // Name-chip flight. Like the wait chip, the marker's name pill is a shared
  // element — but instead of landing on a pixel-identical placeholder, it *becomes*
  // the card's big title: it flies from under the disc to the title slot
  // (`data-name-target`) while its styling morphs from the compact dark pill into
  // the card's name type, replacing the title (which is hidden behind it). Promote
  // it out of the transforming wrap into the stable `detail` box so it travels and
  // restyles cleanly.
  const nameTarget = card.querySelector<HTMLElement>("[data-name-target]");
  let flyName: (() => void) | undefined;
  let unflyName: (() => void) | undefined;
  // The look/geometry properties that morph pill → title (and back). Position is a
  // transform so it stays crisp; the rest interpolate the pill's dressing away.
  const NAME_MORPH_PROPS = [
    "transform",
    "width",
    "padding",
    "border-radius",
    "border-color",
    "border-width",
    "background-color",
    "color",
    "font-size",
    "font-weight",
    "line-height",
    "box-shadow",
  ];
  if (nameEl && nameStart && nameTarget) {
    const cardRectN = card.getBoundingClientRect();
    const nRect0 = nameTarget.getBoundingClientRect();
    const startLeft = nameStart.left - dRect.left;
    const startTop = nameStart.top - dRect.top;
    // The title's final on-screen box = card origin + the title's offset in the body.
    const destLeft = leftLocal + (nRect0.left - cardRectN.left);
    const destTop = topLocal + CARD_HEADER_H + (nRect0.top - cardRectN.top);
    const startW = nameStart.width;
    const destW = nRect0.width;
    // Read the title's resolved type live so the morph tracks the theme (dark mode)
    // and lands on the real card-foreground colour, not a hard-coded token.
    const ts = getComputedStyle(nameTarget);
    const fullName = nameTarget.textContent ?? "";
    nameTarget.style.opacity = "0"; // the flown pill is the visible title from here
    nameEl.classList.remove("-bottom-2", "top-full", "mt-2", "left-1/2", "-translate-x-1/2");
    // Drop the truncation the instant the flight starts: carry the *full* name and
    // let it wrap, then just grow the box (below) from the pill's width to the
    // title's — no clip/reveal, so there's nothing to pop in. `display:block` so the
    // name wraps the same way the card's block title does when it's too long for one
    // line; the box lands identical to it.
    nameEl.textContent = fullName;
    Object.assign(nameEl.style, {
      position: "absolute",
      left: `${startLeft}px`,
      top: `${startTop}px`,
      width: `${startW}px`,
      // The resting chip clamps itself with a max-width (and grows it on hover);
      // both would cap the flight short of the card title's width, so the flown
      // pill drives its own explicit width instead. The class cap comes back with
      // the style reset in `finalize`.
      maxWidth: "none",
      margin: "0",
      zIndex: "47",
      transform: "none",
      transition: "none",
      display: "block",
      whiteSpace: "normal",
    });
    detail.append(nameEl);
    void nameEl.offsetWidth; // commit the pill start state before morphing
    flyName = () => {
      nameEl.style.transition = NAME_MORPH_PROPS.map((p) => `${p} ${CARD_MS}ms ${CARD_EASE}`).join(
        ", ",
      );
      Object.assign(nameEl.style, {
        transform: `translate(${destLeft - startLeft}px, ${destTop - startTop}px)`,
        width: `${destW}px`,
        padding: "0",
        borderWidth: "0",
        borderColor: "transparent",
        borderRadius: "0",
        backgroundColor: "transparent",
        boxShadow: "none",
        color: ts.color,
        fontSize: ts.fontSize,
        fontWeight: ts.fontWeight,
        lineHeight: ts.lineHeight,
        // Pin left alignment: the flown block sits inside the marker `<button>`,
        // whose UA `text-align:center` it would otherwise honour and centre the name
        // against the left-aligned card title.
        textAlign: "left",
      });
    };
    unflyName = () => {
      // Re-clamp immediately as the close begins, so the compact chip — not the
      // full name — is what flies home over the shrinking disc.
      nameEl.innerHTML = nameChipHtml;
      // Geometry rides back with the card (CARD_MS); the pill dressing snaps back
      // fast (CARD_CLOSE_FX_MS) so no oversized name lingers over the shrinking disc.
      nameEl.style.transition = [
        `transform ${CARD_MS}ms ${CARD_EASE}`,
        ...NAME_MORPH_PROPS.filter((p) => p !== "transform").map(
          (p) => `${p} ${CARD_CLOSE_FX_MS}ms ease`,
        ),
      ].join(", ");
      nameEl.style.transform = "none";
      nameEl.style.width = `${startW}px`;
      // Clear the look overrides so each property eases back to its pill class value.
      for (const p of [
        "padding",
        "borderWidth",
        "borderColor",
        "borderRadius",
        "backgroundColor",
        "boxShadow",
        "color",
        "fontSize",
        "fontWeight",
        "lineHeight",
        "textAlign",
      ] as const) {
        nameEl.style[p] = "";
      }
    };
  }

  // The whole card is the button. A click anywhere on it (header photo or body)
  // fires `onPress` (→ the detail page). The in-card Directions button and the
  // close × stop their own clicks, so those never read as a card press. Either
  // way we stop propagation so the click doesn't bubble to the marker's own
  // handler (which would re-fire activate). The flown name/wait chips are
  // `pointer-events-none`, so taps over them fall through to the card beneath.
  /**
   * Hand the card off to a shared-element flight (see `card-flight.ts`). The
   * flight has already cloned the card's pixels into a fixed overlay, so the
   * original is hidden outright rather than animated away — otherwise a card
   * collapsing back to a disc would play *underneath* the copy flying off it.
   * The normal `close()` still runs, out of sight, so the marker is a resting
   * disc again by the time the user navigates back to the map.
   */
  // Set on hand-off to the ride page, so `finalize` knows the pointer state it
  // sees (a stuck touch `:hover`) doesn't mean the user is on the marker.
  let handedOff = false;
  const dismiss = () => {
    handedOff = true;
    detail.style.visibility = "hidden";
    close();
    window.setTimeout(() => {
      detail.style.visibility = "";
    }, CARD_MS + 20);
  };

  const stopProp = (e: Event) => {
    e.stopPropagation();
    // Hand over the three shared elements as they stand *now* — the wait chip
    // and name pill have already flown into their card positions, so their
    // boxes are the card's, which is exactly where the next flight starts.
    onPress?.({ fill, waitEl, nameEl, dismiss });
  };
  wrap.style.cursor = "pointer";
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
    // dark:border-[color-mix(in_oklch,var(--border),white_25%)] keeps an edge.
    wrap.classList.add(
      "border-3d",
      "btn-3d-outline",
      "dark:border-[color-mix(in_oklch,var(--border),white_25%)]",
    );
    // Pin the resolved border colour inline. A border-color that lives on a class
    // (border-3d / dark:border-[color-mix(in_oklch,var(--border),white_25%)]) doesn't reliably animate when close()
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
    flyName?.();
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
      `border-width ${CARD_CLOSE_FX_MS}ms ease`,
    ].join(", ");
    Object.assign(wrap.style, {
      left: "0px",
      top: "0px",
      width: `${size}px`,
      height: `${size}px`,
      borderRadius: `${size / 2}px`,
      boxShadow: ringShadow,
      borderColor: "transparent",
      // Shrink the border-3d 1px edge away too, not just its colour: the wrap is
      // border-box, so a border that persists to the end and then vanishes when
      // the classes are stripped grows the content box by 2px — the restored disc
      // photo (width:100%) visibly pops. Easing the width to 0 early, while the
      // box is still large and mid-collapse, makes the strip a geometric no-op.
      borderWidth: "0px",
    });
    if (fill) fill.style.height = `${size}px`;
    unflyWait?.(); // the wait chip flies back down to the disc
    unflyName?.(); // the name pill restyles back and flies home under the disc
    card.style.opacity = "0";
    // Fade the close button out fast (its open transition carried a 140ms delay
    // that otherwise left it hanging in mid-air after the card had collapsed away).
    closeBtn.style.transition = "opacity 120ms ease";
    closeBtn.style.opacity = "0";
    // The DOM restore normally waits out the collapse animation. If the same
    // marker is re-tapped before it fires, `openAttractionCard` calls `finalize`
    // synchronously (via pendingClose) to settle the disc first — so guard it to
    // run exactly once and cancel the pending timer when it does.
    pendingClose.set(detail, finalize);
    restoreTimer = window.setTimeout(finalize, CARD_MS);
  }

  let restoreTimer = 0;
  let restored = false;
  function finalize() {
    if (restored) return;
    restored = true;
    if (restoreTimer) window.clearTimeout(restoreTimer);
    if (pendingClose.get(detail) === finalize) pendingClose.delete(detail);
    card.remove();
    closeBtn.remove();
    wrap.removeEventListener("click", stopProp);
    // Restore the disc + detail box to their resting state.
    wrap.className = wrapClass;
    wrap.setAttribute("style", wrapStyle);
    if (fill) fill.setAttribute("style", fillStyle);
    // Return the flown chips to their resting spots under the disc, verbatim. The
    // wait pill and name pill are adjacent badge siblings, so each one's captured
    // `next` reference points at the other — and both have been reparented into
    // `detail`, so that reference is no longer a child of `wrap`. Fall back to an
    // append when it isn't, or `insertBefore` throws and aborts the whole restore
    // (which left the disc stuck for the next open).
    const restoreBadge = (el: HTMLElement, next: ChildNode | null) => {
      if (next && next.parentNode === wrap) wrap.insertBefore(el, next);
      else wrap.append(el);
    };
    if (waitEl && waitRestore) {
      waitEl.className = waitRestore.cls;
      waitEl.setAttribute("style", waitRestore.style);
      restoreBadge(waitEl, waitRestore.next);
    }
    // Same for the name pill: its clamped label markup, class and inline style all
    // reset to the resting chip.
    if (nameEl && nameRestore) {
      nameEl.innerHTML = nameChipHtml;
      nameEl.className = nameRestore.cls;
      nameEl.setAttribute("style", nameRestore.style);
      restoreBadge(nameEl, nameRestore.next);
    }
    for (const b of badges) b.el.classList.toggle("hidden", b.wasHidden);
    detail.removeAttribute("data-card-open");
    detail.style.width = "";
    detail.style.height = "";
    if (wasSelected) applySelected(detail, true);
    // The chip is back at its resting clamp, but if the cursor sat on the marker
    // through the whole open/close there's no fresh `mouseenter` coming to open it
    // again — so re-open it here rather than leave it collapsed under the pointer.
    // (Dispatching a synthetic `mouseenter` would also re-fire the z-lift, which
    // counts enters and leaves and would end up stuck raised.)
    // Never after a hand-off to the ride page, though: on a touch screen
    // `:hover` sticks to the tapped marker, and this finalize runs with the
    // user already on another route — re-expanding here is what left a
    // full-width name pill waiting under the return flight's clamped title.
    if (!handedOff && nameEl && detail.parentElement?.matches(":hover")) expandNameChip(nameEl);
  }

  const handle = { close };
  openCard = handle;
  return { card, close };
}

// The wrapper that the cluster controller hides / translates / highlights: a
// disc-sized box (so the marker's footprint is just the photo, centered on the
// point) holding the photo plus its absolutely-positioned chips.
// `will-change-transform` keeps the declutter nudge translate smooth.
// Opacity transitions too: the cluster pass fades markers out before hiding them
// (and in on reveal) instead of popping them — keep its duration in sync with
// DECLUTTER_FADE_MS in declutter.ts.
const DETAIL_CLASS =
  "relative rounded-full transition-[transform,opacity] duration-200 will-change-transform";

/** A circular photo disc (colour-ringed) or, with no photo, the fallback icon
 *  disc. No white border — a thicker colour ring hugs the image so the photo
 *  fills the whole disc. `badge` is optional overlay HTML (e.g. a ride's wait).
 *  `px` sizes the disc with an explicit square box (not a Tailwind size class)
 *  so it's guaranteed round — a non-square box would render the round-clipped
 *  photo as a wide oval. */
/** Initial (pre-load) inline style for a disc photo: hidden, blurred and a
 *  touch zoomed-in so `wireFaceFadeIn` can settle it into place on decode
 *  instead of the photo hard-popping onto the map. Mirrors the <Image> React
 *  component's treatment for these HTML-string markers. */
const FACE_FADE_STYLE =
  "opacity:0;filter:blur(6px);transform:scale(1.06);" +
  "transition:opacity .5s ease-out,filter .5s ease-out,transform .5s ease-out";

/** Reveal a disc photo (see `FACE_FADE_STYLE`) once it decodes. No-op for the
 *  icon fallback, which carries no `<img>`. Safe to call right after the marker
 *  HTML is set: cached images resolve instantly, in-flight ones fade on `load`,
 *  and broken ones still reveal on `error` rather than staying invisible. */
export function wireFaceFadeIn(root: HTMLElement): void {
  const img = root.querySelector<HTMLImageElement>("img[data-face-fill]");
  if (!img) return;
  const settle = () => {
    img.style.opacity = "1";
    img.style.filter = "none";
    img.style.transform = "none";
  };
  if (img.complete && img.naturalWidth > 0) {
    // Already cached — drop straight to the resting state with no animation.
    settle();
    img.style.transition = "";
    return;
  }
  const reveal = () => {
    settle();
    // Clear the transition once settled so a later card-morph transform (the
    // disc flying into the expanded header) isn't eased by this rule.
    const clear = () => {
      img.style.transition = "";
      img.removeEventListener("transitionend", clear);
    };
    img.addEventListener("transitionend", clear);
  };
  img.addEventListener("load", reveal, { once: true });
  img.addEventListener("error", reveal, { once: true });
}

// Whole-marker fade-in duration (ms) — long enough to read as an ease, short
// enough not to lag a park-to-park jump.
const MARKER_FADE_MS = 450;

/**
 * Fade a freshly-built marker in as one piece: the disc wrapper carries the
 * photo, the wait/name chips, and any cluster "+N" dots, so ramping *its*
 * opacity eases every badge in *with* the disc instead of the chips popping in
 * over a still-fading photo. The renderers call this only when a marker set
 * genuinely (re)appears — first paint, a zoom into a park, or a quick jump to
 * another park — so a live-wait refetch that rebuilds the same markers doesn't
 * re-flash them. Independent of the photo's own decode-time blur/scale reveal
 * (`wireFaceFadeIn`), which still textures the image as it lands on top. The
 * inline opacity/transition are cleared once settled so neither lingers to ease
 * a later card-morph or get snapshotted into the disc's resting style.
 */
export function wireMarkerFadeIn(detail: HTMLElement): void {
  const wrap = detail.firstElementChild as HTMLElement | null;
  if (!wrap || typeof requestAnimationFrame === "undefined") return;
  wrap.style.opacity = "0";
  wrap.style.transition = `opacity ${MARKER_FADE_MS}ms ease-out`;
  // Two frames: paint the transparent start before flipping to opaque, so the
  // browser runs the transition instead of collapsing both writes into one.
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      wrap.style.opacity = "1";
      const clear = () => {
        wrap.style.transition = "";
        wrap.style.opacity = "";
        wrap.removeEventListener("transitionend", clear);
      };
      wrap.addEventListener("transitionend", clear);
    });
  });
}

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
      )}" loading="lazy" class="size-full rounded-full object-cover shadow-md ring-[3px]" style="${ring};${FACE_FADE_STYLE}" />`
    : `<span data-face-fill class="flex size-full items-center justify-center rounded-full text-white shadow-md ring-[3px]" style="background:${opts.bg};${ring}">${opts.fallbackSvg}</span>`;
  return `<span class="relative block shrink-0" style="width:${opts.px}px;height:${opts.px}px">${face}${
    opts.badge ?? ""
  }</span>`;
}

/** Express capacity chip on a park badge (plan item 3.1). Same pill as the wait /
 *  name chips (`WAIT_CHIP_CLASS`) so the stack reads as one family — only the fill
 *  differs: `full` urgent red, `nearing` amber. Stacks under the park's name chip
 *  exactly as a ride's name stacks under its wait chip (`top-full mt-2`). */
function capacityChipMarkup(level: CapacityLevel): string {
  const style =
    level === "full" ? "background:#dc2626;color:#fff" : "background:#f59e0b;color:#1c1917";
  return `<span class="pointer-events-none absolute top-full mt-2 left-1/2 -translate-x-1/2 ${WAIT_CHIP_CLASS}" style="${style}">${escapeHtml(
    capacityLabel(level),
  )}</span>`;
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

/**
 * The guest-service POIs that stay on the map (dimmed) during active navigation
 * — restrooms are the one thing guests genuinely divert for mid-walk (§5). The
 * feed folds them into the `info` category with ATMs/lockers/first aid, so the
 * name is the only discriminator.
 */
export function isRestroomPoi(poi: { category: string; name: string }): boolean {
  return poi.category === "info" && /restroom/i.test(poi.name);
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
 * One park badge for the overview map: the park photo under its name chip (plus
 * an Express capacity chip when there is one), matching the ride/POI markers. The
 * caller wires the click (navigate) and a hover z-lift so a widened name chip
 * clears its neighbors.
 */
export function buildParkBadgeEl(p: {
  name: string;
  slug: string;
  operatorSlug: string | null;
  imageUrl?: string | null;
  imageAlt?: string | null;
  /** Today's Universal Express capacity (plan item 3.1); null → no chip. */
  expressCapacity?: CapacityLevel | null;
}): { el: HTMLButtonElement; detail: HTMLDivElement } {
  const el = document.createElement("button");
  el.type = "button";
  el.setAttribute("aria-label", p.name);
  el.className = "group relative block cursor-pointer";
  // Landing pad for the park page's *return* flight (see `launchHeroReturn`):
  // its hero pops back down onto this badge's face/name-chip when backing out.
  el.dataset.markerKey = parkMarkerKey(p.slug);
  const color = operatorColor(p.operatorSlug);
  const disc = discMarkup({
    url: p.imageUrl ?? null,
    alt: p.imageAlt ?? p.name,
    fallbackSvg: parkIconSvg(p.slug, p.operatorSlug),
    ring: color,
    bg: color,
    px: 64,
    badge: `${nameChipMarkup(formatParkName(p.name), false)}${
      p.expressCapacity ? capacityChipMarkup(p.expressCapacity) : ""
    }`,
  });
  const detail = document.createElement("div");
  detail.className = DETAIL_CLASS;
  // No side tooltip on any marker: the name chip under the disc is the label, and
  // it opens to the full name on hover (see `nameChipMarkup`).
  detail.innerHTML = disc;
  wireFaceFadeIn(detail);
  wireNameChipHover(el, detail);
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
  /** Map-pin class: 'dine' | 'characters' | 'quick-service' | 'shop' (facility
   *  layers) or an overlay POI class 'info' | 'entertainment' | 'character' |
   *  'tour'. */
  category: string;
  imageUrl: string | null;
  /** Higher-res variant of `imageUrl`, swapped into the card header on open (see
   *  `discMarkup` `hiResUrl`). Lets the disc load a small thumb fast while the
   *  full-size photo waits for an actual card open. */
  hiResUrl?: string | null;
  detailUrl?: string | null;
  /** Finder slug — present on shops (deep-links `/shop/$slug`); absent on dining. */
  slug?: string | null;
};

/**
 * Body of the shared POI info card (dining + shops) — the same layout both
 * overlay layers pop, mirroring the attraction card below the photo header (the
 * marker's own disc, flown up by `openAttractionCard`). Shows the name, a
 * kind · land subtitle, and the action row (Directions + walk-time slot). There's
 * no in-body link — the whole card is a button (`poiPressTarget` decides where it
 * leads). Lives in themed DOM (reads correctly in dark).
 */
// Subtitle label per POI category. `characters` (plural) is a dining character
// spot; `character` (singular) is a park_poi meet-and-greet.
const POI_KIND_LABEL: Record<string, string> = {
  shop: "Shop",
  characters: "Character Spot",
  dine: "Dining",
  "quick-service": "Quick Service",
  info: "Guest Service",
  entertainment: "Entertainment",
  character: "Character Meet",
  tour: "Tour & Event",
};
// The park_poi overlay categories: no internal detail page — link out to the
// operator's own page (new tab) instead of an in-app route.
const POI_OVERLAY_CATEGORIES = new Set(["info", "entertainment", "character", "tour"]);

export function poiCardBodyHtml(poi: PoiItem): string {
  const kindLabel = POI_KIND_LABEL[poi.category] ?? "Dining";
  const subtitle = [kindLabel, poi.land].filter(Boolean).join(" · ");
  // The whole card is the button now (see `openAttractionCard` `onPress`): shops →
  // `/shop/$slug`, dining → `/dining/$facilityId`, overlay POIs → the operator's
  // page in a new tab. Where the "Details" link used to sit, the walk time eases
  // in instead — same as the ride card.
  const directions = directionsButtonHtml(poi.longitude, poi.latitude);
  const actions = `<div class="mt-3 flex items-center gap-2">${directions}${walkSlotHtml}</div>`;
  return `<div data-name-target class="text-[15px] font-semibold leading-tight text-card-foreground">${escapeHtml(
    poi.name,
  )}</div><div class="mt-1 text-[12px] text-muted-foreground">${escapeHtml(
    subtitle,
  )}</div>${actions}`;
}

/**
 * Card body for a live SHOW marker (plan item 1.1) — leads with the next
 * showtime (or "Done for today"), then the land, then Directions + walk time.
 * The whole card presses to the show's detail page (wired by the renderer).
 * `nextLabel` is the pre-formatted "Next 3:00 PM · in 25 min" line (null when the
 * day's shows are done); `sub` is the fallback subtitle used then.
 */
export function showCardBodyHtml(opts: {
  name: string;
  land: string | null;
  longitude: number | null;
  latitude: number | null;
  nextLabel: string | null;
  sub: string;
}): string {
  const lead = opts.nextLabel ?? opts.sub;
  const subtitle = [lead, opts.land].filter(Boolean).join(" · ");
  const directions = directionsButtonHtml(opts.longitude, opts.latitude);
  const actions = `<div class="mt-3 flex items-center gap-2">${directions}${walkSlotHtml}</div>`;
  return `<div data-name-target class="text-[15px] font-semibold leading-tight text-card-foreground">${escapeHtml(
    opts.name,
  )}</div><div class="mt-1 text-[12px] text-muted-foreground">${escapeHtml(
    subtitle,
  )}</div>${actions}`;
}

/** Where tapping a POI card leads (the whole card is a button now). Shops key on
 *  the finder slug, dining on the facility id (`/dining/$facilityId`); overlay
 *  POIs (guest services / entertainment / tours) have no in-app page and open
 *  the operator's page in a new tab. `null` when there's nowhere to go — the card
 *  is inert. Centralized here so both renderers press to the same place. */
export type PoiPressTarget =
  | { kind: "shop"; slug: string }
  | { kind: "dining"; facilityId: string }
  | { kind: "external"; url: string }
  | null;

export function poiPressTarget(poi: PoiItem): PoiPressTarget {
  if (POI_OVERLAY_CATEGORIES.has(poi.category))
    return poi.detailUrl ? { kind: "external", url: poi.detailUrl } : null;
  if (poi.category === "shop") return poi.slug ? { kind: "shop", slug: poi.slug } : null;
  return { kind: "dining", facilityId: poi.id };
}

// Accent per POI kind — warm amber for dining, orange for quick service/carts,
// violet for shops, pink for character spots. Distinct from the wait-status
// palette so POIs never read as a ride's crowd level.
const POI_COLOR: Record<string, string> = {
  dine: "#d97706",
  "quick-service": "#ea580c",
  characters: "#db2777",
  shop: "#9333ea",
  // park_poi overlay categories. `character` (singular) is a meet-and-greet POI,
  // distinct from dining's `characters` (plural) character-dining spot.
  info: "#0d9488", // teal — guest services
  entertainment: "#c026d3", // fuchsia — parades/fireworks/shows
  character: "#db2777", // pink — character meets
  tour: "#059669", // emerald — events + tours
};

/**
 * Build a dining/shop POI marker: a colour-ringed photo disc (or category icon)
 * under a name chip. Same 52px disc as a ride marker so the POI layers sit as
 * equal citizens on the map. Folded into the ride cluster by the renderer, so
 * overlapping markers group + collision-avoid together. Returns the root plus the
 * `detail` layer, like the others.
 */
/**
 * Shrink a Disney `mwImage` CDN url to a disc-sized thumbnail by rewriting the
 * resize dimensions baked into its path (`/resize/mwImage/<mode>/<w>/<h>/<q>/…`).
 * Scales the longest side to ~160px — plenty for a retina 52px disc — keeping the
 * source aspect ratio so the crop is identical to the full-size photo, just far
 * lighter (an 800x450 card asset drops ~70% in bytes). Returns null for urls that
 * aren't mwImage (e.g. Universal venues on their own host), so the caller falls
 * back to the original — no worse than before.
 */
function mwImageThumb(url: string | null): string | null {
  if (!url) return null;
  const m = url.match(/(\/resize\/mwImage\/\d+\/)(\d+)\/(\d+)(\/)/);
  if (!m) return null;
  const w = Number(m[2]);
  const h = Number(m[3]);
  if (!w || !h) return null;
  const scale = 160 / Math.max(w, h);
  if (scale >= 1) return null; // already disc-sized or smaller
  return url.replace(m[0], `${m[1]}${Math.round(w * scale)}/${Math.round(h * scale)}${m[4]}`);
}

/** The asset a Disney CDN url points at, with its resize segment stripped — two
 *  urls sharing this are the *same photo* at different sizes, so swapping one for
 *  the other can't re-frame anything. Null for non-mwImage hosts. */
function mwImageAsset(url: string | null): string | null {
  const m = url?.match(/\/resize\/mwImage\/\d+\/\d+\/\d+\/\d+(\/.*)$/);
  return m ? m[1] : null;
}

/** Widths (CSS px × ~2–3 for density) the two tiers of a marker photo render at:
 *  a 52px disc, then the {@link CARD_W}-wide card header it grows into. */
const DISC_SRC_W = 160;
const CARD_SRC_W = CARD_W * 2;

/** Route a marker photo through Cloudflare's resizer at `width`. Width-only, so
 *  `fit=scale-down` keeps the source's aspect (and never upscales) — the crop is
 *  untouched, which is the whole point here. Passes the url through unchanged
 *  when the `cf-images` flag is off or we're on `vp dev` (where `/cdn-cgi/image/`
 *  404s), exactly like `<Image>`'s own guard. */
function cfMarkerUrl(url: string, width: number): string {
  if (!cfImagesStore.state || import.meta.env.DEV) return url;
  return cfImageUrl(url, { width, quality: 60 });
}

/**
 * The disc + card-header photo pair for a marker, guaranteed to be two renditions
 * of *one* asset — same photo, same crop, same aspect — so the hi-res upgrade on
 * card open (see `openAttractionCard`) only sharpens the header instead of
 * re-framing it.
 *
 * Disney's stored pair already is that: both urls are `/resize/mwImage/1/…` of the
 * same master, and mode 1 preserves aspect (the 90/90 and 800/450 requests come
 * back as a 100px and a 500px copy of the same square), so the swap is invisible.
 * Universal's pair is not: the feed's list image is a 3:2 crop (`…-c.jpg`,
 * 750×500) while the hero is an ultra-wide 2.33:1 one (`…-a.jpg`, 2268×972) of the
 * same shot — different framing, so upgrading visibly popped the open card's photo.
 *
 * So: keep the two-tier load when both urls are the same asset, and otherwise pick
 * a single asset (the list crop when there is one — at 750–1200px it already
 * out-resolves the {@link CARD_W} header on a 2× screen, at a fraction of the
 * hero's bytes) and derive the disc's copy from it by resize alone.
 */
function markerPhotoUrls(
  thumb: string | null | undefined,
  hero: string | null | undefined,
): { url: string | null; hiResUrl: string | null } {
  const asset = mwImageAsset(thumb ?? null);
  if (thumb && hero && asset && asset === mwImageAsset(hero)) return { url: thumb, hiResUrl: hero };
  const source = thumb ?? hero ?? null;
  if (!source) return { url: null, hiResUrl: null };
  // Same-crop renditions: Disney's own resize segment where it has one, ours
  // otherwise. When neither is available the disc just loads the full asset and
  // there's nothing to upgrade to — the pre-existing behaviour for those urls.
  const mw = mwImageThumb(source);
  const disc = mw ?? cfMarkerUrl(source, DISC_SRC_W);
  const hiRes = mw ? source : cfMarkerUrl(source, CARD_SRC_W);
  return { url: disc, hiResUrl: hiRes === disc ? null : hiRes };
}

export function buildPoiEl(poi: PoiItem): { el: HTMLButtonElement; detail: HTMLDivElement } {
  // Normalize the finder pin to a CATEGORY_ICON key ("characters" -> "character").
  const iconKey = poi.category === "characters" ? "character" : poi.category;
  const color = POI_COLOR[poi.category] ?? "#64748b";

  const el = document.createElement("button");
  el.type = "button";
  el.setAttribute("aria-label", poi.name);
  el.className = "group relative block cursor-pointer";
  // Return-flight landing pad (see `launchHeroReturn`) — unused until the POI
  // detail pages fly, but stamped now so the pad contract is uniform.
  el.dataset.markerKey = poiMarkerKey(poi.id);

  const detail = document.createElement("div");
  detail.className = DETAIL_CLASS;
  // Photo-less POIs — guest-service utility pins (restrooms, ATMs, chargers)
  // and the shops/venues the feed carries no image for — render as a small icon
  // dot (28px) rather than the full 52px disc the photo markers use, so a bare
  // glyph never sits at the same weight as a real attraction/venue photo.
  const iconOnly = !poi.imageUrl;
  const px = iconOnly ? 28 : 52;
  // Two-tier image load (same as the ride markers): the disc loads a small,
  // fast-decoding copy; the card-header-sized one is fetched only when a card
  // opens. Both are renditions of a single asset, so the upgrade can't re-frame
  // the photo — see `markerPhotoUrls`.
  const photo = markerPhotoUrls(poi.imageUrl, poi.hiResUrl);
  const disc = discMarkup({
    url: photo.url,
    hiResUrl: photo.hiResUrl,
    alt: poi.name,
    fallbackSvg: categoryIconSvg(iconKey, iconOnly ? 13 : 14),
    ring: color,
    bg: color,
    px,
    badge: nameChipMarkup(poi.name, false),
  });
  // No side tooltip: the name chip under the disc *is* the label, and it opens to
  // the full name on hover (see `nameChipMarkup`). The land shows in the card.
  detail.innerHTML = disc;
  wireFaceFadeIn(detail);
  wireNameChipHover(el, detail);
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
  // Landing pad for the ride page's *return* flight (see `launchHeroReturn`):
  // backing out of a ride page pops its hero back down onto this marker.
  el.dataset.markerKey = attractionMarkerKey(a.slug);

  // `detail` is the wrapper the controller clusters/translates/highlights: the
  // ride photo plus its chips.
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
  // Disc thumb + the copy the open card upgrades to, always the same asset at two
  // sizes (see `markerPhotoUrls`) — a *different* crop here is what made Universal
  // cards visibly re-frame on open where Disney's never did.
  const photo = markerPhotoUrls(a.meta?.imageThumbUrl, a.meta?.imageHeroUrl);
  const disc = discMarkup({
    url: photo.url,
    hiResUrl: photo.hiResUrl,
    alt: a.meta?.imageAlt ?? a.name,
    fallbackSvg: categoryIconSvg(a.category),
    ring: color,
    bg: color,
    px: 52,
    badge: `${waitBadge}${nameChipMarkup(a.name, Boolean(waitBadge))}`,
  });
  // No side tooltip: the wait chip + name chip under the disc already carry both
  // lines it used to show, and the name opens out in place on hover.
  detail.innerHTML = disc;
  wireFaceFadeIn(detail);
  wireNameChipHover(el, detail);
  applySelected(detail, selected);

  el.append(detail);
  return { el, detail };
}
