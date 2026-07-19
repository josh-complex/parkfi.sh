import * as React from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import {
  ActivityIcon,
  BedDoubleIcon,
  MapIcon,
  SwordsIcon,
  TicketIcon,
  TrafficConeIcon,
  UtensilsIcon,
} from "lucide-react";

import { useStore } from "@tanstack/react-store";

import { playModeStore, setPlayMode } from "#/components/living/play-mode.ts";
import { useMaintenanceFeatures } from "#/components/maintenance-gate.tsx";
import { useLivingLayerEnabled } from "#/integrations/posthog/feature-flags.ts";
import { cn } from "#/lib/utils.ts";

/**
 * Mobile-only primary navigation. Reuses the core-search 3D segmented look: five
 * edge-to-edge connected segments forming one continuous bar of uniform height.
 * Bottoms align (`items-end`) so the bar reads as one piece. Hidden on desktop
 * (`md:hidden`), where the sidebar takes over. `fixed`, so it floats over the page
 * (notably the fullscreen `/map`) without consuming layout.
 */
const SEG_BASE =
  "relative top-0 -ml-px flex flex-1 flex-col items-center justify-center gap-1 border-3d btn-3d-outline shadow-3d bg-background dark:bg-background px-2 py-2.5 text-sm font-medium transition-[top,box-shadow,background-color,color,border-radius] duration-150 ease-out first:ml-0 active:top-[3px] active:[--btn-glare:var(--btn-3d)] active:shadow-3d-active dark:border-[color-mix(in_oklch,var(--border),white_25%)] [&>svg]:size-5 " +
  // The selected/pressed key sits 3px lower, so its neighbors curve down toward
  // it on the side they share. Sibling selectors (`:has(+ …)` for the segment
  // before the key, `… + &` for the one after) keep this stateless, and cover
  // both the routed key (aria-current) and a transient finger-down (:active).
  //
  // Top corners: an elliptical border radius — 20px sweep, 3px deep (the press
  // depth) — so the top edge dives into the key and bottoms out exactly at its
  // top corner. border-radius is in the transition list so it eases with the
  // press.
  "[&:has(+[aria-current=page])]:rounded-tr-[14px_4px] [[aria-current=page]+&]:rounded-tl-[14px_4px] [&:has(+:active)]:rounded-tr-[14px_4px] [:active+&]:rounded-tl-[14px_4px] " +
  // Bottom corners can't use border-radius (any corner rounding bows the curve
  // the wrong way — concave — and curls the shelf up over the corner). Each
  // segment instead carries two hidden 14×4px body-colored patches spanning its
  // bottom border + 3px shelf band (`::after` bottom-right, `::before`
  // bottom-left), clip-pathed to a convex arc that mirrors the top curve: flush
  // with the body's straight bottom edge at the far end, diving to the key's
  // base at the junction. Border and shelf share --btn-3d, so the un-clipped
  // remnant of that 4px band tapers into the 1px line that continues as the
  // key's own bottom border. The facing patch fades in when the adjacent key
  // is down.
  "before:pointer-events-none before:absolute before:-bottom-1 before:left-0 before:h-1 before:w-[14px] before:bg-background before:[clip-path:path('M14_0_A14_3_0_0_0_0_3_L0_0_Z')] before:opacity-0 before:transition-opacity before:duration-150 before:ease-out before:content-[''] " +
  "after:pointer-events-none after:absolute after:-bottom-1 after:right-0 after:h-1 after:w-[14px] after:bg-background after:[clip-path:path('M0_0_A14_3_0_0_1_14_3_L14_0_Z')] after:opacity-0 after:transition-opacity after:duration-150 after:ease-out after:content-[''] " +
  "[&:has(+[aria-current=page])]:after:opacity-100 [[aria-current=page]+&]:before:opacity-100 [&:has(+:active)]:after:opacity-100 [:active+&]:before:opacity-100";
const SEG_ACTIVE =
  "z-10 top-[3px] bg-primary dark:bg-primary text-primary-foreground [--btn-3d:color-mix(in_oklch,var(--primary),black_32%)] [--btn-glare:var(--btn-3d)] shadow-3d-active hover:top-[3px] hover:shadow-3d-active";
const SEG_IDLE = "text-foreground";

/**
 * Overlaid on a segment whose feature is in maintenance: faint caution stripes
 * across the key plus a cone chip in the corner. The key stays tappable (the
 * destination shows the full `MaintenanceScreen`) — we surface the state, not
 * hide the button.
 */
function MaintenanceOverlay() {
  return (
    <>
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 rounded-[inherit] opacity-20"
        style={{
          backgroundImage: "repeating-linear-gradient(45deg, #f59e0b 0 6px, #1c1917 6px 12px)",
        }}
      />
      <span
        aria-hidden
        className="pointer-events-none absolute -top-1.5 left-1/2 z-30 flex size-4 -translate-x-1/2 items-center justify-center rounded-full bg-amber-500 text-white shadow ring-2 ring-background"
      >
        <TrafficConeIcon className="size-2.5" />
      </span>
      <span className="sr-only"> (under maintenance)</span>
    </>
  );
}

