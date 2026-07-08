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
 * edge-to-edge connected segments forming one continuous bar, with the center Map
 * key taller and on a deeper 3D shelf so it rises out of the row. Bottoms align
 * (`items-end`) so the bar reads as one piece. Hidden on desktop (`md:hidden`),
 * where the sidebar takes over. `fixed`, so it floats over the page (notably the
 * fullscreen `/map`) without consuming layout.
 */
const SEG_BASE =
  "relative top-0 -ml-px flex flex-1 flex-col items-center justify-center gap-1 border-3d btn-3d-outline shadow-3d bg-background dark:bg-muted/95 px-2 py-2.5 text-sm font-medium transition-[top,box-shadow,background-color,color] duration-150 ease-out first:ml-0 active:top-[3px] active:[--btn-glare:var(--btn-3d)] active:shadow-3d-active dark:border-[color-mix(in_oklch,var(--border),white_25%)] [&>svg]:size-5";
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
  contentClassName,
}: {
  to: string;
  active: boolean;
  icon: React.ReactNode;
  label: string;
  offline?: boolean;
  className?: string;
  contentClassName?: string;
}) {
  return (
    <Link
      to={to}
      aria-current={active ? "page" : undefined}
      data-maintenance={offline ? "" : undefined}
      className={cn(SEG_BASE, active ? SEG_ACTIVE : SEG_IDLE, className)}
    >
      {/* Tickets/Eats extend under the Map key via negative margin on the outer
          link; that widens their box on the Map-facing side, so the icon+label
          are re-centered here to counter it and stay visually aligned under the
          segment's visible (non-overlapped) width. */}
      <span className={cn("flex flex-col items-center gap-1", contentClassName)}>
        {icon}
        <span>{label}</span>
      </span>
      {offline ? <MaintenanceOverlay /> : null}
    </Link>
  );
}

/** The center Map "key": connected to its neighbors but taller (rises above the
 *  row) and on a deeper 3D shelf, filled primary. Always leads to the free-roam
 *  `/map` hub (which restores the camera the user last left), so from a park or
 *  ride detail page it takes you back out to the map rather than staying put. */
function MapButton({ active }: { active: boolean }) {
  return (
    <Link
      to="/map"
      aria-label="Map"
      aria-current={active ? "page" : undefined}
      className={cn(
        // Same 3px shelf as the side segments (bottoms line up via items-end); its
        // "bigger" feel is the extra height (rises above the row) + larger icon, not
        // a deeper shadow. White/outline like the others when idle; only the
        // selected state fills primary and depresses (sinks 3px onto a flat shelf).
        "relative top-0 z-20 -ml-px flex flex-1 flex-col items-center justify-center gap-1 rounded-t-2xl border-3d shadow-3d px-2 py-3 text-sm font-medium transition-[top,box-shadow,background-color,color] duration-150 ease-out active:top-[3px] active:[--btn-glare:var(--btn-3d)] active:shadow-3d-active dark:border-[color-mix(in_oklch,var(--border),white_25%)] [&>svg]:size-7",
        active
          ? "top-[3px] btn-3d-primary bg-primary text-primary-foreground [--btn-glare:var(--btn-3d)] shadow-3d-active"
          : "btn-3d-outline bg-background dark:bg-muted/95 text-foreground",
      )}
    >
      <MapIcon />
      <span>Map</span>
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
      style={{ paddingBottom: "max(var(--safe-bottom), 0.5rem)" }}
    >
      {livingEnabled && mapActive ? <PlayButton /> : null}
      {/* One connected row; `items-end` aligns every segment's base so the bar is
          a single piece, with the taller Map key rising out of the middle. */}
      <div className="pointer-events-auto mx-3 flex w-full max-w-md items-end">
        <Seg
          to="/"
          active={pathname === "/"}
          icon={<ActivityIcon />}
          label="Waits"
          className="rounded-l-3xl"
        />
        <Seg
          to="/tickets"
          active={pathname.startsWith("/tickets")}
          icon={<TicketIcon />}
          label="Tickets"
          offline={offline.has("tickets")}
          className="-mr-2"
          contentClassName="-translate-x-1"
        />
        <MapButton active={mapActive} />
        <Seg
          to="/dining"
          active={pathname.startsWith("/dining")}
          icon={<UtensilsIcon />}
          label="Eats"
          offline={offline.has("dining")}
          className="-ml-2"
          contentClassName="translate-x-1"
        />
        <Seg
          to="/stays"
          active={pathname.startsWith("/stays")}
          icon={<BedDoubleIcon />}
          label="Stays"
          offline={offline.has("stays")}
          className="rounded-r-3xl"
        />
      </div>
    </nav>
  );
}
