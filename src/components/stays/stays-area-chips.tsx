"use client";

import { areaEmoji, areaLabel } from "#/components/stays/stays-filters.ts";
import { cn } from "#/lib/utils.ts";

/**
 * Mobile-only quick area filters — a horizontally scrolling chip row that
 * narrows the browse shelves / results grid to a single Disney resort area.
 * Mirrors `DiningCuisineChips`, but scoped to `area` since tier already has
 * its own filter UI (and the shelf headings) elsewhere on the page.
 */
export function StaysAreaChips({
  areas,
  value,
  onChange,
}: {
  areas: Array<string>;
  value: string | null;
  onChange: (next: string | null) => void;
}) {
  if (!areas.length) return null;

  return (
    <div
      role="group"
      aria-label="Filter by resort area"
      className="flex snap-x scroll-pl-4 gap-1.5 overflow-x-auto px-4 py-2 [mask-image:linear-gradient(to_right,black_calc(100%-2rem),transparent)] [scrollbar-width:none] md:hidden [&::-webkit-scrollbar]:hidden"
    >
      {areas.map((a) => {
        const active = value === a;
        return (
          <button
            key={a}
            type="button"
            onClick={() => onChange(active ? null : a)}
            className={cn(
              "flex shrink-0 snap-start items-center gap-1 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
              active
                ? "border-foreground bg-foreground text-background"
                : "border-border text-muted-foreground hover:border-foreground/40 hover:text-foreground",
            )}
          >
            <span aria-hidden>{areaEmoji(a)}</span>
            {areaLabel(a)}
          </button>
        );
      })}
    </div>
  );
}
