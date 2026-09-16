"use client";

import type { Resort } from "#/components/ticket-pricing/shared.tsx";
import { ChipRail, RailChip } from "#/components/ui/rail.tsx";

const RESORT_CHIPS: ReadonlyArray<{ value: Resort; label: string; emoji: string }> = [
  { value: "WDW", label: "Walt Disney World", emoji: "🏰" },
  { value: "UOR", label: "Universal Orlando", emoji: "🌐" },
];

/**
 * Mobile-only quick resort filters — a horizontally scrolling chip row under the
 * header that narrows the ticket shelves to one resort. Mirrors
 * `DiningCuisineChips` / `StaysAreaChips`: tapping a chip
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
    <ChipRail role="group" aria-label="Filter by resort" className="md:hidden">
      {RESORT_CHIPS.map((c) => {
        const active = value === c.value;
        return (
          <RailChip
            key={c.value}
            aria-pressed={active}
            onClick={() => onChange(active ? null : c.value)}
            active={active}
          >
            <span aria-hidden>{c.emoji}</span>
            {c.label}
          </RailChip>
        );
      })}
    </ChipRail>
  );
}
