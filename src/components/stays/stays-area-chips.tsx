"use client";

import { areaEmoji, areaLabel } from "#/components/stays/stays-filters.ts";
import { ChipRail, RailChip } from "#/components/ui/rail.tsx";

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
    <ChipRail role="group" aria-label="Filter by resort area" className="md:hidden">
      {areas.map((a) => {
        const active = value === a;
        return (
          <RailChip
            key={a}
            aria-pressed={active}
            onClick={() => onChange(active ? null : a)}
            active={active}
          >
            <span aria-hidden>{areaEmoji(a)}</span>
            {areaLabel(a)}
          </RailChip>
        );
      })}
    </ChipRail>
  );
}
