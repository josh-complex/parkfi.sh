import { SlidersHorizontalIcon } from "lucide-react";

import { Button } from "#/components/ui/button.tsx";
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "#/components/ui/drawer.tsx";
import { cn } from "#/lib/utils.ts";

import {
  EMPTY_RIDE_FILTER,
  MAX_WAIT_OPTIONS,
  rideFilterCount,
  useRideFilter,
} from "./ride-filter.tsx";

/**
 * The map's filter-pill look, shared verbatim by every mobile filter/sort FAB so
 * they match the map's bottom-left `Filter` button exactly. It's the same
 * embossed 3D pill the map renders — a `DrawerTrigger`/`button` gets this class,
 * with an icon (auto-sized to `size-4`) + label as children. Each surface owns
 * its own drawer content; only the trigger's design is shared.
 */
export const MAP_FILTER_PILL =
  "btn-3d-outline border-3d shadow-3d pointer-events-auto inline-flex w-fit items-center gap-1.5 rounded-full bg-background px-4 py-2 text-sm font-medium transition active:scale-95 dark:border-[color-mix(in_oklch,var(--border),white_25%)] [&>svg]:size-4";

/** Vertical stack wrapper matching the map's bottom-left control cluster:
 *  left-anchored, above the mobile nav island, mobile-only. */
export const MAP_FILTER_STACK =
  "pointer-events-none fixed left-3 z-40 flex flex-col items-start gap-2 md:hidden";

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Button
      type="button"
      size="sm"
      variant={active ? "default" : "outline"}
      className="rounded-full"
      onClick={onClick}
    >
      {children}
    </Button>
  );
}

/**
 * The filter body (max-wait chips + toggles), writing straight to the shared
 * `useRideFilter` state. Shared by the map/Waits filter button and the Waits
 * floating FAB so both drawers offer the exact same controls.
 */
export function RideFilterControls() {
  const { filter, setFilter } = useRideFilter();
  return (
    <div className="flex flex-col gap-6 overflow-y-auto px-4 pb-4 pt-6">
      <div className="flex flex-col gap-2">
        <span className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
          Max wait
        </span>
        <div className="flex flex-wrap gap-2 pt-1">
          <Chip
            active={filter.maxWait == null}
            onClick={() => setFilter((f) => ({ ...f, maxWait: null }))}
          >
            Any
          </Chip>
          {MAX_WAIT_OPTIONS.map((w) => (
            <Chip
              key={w}
              active={filter.maxWait === w}
              onClick={() => setFilter((f) => ({ ...f, maxWait: f.maxWait === w ? null : w }))}
            >
              ≤ {w}m
            </Chip>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap gap-2 border-t pt-4">
        <Chip
          active={filter.openOnly}
          onClick={() => setFilter((f) => ({ ...f, openOnly: !f.openOnly }))}
        >
          Open now
        </Chip>
        <Chip
          active={filter.noHeightReq}
          onClick={() => setFilter((f) => ({ ...f, noHeightReq: !f.noHeightReq }))}
        >
          No height requirement
        </Chip>
      </div>
    </div>
  );
}

/** Footer actions for a ride-filter drawer: clear-all + a close button. */
export function RideFilterFooter({ closeLabel = "Show rides" }: { closeLabel?: string }) {
  const { setFilter } = useRideFilter();
  return (
    <DrawerFooter className="flex-row gap-2">
      <Button
        variant="outline"
        className="flex-1 rounded-full"
        onClick={() => setFilter(EMPTY_RIDE_FILTER)}
      >
        Clear all
      </Button>
      <DrawerClose asChild>
        <Button className="flex-1 rounded-full">{closeLabel}</Button>
      </DrawerClose>
    </DrawerFooter>
  );
}

/**
 * Ride filter trigger + drawer, shared by the map and the Waits list. Renders a
 * pill button (with an active-count badge) that opens a bottom drawer of filter
 * controls; everything writes straight to the shared `useRideFilter` state.
 * Pass `className` to position/skin the trigger for each surface.
 */
export function RideFilterButton({ className }: { className?: string }) {
  const { filter } = useRideFilter();
  const count = rideFilterCount(filter);

  return (
    <Drawer>
      <DrawerTrigger
        className={cn(
          "btn-3d-outline border-3d shadow-3d inline-flex w-fit items-center gap-2 rounded-full bg-background px-4.5 py-2.5 text-base font-medium transition active:scale-95 dark:border-[color-mix(in_oklch,var(--border),white_25%)]",
          className,
        )}
      >
        <SlidersHorizontalIcon className="size-5" />
        Filter
        {count > 0 && (
          <span className="bg-primary text-primary-foreground ml-0.5 inline-flex min-w-[1.25rem] items-center justify-center rounded-full px-1 text-xs font-bold leading-[1.25rem]">
            {count}
          </span>
        )}
      </DrawerTrigger>
      <DrawerContent>
        <DrawerHeader className="border-b pb-4">
          <DrawerTitle>Filter rides</DrawerTitle>
        </DrawerHeader>
        <RideFilterControls />
        <RideFilterFooter />
      </DrawerContent>
    </Drawer>
  );
}
