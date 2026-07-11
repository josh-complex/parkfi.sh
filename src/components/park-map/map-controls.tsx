"use client";

import * as React from "react";
import { Link } from "@tanstack/react-router";
import {
  ArrowUpRightIcon,
  DramaIcon,
  InfoIcon,
  LoaderCircleIcon,
  LocateFixedIcon,
  MinusIcon,
  PlusIcon,
  PopcornIcon,
  RollerCoasterIcon,
  ShoppingBagIcon,
  SparklesIcon,
  TicketIcon,
  UtensilsIcon,
  type LucideIcon,
} from "lucide-react";

import { type MapLayers, useRideFilter } from "#/components/rides/ride-filter.tsx";
import type { GeoState } from "#/hooks/use-geolocation.ts";
import { cn } from "#/lib/utils.ts";

import { MAP_TYPE_COLOR, type MapItemKind } from "./shared.tsx";

/**
 * The floating chrome overlaid on the shared map: zoom/locate controls, the
 * roam park chips + layer toggles, and the Kingdom Hearts status pill. They all
 * travel in the map's portal, so they follow the map between routes.
 */

// A round, 3D-embossed map control, matching the app's button language (the same
// shelf/glare as the bottom nav + core search). Absolutely positioned, so the
// press "sinks" via translate-y (not the `top` trick the flow buttons use, which
// would fight the overlay's absolute `top`/`bottom` anchor). Slightly translucent
// with a blur so it floats cleanly over the map.
const MAP_CTRL_3D =
  "btn-3d-outline border-3d shadow-3d pointer-events-auto flex size-10 items-center justify-center bg-background/95 text-foreground backdrop-blur transition-[transform,box-shadow,background-color,color] duration-150 ease-out active:translate-y-[3px] active:shadow-3d-active dark:border-[color-mix(in_oklch,var(--border),white_25%)]";

// Height the floating bottom clusters keep above the bottom-nav island on
// mobile — the single source of truth for both the left and right stacks so
// their positioning can't drift apart between devices (differing safe-area
// insets, gesture bars, etc.). `md:` drops it since desktop has no bottom nav.
const CLUSTER_BOTTOM =
  "bottom-[calc(var(--bottom-nav-height)+var(--safe-bottom)+1.4rem)] md:bottom-3";
// While navigating, the right column rises to clear the green nav ETA card.
const CLUSTER_BOTTOM_LIFTED =
  "bottom-[calc(var(--bottom-nav-height)+var(--safe-bottom)+6.25rem)] md:bottom-[5rem]";

/**
 * Shared positioning shell for the two floating bottom map-control clusters
 * (bottom-left park-details/filter, bottom-right zoom/locate/credits). Both
 * anchor to the exact same bottom offset, so they sit at matching heights above
 * the bottom nav on every device — `side` only flips which edge they hug and how
 * their children stack. `lifted` raises the column clear of the nav ETA card
 * while navigating. Non-interactive itself; its children opt back into pointer
 * events (`pointer-events-auto`).
 */
export function BottomMapCluster({
  side,
  lifted = false,
  className,
  children,
}: {
  side: "left" | "right";
  lifted?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      data-map-chrome="bottom"
      className={cn(
        "pointer-events-none absolute z-10 flex flex-col gap-2",
        side === "left" ? "left-4 items-start" : "right-4 items-end",
        lifted ? CLUSTER_BOTTOM_LIFTED : CLUSTER_BOTTOM,
        className,
      )}
    >
      {children}
    </div>
  );
}

/** A small centered pill for Kingdom Hearts status copy (wrong park / no WebGL). Sits
 *  in the bottom-center slot the play HUD would otherwise occupy. */
export function PlayHint({ children }: { children: React.ReactNode }) {
  return (
    <div className="animate-in fade-in slide-in-from-bottom-2 pointer-events-none absolute left-1/2 bottom-[calc(var(--bottom-nav-height)+var(--safe-bottom)+3rem)] z-10 -translate-x-1/2 rounded-full border bg-background/90 px-4 py-2 text-center text-xs shadow-sm backdrop-blur duration-200 md:bottom-4">
      {children}
    </div>
  );
}

