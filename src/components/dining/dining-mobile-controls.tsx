import * as React from "react";
import { ArrowUpDownIcon, SearchIcon, SlidersHorizontalIcon } from "lucide-react";

import { Button } from "#/components/ui/button.tsx";
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "#/components/ui/drawer.tsx";
import { Input } from "#/components/ui/input.tsx";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "#/components/ui/select.tsx";
import {
  AVAILABILITY_LABELS,
  DAYS_OPTIONS,
  OPERATOR_LABELS,
  SORT_LABELS,
  type AvailabilityFilter,
  type DiningControlsProps,
  type Operator,
  type SortKey,
} from "#/components/dining/dining-filters.ts";
import { cn } from "#/lib/utils.ts";

/** Row of single-select pills used throughout the filter drawer. */
function PillRow<T extends string>({
  options,
  value,
  onSelect,
  labelOf,
}: {
  options: Array<T>;
  value: T;
  onSelect: (v: T) => void;
  labelOf: (v: T) => string;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((o) => (
        <Button
          key={o}
          type="button"
          size="sm"
          variant={value === o ? "default" : "outline"}
          className="rounded-full"
          onClick={() => onSelect(o)}
        >
          {labelOf(o)}
        </Button>
      ))}
    </div>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-muted-foreground text-xs font-medium uppercase">{label}</span>
      {children}
    </div>
  );
}

