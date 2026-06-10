import { ArrowUpDownIcon, SlidersHorizontalIcon } from "lucide-react";

import {
  STAY_SORT_LABELS,
  TIER_META,
  type StayFilters,
  type StaySortKey,
} from "#/components/stays/stays-filters.ts";
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
import { Label } from "#/components/ui/label.tsx";
import { Switch } from "#/components/ui/switch.tsx";
import { cn } from "#/lib/utils.ts";
import type { ResortTier } from "#/server/stays/resort-catalog.generated.ts";

export interface StaysControlsProps {
  tierFilter: ResortTier | "ALL";
  onTierFilter: (t: ResortTier | "ALL") => void;
  filters: StayFilters;
  onFilters: (patch: Partial<StayFilters>) => void;
  sortKey: StaySortKey;
  onSortKey: (k: StaySortKey) => void;
  activeCount: number;
  onClear: () => void;
}

const TIER_CHIPS: Array<{ key: ResortTier | "ALL"; label: string }> = [
  { key: "ALL", label: "All resorts" },
  ...TIER_META.map((t) => ({ key: t.key, label: t.label })),
];

/** A labeled rate toggle row used in the filter drawer. */
function ToggleRow({
  id,
  label,
  hint,
  checked,
  onCheckedChange,
}: {
  id: string;
  label: string;
  hint: string;
  checked: boolean;
  onCheckedChange: (next: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="flex flex-col gap-0.5">
        <Label htmlFor={id} className="text-sm font-medium">
          {label}
        </Label>
        <span className="text-muted-foreground text-xs">{hint}</span>
      </div>
      <Switch id={id} checked={checked} onCheckedChange={onCheckedChange} />
    </div>
  );
}

/**
 * Mobile-only control surface: a center-bottom FAB (above the safe area) with
 * Sort and Filter drawers, mirroring the dining board's `DiningMobileControls`.
 */
export function StaysMobileControls({
  tierFilter,
  onTierFilter,
  filters,
  onFilters,
  sortKey,
  onSortKey,
  activeCount,
  onClear,
}: StaysControlsProps) {
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
              <DrawerTitle>Sort resorts</DrawerTitle>
              <DrawerDescription>Choose how the list is ordered.</DrawerDescription>
            </DrawerHeader>
            <div className="flex flex-col gap-1 px-4 pb-4">
              {(Object.keys(STAY_SORT_LABELS) as Array<StaySortKey>).map((k) => (
                <DrawerClose key={k} asChild>
                  <Button
                    variant={sortKey === k ? "secondary" : "ghost"}
                    className="justify-start"
                    onClick={() => onSortKey(k)}
                  >
                    {STAY_SORT_LABELS[k]}
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
              <DrawerTitle>Filter resorts</DrawerTitle>
              <DrawerDescription>Narrow by resort type and rate.</DrawerDescription>
            </DrawerHeader>
            <div className="flex flex-col gap-5 overflow-y-auto px-4 pb-4">
              <div className="flex flex-col gap-2">
                <span className="text-muted-foreground text-xs font-medium uppercase">
                  Resort type
                </span>
                <div className="flex flex-wrap gap-2">
                  {TIER_CHIPS.map((c) => (
                    <Button
                      key={c.key}
                      type="button"
                      size="sm"
                      variant={tierFilter === c.key ? "default" : "outline"}
                      className="rounded-full"
                      onClick={() => onTierFilter(c.key)}
                    >
                      {c.label}
                    </Button>
                  ))}
                </div>
              </div>

              <div className="flex flex-col gap-4 border-t pt-5">
                <ToggleRow
                  id="drawer-fl"
                  label="Florida resident rates"
                  hint="Show discounted nightly rates for Florida residents."
                  checked={filters.floridaResident}
                  onCheckedChange={(v) => onFilters({ floridaResident: v })}
                />
                <ToggleRow
                  id="drawer-access"
                  label="Accessible rooms only"
                  hint="Limit results to rooms with accessibility features."
                  checked={filters.accessible}
                  onCheckedChange={(v) => onFilters({ accessible: v })}
                />
              </div>
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
