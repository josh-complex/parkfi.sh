import { SlidersHorizontalIcon } from "lucide-react";

import { RideFilterControls } from "#/components/rides/ride-filter-button.tsx";
import {
  EMPTY_RIDE_FILTER,
  rideFilterActive,
  useRideFilter,
} from "#/components/rides/ride-filter.tsx";
import { Button } from "#/components/ui/button.tsx";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "#/components/ui/dialog.tsx";
import { cn } from "#/lib/utils.ts";

import type { RIDE_CATEGORIES } from "#/components/rides/ride-filter.tsx";
import type { ParkPulse } from "./waits-data.ts";

/**
 * The board's filters, as a modal.
 *
 * This replaces the permanent desktop rail. The rail was the right shape when
 * the results owned the whole page and had a column to spare; with the map pane
 * taking the right half, a filter column on the left left the list squeezed
 * between two panels and reading as neither. So the filters do what every
 * map-and-list surface does with them — they wait behind one button and take
 * the middle of the screen when asked, exactly as the phone drawer already did.
 *
 * Same `RideFilterControls` as the drawer and the map, so the two faces can't
 * drift apart (docs/plans/waits-redesign §3); this file is a trigger, a frame
 * and a footer.
 */
export function WaitsFilterModal({
  parks,
  categories,
  /** How many attractions the current filter matches — the footer's promise. */
  count,
  total,
  /** Live filter count for the trigger's badge. */
  activeCount,
  className,
}: {
  parks: ReadonlyArray<ParkPulse>;
  categories: typeof RIDE_CATEGORIES;
  count: number;
  total: number;
  activeCount: number;
  className?: string;
}) {
  const { filter, setFilter } = useRideFilter();
  const active = rideFilterActive(filter);
  return (
    <Dialog>
      <DialogTrigger
        render={
          <Button
            variant="outline"
            size="sm"
            className={cn("min-h-10", activeCount > 0 && "border-foreground", className)}
          />
        }
      >
        <SlidersHorizontalIcon data-icon="inline-start" />
        Filters
        {activeCount > 0 && (
          <span className="ml-0.5 inline-flex size-5 items-center justify-center rounded-full bg-foreground text-[11px] font-bold tabular-nums text-background">
            {activeCount}
          </span>
        )}
      </DialogTrigger>
      <DialogContent className="grid-rows-[auto_minmax(0,1fr)_auto] gap-0 overflow-hidden p-0 sm:max-w-[38rem] max-h-[86svh]">
        <DialogHeader className="border-b px-6 py-4 pr-16">
          <DialogTitle className="text-base">Filters</DialogTitle>
          <DialogDescription className="sr-only">
            Narrow the board by park, attraction type, wait, and rider height.
          </DialogDescription>
        </DialogHeader>

        <RideFilterControls parks={parks} categories={categories} search className="min-h-0 px-6" />

        <DialogFooter className="flex-row items-center justify-between gap-3 border-t px-6 py-4">
          {/* Same word and the same job as the chip row's — see the rail this
              replaced. Disabled rather than hidden so the footer doesn't
              re-flow the moment a filter is set. */}
          <Button
            variant="ghost"
            className="underline underline-offset-4"
            disabled={!active}
            onClick={() => setFilter(EMPTY_RIDE_FILTER)}
          >
            Clear all
          </Button>
          <DialogClose render={<Button className="rounded-full px-5" />}>
            {active ? `Show ${count} attractions` : `Show all ${total}`}
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