/** A single-select dropdown with a leading "All" option, for long option lists. */
function AllSelect({
  value,
  onValueChange,
  allLabel,
  options,
  ariaLabel,
}: {
  value: string;
  onValueChange: (v: string) => void;
  allLabel: string;
  options: Array<string>;
  ariaLabel: string;
}) {
  const items: Record<string, string> = { ALL: allLabel };
  for (const o of options) items[o] = o;
  return (
    <Select value={value} onValueChange={(v) => v && onValueChange(v)} items={items}>
      <SelectTrigger size="sm" className="w-full" aria-label={ariaLabel}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="ALL">{allLabel}</SelectItem>
        {options.map((o) => (
          <SelectItem key={o} value={o}>
            {o}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/**
 * Mobile-only control surface: a center-bottom FAB (above the safe area) with
 * Sort and Filter drawers, mirroring the ride board's `MobileControls`. Carries
 * every control the sticky desktop bar shows.
 */
export function DiningMobileControls({
  filters,
  onFilters,
  options,
  sortKey,
  onSortKey,
  partySize,
  onPartySize,
  days,
  onDays,
  activeCount,
  onClear,
}: DiningControlsProps) {
  return (
    <div
      className="fixed left-1/2 z-40 -translate-x-1/2 md:hidden"
      style={{ bottom: "calc(env(safe-area-inset-bottom) + 1rem)" }}
    >
      <div className="bg-popover/95 supports-backdrop-filter:backdrop-blur flex items-center gap-1 rounded-full border p-1 shadow-xl">
        {/* Sort */}
        <Drawer>
          <DrawerTrigger asChild>
            <Button variant="ghost" size="sm" className="rounded-full">
              <ArrowUpDownIcon data-icon="inline-start" />
              Sort
            </Button>
          </DrawerTrigger>
          <DrawerContent>
            <DrawerHeader>
              <DrawerTitle>Sort restaurants</DrawerTitle>
              <DrawerDescription>Choose how the list is ordered.</DrawerDescription>
            </DrawerHeader>
            <div className="flex flex-col gap-1 px-4 pb-4">
              {(Object.keys(SORT_LABELS) as Array<SortKey>).map((k) => (
                <DrawerClose key={k} asChild>
                  <Button
                    variant={sortKey === k ? "secondary" : "ghost"}
                    className="justify-start"
                    onClick={() => onSortKey(k)}
                  >
                    {SORT_LABELS[k]}
                  </Button>
                </DrawerClose>
              ))}
            </div>
          </DrawerContent>
        </Drawer>

        <span className="bg-border h-5 w-px" />

        {/* Filter */}
        <Drawer>
          <DrawerTrigger asChild>
            <Button variant="ghost" size="sm" className="rounded-full">
              <SlidersHorizontalIcon data-icon="inline-start" />
              Filter
              {activeCount > 0 ? <span className="bg-primary size-1.5 rounded-full" /> : null}
            </Button>
          </DrawerTrigger>
          <DrawerContent>
            <DrawerHeader>
              <DrawerTitle>Filter restaurants</DrawerTitle>
              <DrawerDescription>Narrow the list by park, cuisine, and more.</DrawerDescription>
            </DrawerHeader>
            <div className="flex flex-col gap-5 overflow-y-auto px-4 pb-4">
              <div className="relative">
                <SearchIcon className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
                <Input
                  value={filters.search}
                  onChange={(e) => onFilters({ search: e.target.value })}
                  placeholder="Search by name"
                  aria-label="Search restaurants"
                  className="pl-9"
                />
              </div>

              <Section label="Park / Resort">
                <AllSelect
                  value={filters.parkResort}
                  onValueChange={(v) => onFilters({ parkResort: v })}
                  allLabel="All parks"
                  options={options.parks}
                  ariaLabel="Park or resort"
                />
              </Section>

              <Section label="Cuisine">
                <AllSelect
                  value={filters.cuisine}
                  onValueChange={(v) => onFilters({ cuisine: v })}
                  allLabel="All cuisines"
                  options={options.cuisines}
                  ariaLabel="Cuisine"
                />
              </Section>

              <Section label="Experience">
                <AllSelect
                  value={filters.experienceType}
                  onValueChange={(v) => onFilters({ experienceType: v })}
                  allLabel="All types"
                  options={options.experiences}
                  ariaLabel="Experience type"
                />
              </Section>

              <Section label="Operator">
                <PillRow
                  options={Object.keys(OPERATOR_LABELS) as Array<Operator>}
                  value={filters.operator}
                  onSelect={(v) => onFilters({ operator: v })}
                  labelOf={(v) => OPERATOR_LABELS[v]}
                />
              </Section>

              {options.prices.length > 0 && (
                <Section label="Price">
                  <div className="flex flex-wrap gap-2">
                    {options.prices.map((p) => {
                      const on = filters.prices.includes(p);
                      return (
                        <Button
                          key={p}
                          type="button"
                          size="sm"
                          variant={on ? "default" : "outline"}
                          className="rounded-full"
                          onClick={() =>
                            onFilters({
                              prices: on
                                ? filters.prices.filter((x) => x !== p)
                                : [...filters.prices, p],
                            })
                          }
                        >
                          {p}
                        </Button>
                      );
                    })}
                  </div>
                </Section>
              )}

              <Section label="Availability">
                <PillRow
                  options={Object.keys(AVAILABILITY_LABELS) as Array<AvailabilityFilter>}
                  value={filters.availability}
                  onSelect={(v) => onFilters({ availability: v })}
                  labelOf={(v) => AVAILABILITY_LABELS[v]}
                />
              </Section>

              <Section label="Party size">
                <PillRow
                  options={Array.from({ length: 8 }, (_, i) => String(i + 1))}
                  value={partySize}
                  onSelect={onPartySize}
                  labelOf={(v) => v}
                />
              </Section>

              <Section label="Availability window">
                <PillRow
                  options={DAYS_OPTIONS.map((o) => o.value)}
                  value={days}
                  onSelect={onDays}
                  labelOf={(v) => DAYS_OPTIONS.find((o) => o.value === v)?.label ?? v}
                />
              </Section>
            </div>
            <DrawerFooter className="flex-row gap-2">
              <Button
                variant="outline"
                className={cn("flex-1", activeCount === 0 && "opacity-50")}
                disabled={activeCount === 0}
                onClick={onClear}
              >
                Clear filters
              </Button>
              <DrawerClose asChild>
                <Button className="flex-1">Done</Button>
              </DrawerClose>
            </DrawerFooter>
          </DrawerContent>
        </Drawer>
      </div>
    </div>
  );
}
