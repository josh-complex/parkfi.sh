"use client";

import { useStore } from "@tanstack/react-store";

import { commitSearch, diningStore, patchFilters } from "#/components/dining/dining-store.ts";
import { cuisineEmoji } from "#/components/dining/dining-filters.ts";
import { cn } from "#/lib/utils.ts";

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
    <div
      role="group"
      aria-label="Filter by cuisine"
      className="flex snap-x scroll-pl-4 gap-1.5 overflow-x-auto px-4 py-2 [mask-image:linear-gradient(to_right,black_calc(100%-2rem),transparent)] [scrollbar-width:none] md:hidden [&::-webkit-scrollbar]:hidden"
    >
      {chips.map((c) => {
        const active = cuisine === c;
        return (
          <button
            key={c}
            type="button"
            onClick={() => select(active ? "ALL" : c)}
            className={cn(
              "flex shrink-0 snap-start items-center gap-1 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
              active
                ? "border-foreground bg-foreground text-background"
                : "border-border text-muted-foreground hover:border-foreground/40 hover:text-foreground",
            )}
          >
            <span aria-hidden>{cuisineEmoji(c)}</span>
            {c}
          </button>
        );
      })}
    </div>
  );
}