/** Vertical +/- zoom group, sitting at the top of the bottom-right control
 *  column (see the stack in map-stage). Replaces each engine's native zoom
 *  control with one connected 3D control — a single embossed shelf split by a
 *  divider — driving zoom through the shared MapHandle. Individual buttons flash
 *  their background on press rather than sinking, so the group reads as one solid
 *  piece. */
export function ZoomControl({
  onZoomIn,
  onZoomOut,
}: {
  onZoomIn: () => void;
  onZoomOut: () => void;
}) {
  return (
    <div className="btn-3d-outline border-3d shadow-3d pointer-events-auto flex flex-col overflow-hidden rounded-2xl bg-background/95 backdrop-blur dark:border-[color-mix(in_oklch,var(--border),white_25%)]">
      <button
        type="button"
        onClick={onZoomIn}
        aria-label="Zoom in"
        className="flex size-10 items-center justify-center text-foreground transition-colors active:bg-foreground/10"
      >
        <PlusIcon className="size-5" />
      </button>
      <div className="mx-2 h-px bg-border" />
      <button
        type="button"
        onClick={onZoomOut}
        aria-label="Zoom out"
        className="flex size-10 items-center justify-center text-foreground transition-colors active:bg-foreground/10"
      >
        <MinusIcon className="size-5" />
      </button>
    </div>
  );
}

/**
 * Toggleable map-credits chip, sitting at the bottom of the bottom-right control
 * column (below the locate button). We turn off each engine's native attribution
 * control (which otherwise pokes out beneath the bottom-nav island) and carry the
 * MapTiler/OSM credit here instead. Collapsed it's just a round info button;
 * tapping reveals the attribution, which motions in to its left while the chip
 * grows to fit (an animated `grid-cols` track drives the width).
 */
export function MapAttribution() {
  const [open, setOpen] = React.useState(false);
  return (
    <div className="btn-3d-outline border-3d shadow-3d pointer-events-auto flex h-10 items-center overflow-hidden rounded-full bg-background/95 backdrop-blur dark:border-[color-mix(in_oklch,var(--border),white_25%)]">
      {/* Attribution text — an animated `grid-cols` track (0fr↔1fr) so the chip
          grows/shrinks smoothly and the text slides in rather than popping. */}
      <div
        className={cn(
          "grid transition-[grid-template-columns,opacity] duration-300 ease-out motion-reduce:transition-none",
          open ? "grid-cols-[1fr] opacity-100" : "grid-cols-[0fr] opacity-0",
        )}
      >
        <div className="overflow-hidden">
          <p className="whitespace-nowrap pl-3.5 pr-1 text-[0.7rem] leading-none text-muted-foreground [&_a]:underline [&_a]:decoration-dotted [&_a]:underline-offset-2">
            ©{" "}
            <a href="https://www.maptiler.com/copyright/" target="_blank" rel="noreferrer">
              MapTiler
            </a>{" "}
            ©{" "}
            <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">
              OpenStreetMap
            </a>
          </p>
        </div>
      </div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={open ? "Hide map credits" : "Show map credits"}
        aria-expanded={open}
        className="flex size-10 shrink-0 items-center justify-center text-foreground transition-colors active:bg-foreground/10"
      >
        <InfoIcon className="size-5" />
      </button>
    </div>
  );
}

/**
 * Floating "locate me" control, sitting in the middle of the bottom-right
 * control column (see the stack in map-stage). Tapping it requests/refreshes the
 * fix.
 */
export function LocateButton({ state, onClick }: { state: GeoState; onClick: () => void }) {
  const prompting = state.status === "prompting";
  const active = state.status === "granted";
  const off = state.status === "denied" || state.status === "unavailable";
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={active ? "Hide my location" : "Show my location"}
      aria-pressed={active}
      title={
        off
          ? "Location unavailable — check permissions"
          : active
            ? "Hide my location"
            : "Show my location"
      }
      className={cn(
        MAP_CTRL_3D,
        "rounded-full",
        active && "text-blue-600",
        off && "text-muted-foreground",
      )}
    >
      {prompting ? (
        <LoaderCircleIcon className="size-5 animate-spin" />
      ) : (
        <LocateFixedIcon className="size-5" />
      )}
    </button>
  );
}

