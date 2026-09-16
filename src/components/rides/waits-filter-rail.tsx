import { RideFilterControls } from "#/components/rides/ride-filter-button.tsx";
import {
  EMPTY_RIDE_FILTER,
  rideFilterActive,
  useRideFilter,
} from "#/components/rides/ride-filter.tsx";
import { Button } from "#/components/ui/button.tsx";
import { cn } from "#/lib/utils.ts";

import { UNDER_TOOLBAR_MAX_HEIGHT, UNDER_TOOLBAR_TOP } from "./waits-chrome.ts";

import type { RIDE_CATEGORIES } from "#/components/rides/ride-filter.tsx";
import type { ParkPulse } from "./waits-data.ts";

/**
 * The desktop filter rail: every filter visible at once, no drawer. It renders
 * the *same* `RideFilterControls` the phone drawer opens (§3) — the rail is a
 * skin and a footer, not a second set of controls — inside a flat card that
 * sticks under the board's toolbar as the results scroll past it.
 *
 * Shown only while the map pane is off. The two are the same column: with the
 * map open the filters move into `WaitsFilterModal`, which renders these same
 * controls behind the toolbar's Filters button, because a list squeezed between
 * a filter column and a map reads as neither.
 *
 * The result count lives in the toolbar above (and is `aria-live` there, §9);
 * this footer says how much of the catalogue that is, and carries the reset.
 */
export function WaitsFilterRail({
  parks,
  categories,
  count,
  total,
}: {
  parks: ReadonlyArray<ParkPulse>;
  categories: typeof RIDE_CATEGORIES;
  count: number;
  total: number;
}) {
  const { filter, setFilter } = useRideFilter();
  const active = rideFilterActive(filter);
  return (
    <aside
      aria-label="Filter attractions"
      // Sticks under the masthead, whose height the header measures and
      // publishes on `:root` — hard-coding it would drift the first time the
      // ticker stripe changes size. Capped to the rest of the viewport so a
      // long rail scrolls inside itself rather than running off the page.
      // Sticks under the board's toolbar — see `waits-chrome.ts` for why those
      // two offsets are shared rather than written here.
      className={cn(
        "sticky hidden flex-col overflow-hidden rounded-[22px] border border-card-edge bg-card lg:flex",
        UNDER_TOOLBAR_TOP,
        UNDER_TOOLBAR_MAX_HEIGHT,
      )}
    >
      <RideFilterControls parks={parks} categories={categories} search className="min-h-0 flex-1" />
      <div className="flex items-center justify-between gap-2 border-t px-4 py-3">
        <span className="text-sm font-bold">
          {active ? `${count} of ${total} match` : `${total} attractions`}
        </span>
        {/* "Clear all", not "Reset": this and the chip row above the results
            do the same thing to the same state, so they say the same word and
            wear the same key. */}
        <Button
          variant="outline"
          size="sm"
          disabled={!active}
          onClick={() => setFilter(EMPTY_RIDE_FILTER)}
        >
          Clear all
        </Button>
      </div>
    </aside>
  );
}
