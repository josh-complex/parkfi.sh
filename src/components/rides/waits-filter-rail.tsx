import { RideFilterControls } from "#/components/rides/ride-filter-button.tsx";
import {
  EMPTY_RIDE_FILTER,
  rideFilterActive,
  useRideFilter,
} from "#/components/rides/ride-filter.tsx";
import { Button } from "#/components/ui/button.tsx";

import type { RIDE_CATEGORIES } from "#/components/rides/ride-filter.tsx";
import type { ParkPulse } from "./waits-data.ts";

/**
 * The desktop filter rail: every filter visible at once, no drawer. It renders
 * the *same* `RideFilterControls` the phone drawer opens (§3) — the rail is a
 * skin and a footer, not a second set of controls — inside a flat card that
 * sticks under the masthead as the results scroll past it.
 *
 * The count is `aria-live` so a screen-reader user hears the result of a filter
 * without hunting for it (§9).
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
      className="sticky top-[calc(var(--site-header-height)+1rem)] hidden max-h-[calc(100svh-var(--site-header-height)-2rem)] flex-col overflow-hidden rounded-[22px] border border-card-edge bg-card lg:flex"
    >
      <RideFilterControls parks={parks} categories={categories} search className="min-h-0 flex-1" />
      <div className="flex items-center justify-between gap-2 border-t px-4 py-3">
        <span className="text-sm font-bold" aria-live="polite">
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
