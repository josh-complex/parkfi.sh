"use client";

import type { Resort } from "#/components/ticket-pricing/shared.tsx";
import { cn } from "#/lib/utils.ts";

const RESORT_CHIPS: ReadonlyArray<{ value: Resort; label: string; emoji: string }> = [
  { value: "WDW", label: "Walt Disney World", emoji: "🏰" },
  { value: "UOR", label: "Universal Orlando", emoji: "🌐" },
];

/**
 * Mobile-only quick resort filters — a horizontally scrolling chip row under the
 * header that narrows the ticket shelves to one resort. Mirrors
 * `DiningCuisineChips` / `StaysAreaChips` / `RideCategoryChips`: tapping a chip
 * selects only it, tapping the active chip clears back to every resort.
 */
export function TicketsResortChips({
  value,
  onChange,
}: {
  value: Resort | null;
  onChange: (next: Resort | null) => void;
}) {
  return (
    <div
      role="group"
      aria-label="Filter by resort"
      className="flex snap-x scroll-pl-4 gap-1.5 overflow-x-auto px-4 py-2 [mask-image:linear-gradient(to_right,black_calc(100%-2rem),transparent)] [scrollbar-width:none] md:hidden [&::-webkit-scrollbar]:hidden"
    >
      {RESORT_CHIPS.map((c) => {
        const active = value === c.value;
        return (
          <button
            key={c.value}
            type="button"
            onClick={() => onChange(active ? null : c.value)}
            className={cn(
              "flex shrink-0 snap-start items-center gap-1 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
              active
                ? "border-foreground bg-foreground text-background"
                : "border-border text-muted-foreground hover:border-foreground/40 hover:text-foreground",
            )}
          >
            <span aria-hidden>{c.emoji}</span>
            {c.label}
          </button>
        );
      })}
    </div>
  );
}