/**
 * Free-roam shortcut into the focused park's dashboard. Appears (traveling in the
 * portal with the map) only when the roam map is zoomed into a park — a left-aligned
 * 3D pill in the bottom-left cluster, stacked directly on top of the filter button
 * (the cluster owns the absolute positioning). Tapping it opens the full
 * `/park/$slug` page; the press sinks via translate-y.
 */
export function ParkDetailButton({ slug }: { slug: string }) {
  return (
    <Link
      to="/park/$slug"
      params={{ slug }}
      className="btn-3d-outline border-3d shadow-3d pointer-events-auto flex shrink-0 select-none items-center gap-1.5 rounded-full bg-background/95 px-4 py-2 text-sm font-medium text-foreground backdrop-blur transition-[transform,box-shadow] duration-150 ease-out active:translate-y-[3px] active:shadow-3d-active dark:border-[color-mix(in_oklch,var(--border),white_25%)]"
    >
      <span>Park info</span>
      <ArrowUpRightIcon className="size-4 shrink-0 text-muted-foreground" />
    </Link>
  );
}

/**
 * The top park-chip row: a plain horizontally-scrollable row of pills that fly the
 * roam camera to a park. Zoomed into a park (`focusSlug` set) it offers the *other*
 * parks; zoomed out (`focusSlug` null) it offers every park. Tapping a chip flies
 * the shared map there; the roam viewport watcher then re-points the cluster at the
 * new focus. Renders nothing when there's no park to offer. Negative margins +
 * matching padding let the row bleed to the screen edges while the first chip still
 * lines up with the search bar.
 */
export function ParkChipScroller({
  parks,
  focusSlug,
  onZoom,
}: {
  parks: ReadonlyArray<{ slug: string; name: string }>;
  focusSlug: string | null;
  onZoom: (slug: string) => void;
}) {
  const others = focusSlug ? parks.filter((p) => p.slug !== focusSlug) : parks;
  if (others.length === 0) return null;
  return (
    <div className="pointer-events-auto -mx-3 flex w-[calc(100%+1.5rem)] touch-pan-x items-center gap-1.5 overflow-x-auto overscroll-contain px-3 pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {others.map((p) => (
        <button
          key={p.slug}
          type="button"
          onClick={() => onZoom(p.slug)}
          className="btn-3d-outline border-3d shadow-3d flex shrink-0 select-none items-center whitespace-nowrap rounded-full bg-background/95 px-4 py-2 text-sm font-medium text-foreground backdrop-blur transition-[transform,box-shadow] duration-150 ease-out active:translate-y-[3px] active:shadow-3d-active dark:border-[color-mix(in_oklch,var(--border),white_25%)]"
        >
          {p.name}
        </button>
      ))}
    </div>
  );
}

// The ride categories each on-map chip stands for. "Rides" folds the three
// ride-type markers (coasters, flat/dark rides, water rides) into one toggle;
// "Shows" folds stage shows and character meets together. Kept as the single
// source of truth for both the seeded roam-map default and the chip's
// active/toggle logic.
export const RIDE_CATEGORY_KEYS = ["thrill", "attraction", "water"] as const;
const SHOW_CATEGORY_KEYS = ["show", "character"] as const;

/**
 * The on-map toggle row: labeled pills for what the map draws — grouped ride
 * categories (which ride markers show, shared with the Waits filter) and the
 * optional overlay layers (dining/shops markers). Two category groups ("Rides",
 * "Shows") each cover several underlying categories; Shops, Eats, and Quick
 * Service are overlay layers (on the map only ride markers render, so a
 * per-venue ride category would have nothing to act on — the venues live in the
 * layers instead). Sized to match the filter button, in a scroll-if-it-overflows
 * row with the scrollbar hidden.
 */