function Seg({
  to,
  active,
  icon,
  label,
  offline,
  className,
}: {
  to: string;
  active: boolean;
  icon: React.ReactNode;
  label: string;
  offline?: boolean;
  className?: string;
}) {
  return (
    <Link
      to={to}
      aria-current={active ? "page" : undefined}
      data-maintenance={offline ? "" : undefined}
      className={cn(SEG_BASE, active ? SEG_ACTIVE : SEG_IDLE, className)}
    >
      <span className="flex flex-col items-center gap-1">
        {icon}
        <span>{label}</span>
      </span>
      {offline ? <MaintenanceOverlay /> : null}
    </Link>
  );
}

/** The center Map "key": a flat segment matching its neighbors' height, filled
 *  primary only when selected. Always leads to the free-roam `/map` hub (which
 *  restores the camera the user last left), so from a park or ride detail page it
 *  takes you back out to the map rather than staying put. */
function MapButton({ active }: { active: boolean }) {
  return (
    <Link
      to="/map"
      aria-label="Map"
      aria-current={active ? "page" : undefined}
      className={cn(SEG_BASE, "z-20", active ? SEG_ACTIVE : SEG_IDLE)}
    >
      {/* Wrapped like `Seg` so the icon isn't a direct child of the link — that
          keeps SEG_BASE's `[&>svg]:size-5` from shrinking it, so Map's icon (and
          thus its height) matches the other segments' default-sized icons. */}
      <span className="flex flex-col items-center gap-1">
        <MapIcon />
        <span>Map</span>
      </span>
    </Link>
  );
}

/**
 * Floating "Play" key for Kingdom Hearts, riding above the center Map button. Only
 * shown on the free-roam `/map` (the surface play mode overlays) when the
 * `living-layer` flag is on. Tapping it toggles play mode; lit primary while active.
 */
function PlayButton() {
  const { playMode, hudExpanded } = useStore(playModeStore);
  // When a battle/drop panel owns the bottom band, slide the button down out of
  // the way so it never overlaps the panel; it eases back in when the panel closes.
  const tucked = playMode && hudExpanded;

  return (
    <button
      type="button"
      onClick={() => setPlayMode(!playMode)}
      aria-pressed={playMode}
      aria-hidden={tucked}
      tabIndex={tucked ? -1 : undefined}
      aria-label="Play — Kingdom Hearts"
      className={cn(
        "absolute bottom-[calc(100%+0.375rem)] left-1/2 z-10 flex -translate-x-1/2 select-none items-center gap-1.5 rounded-full border-3d px-4 py-2 text-sm font-semibold shadow-3d transition-[transform,opacity,box-shadow,background-color,color] duration-200 ease-out active:translate-y-[3px] active:[--btn-glare:var(--btn-3d)] active:shadow-3d-active dark:border-[color-mix(in_oklch,var(--border),white_25%)] [&>svg]:size-4",
        playMode
          ? "btn-3d-primary bg-primary text-primary-foreground"
          : "btn-3d-outline bg-background text-foreground",
        tucked
          ? "pointer-events-none translate-y-6 scale-90 opacity-0"
          : "pointer-events-auto opacity-100",
      )}
    >
      <SwordsIcon />
      Play
    </button>
  );
}

export function MobileBottomNav() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const livingEnabled = useLivingLayerEnabled();
  const offline = useMaintenanceFeatures();
  // Only the free-roam `/map` hub lights the Map key. A park (or ride) detail page
  // is a drill-down, not the map surface, so it leaves the key unselected.
  const mapActive = pathname === "/map";

  return (
    <nav
      aria-label="Primary"
      className="pointer-events-none fixed inset-x-0 bottom-0 z-40 flex justify-center md:hidden"
      style={{ paddingBottom: "max(var(--safe-bottom), 1rem)" }}
    >
      {livingEnabled && mapActive ? <PlayButton /> : null}
      {/* One connected row of equal-height segments; `items-end` aligns every
          segment's base so the bar reads as a single piece. */}
      <div className="pointer-events-auto mx-4 flex w-full max-w-md items-end">
        <Seg
          to="/"
          active={pathname === "/"}
          icon={<ActivityIcon />}
          label="Waits"
          className="rounded-bl-(--nav-corner-bl) rounded-tl-2xl"
        />
        <Seg
          to="/tickets"
          active={pathname.startsWith("/tickets")}
          icon={<TicketIcon />}
          label="Tickets"
          offline={offline.has("tickets")}
        />
        <MapButton active={mapActive} />
        <Seg
          to="/dining"
          active={pathname.startsWith("/dining")}
          icon={<UtensilsIcon />}
          label="Eats"
          offline={offline.has("dining")}
        />
        <Seg
          to="/stays"
          active={pathname.startsWith("/stays")}
          icon={<BedDoubleIcon />}
          label="Stays"
          offline={offline.has("stays")}
          className="rounded-br-(--nav-corner-br) rounded-tr-2xl"
        />
      </div>
    </nav>
  );
}
