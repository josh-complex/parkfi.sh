"use client";

import { useRideFilter } from "#/components/rides/ride-filter.tsx";
import { cn } from "#/lib/utils.ts";

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
  categories: ReadonlyArray<{ key: string; label: string }>;
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
    <div
      role="group"
      aria-label="Filter by attraction type"
      className="flex snap-x scroll-pl-4 gap-1.5 overflow-x-auto px-4 py-2 [mask-image:linear-gradient(to_right,black_calc(100%-2rem),transparent)] [scrollbar-width:none] md:hidden [&::-webkit-scrollbar]:hidden"
    >
      {categories.map((c) => {
        const isActive = active === c.key;
        return (
          <button
            key={c.key}
            type="button"
            onClick={() => select(c.key)}
            className={cn(
              "flex shrink-0 snap-start items-center gap-1 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
              isActive
                ? "border-foreground bg-foreground text-background"
                : "border-border text-muted-foreground hover:border-foreground/40 hover:text-foreground",
            )}
          >
            {c.label}
          </button>
        );
      })}
    </div>
  );
}
