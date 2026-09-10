"use client";

import { useStore } from "@tanstack/react-store";

import { commitSearch, diningStore, patchFilters } from "#/components/dining/dining-store.ts";
import { cuisineEmoji } from "#/components/dining/dining-filters.ts";

import { ChipRail, RailChip } from "#/components/ui/rail.tsx";

import type { FilterOptions } from "#/components/dining/dining-filters.ts";

/** How many quick-filter chips to surface — the most common cuisines. */
const CHIP_LIMIT = 10;

/**
 * Mobile-only quick cuisine filters — a horizontally scrolling chip row under
 * the header showing the ten most common cuisines. Tapping a chip narrows to it
 * and commits the search; tapping the active chip clears it back to every
 * cuisine. Desktop keeps the cuisine segment in the search pill instead.
 */
export function DiningCuisineChips({ options }: { options: FilterOptions }) {
  const cuisine = useStore(diningStore, (s) => s.filters.cuisine);
  if (!options.cuisines.length) return null;

  const chips = options.cuisines.slice(0, CHIP_LIMIT);

  const select = (value: string) => {
    patchFilters({ cuisine: value });
    if (value !== "ALL") commitSearch();
  };

  return (
    <ChipRail role="group" aria-label="Filter by cuisine" className="md:hidden">
      {chips.map((c) => {
        const active = cuisine === c;
        return (
          <RailChip
            key={c}
            aria-pressed={active}
            onClick={() => select(active ? "ALL" : c)}
            active={active}
          >
            <span aria-hidden>{cuisineEmoji(c)}</span>
            {c}
          </RailChip>
        );
      })}
    </ChipRail>
  );
}