type MapToggle = { label: string; Icon: LucideIcon; color: MapItemKind } & (
  | { kind: "category"; keys: ReadonlyArray<string> }
  | { kind: "layer"; key: keyof MapLayers }
);

const MAP_TOGGLES: ReadonlyArray<MapToggle> = [
  {
    kind: "category",
    label: "Rides",
    Icon: RollerCoasterIcon,
    keys: RIDE_CATEGORY_KEYS,
    color: "rides",
  },
  { kind: "category", label: "Shows", Icon: DramaIcon, keys: SHOW_CATEGORY_KEYS, color: "shows" },
  { kind: "layer", key: "shops", label: "Shops", Icon: ShoppingBagIcon, color: "shops" },
  { kind: "layer", key: "dining", label: "Meals", Icon: UtensilsIcon, color: "eats" },
  {
    kind: "layer",
    key: "quickService",
    label: "Bites",
    Icon: PopcornIcon,
    color: "quickService",
  },
  {
    kind: "layer",
    key: "entertainment",
    label: "Live",
    Icon: SparklesIcon,
    color: "entertainment",
  },
  { kind: "layer", key: "tours", label: "Tours", Icon: TicketIcon, color: "tours" },
  { kind: "layer", key: "services", label: "Services", Icon: InfoIcon, color: "services" },
];

export function MapToggleChips() {
  const { filter, setFilter } = useRideFilter();
  // A group is on when every category it covers is selected; toggling flips the
  // whole group on/off together.
  const toggleCategory = (keys: ReadonlyArray<string>) =>
    setFilter((f) => {
      const categories = new Set(f.categories);
      const allOn = keys.every((k) => categories.has(k));
      for (const k of keys) {
        if (allOn) categories.delete(k);
        else categories.add(k);
      }
      return { ...f, categories };
    });
  const toggleLayer = (key: keyof MapLayers) =>
    setFilter((f) => ({ ...f, layers: { ...f.layers, [key]: !f.layers[key] } }));
  return (
    <div className="pointer-events-auto -mx-3 flex w-[calc(100%+1.5rem)] touch-pan-x gap-1.5 overflow-x-auto overscroll-contain px-3 pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {MAP_TOGGLES.map((t) => {
        const active =
          t.kind === "category"
            ? t.keys.every((k) => filter.categories.has(k))
            : filter.layers[t.key];
        const { Icon } = t;
        const color = MAP_TYPE_COLOR[t.color];
        return (
          <button
            key={t.kind === "category" ? `cat:${t.label}` : `layer:${t.key}`}
            type="button"
            onClick={() => (t.kind === "category" ? toggleCategory(t.keys) : toggleLayer(t.key))}
            aria-pressed={active}
            style={
              active
                ? // Fill + 3D shelf/glare all derived from the type's signature
                  // colour, so a lit chip matches its markers' overflow dot.
                  ({
                    backgroundColor: color,
                    "--btn-3d": `color-mix(in oklch, ${color}, black 32%)`,
                    "--btn-glare": `color-mix(in oklch, ${color}, black 32%)`,
                  } as React.CSSProperties)
                : undefined
            }
            className={cn(
              "btn-3d-outline border-3d flex shrink-0 select-none items-center gap-1.5 rounded-full px-4 py-2 text-sm font-medium backdrop-blur transition-[transform,box-shadow,background-color,color] duration-150 ease-out dark:border-[color-mix(in_oklch,var(--border),white_25%)]",
              active
                ? // Selected: hold the pressed-in state — the filled pill sits
                  // translated down into its shelf with the shadow collapsed, so it
                  // reads as depressed rather than raised.
                  "translate-y-[3px] text-white shadow-3d-active"
                : // Resting: raised 3D outline pill that sinks on press. The icon
                  // carries the type colour so the mapping reads even when off.
                  "bg-background/95 text-foreground shadow-3d active:translate-y-[3px] active:shadow-3d-active",
            )}
          >
            <Icon className="size-5" style={active ? undefined : { color }} />
            {t.label}
          </button>
        );
      })}
    </div>
  );
}
