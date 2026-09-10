"use client";

import { useRideFilter } from "#/components/rides/ride-filter.tsx";
import { ChipRail, RailChip } from "#/components/ui/rail.tsx";

/**
 * Mobile-only quick attraction-type filters — a horizontally scrolling chip row
 * tucked under the header, narrowing the Waits list to a single ride category.
 * Shares state with `useRideFilter` (the same filter the map and drawer use), so
 * picking a chip here also scopes the map's ride markers. Mirrors
 * `DiningCuisineChips` / `StaysAreaChips`: tapping a chip selects only it,
 * tapping the active chip clears back to every category.
 */
export function RideCategoryChips({
  categories,
}: {
  categories: ReadonlyArray<{ key: string; label: string; emoji: string }>;
}) {
  const { filter, setFilter } = useRideFilter();
  if (!categories.length) return null;

  const active = filter.categories.size === 1 ? [...filter.categories][0] : null;

  const select = (key: string) => {
    setFilter((f) => ({
      ...f,
      categories: f.categories.size === 1 && f.categories.has(key) ? new Set() : new Set([key]),
    }));
  };

  return (
    <ChipRail role="group" aria-label="Filter by attraction type" className="md:hidden">
      {categories.map((c) => {
        const isActive = active === c.key;
        return (
          <RailChip
            key={c.key}
            aria-pressed={isActive}
            onClick={() => select(c.key)}
            active={isActive}
          >
            <span aria-hidden>{c.emoji}</span>
            {c.label}
          </RailChip>
        );
      })}
    </ChipRail>
  );
}
