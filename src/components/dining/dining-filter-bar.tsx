import * as React from "react";
import { SearchIcon, SlidersHorizontalIcon, XIcon } from "lucide-react";

import { Button } from "#/components/ui/button.tsx";
import { Input } from "#/components/ui/input.tsx";
import { Label } from "#/components/ui/label.tsx";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "#/components/ui/select.tsx";
import { ToggleGroup, ToggleGroupItem } from "#/components/ui/toggle-group.tsx";
import {
  AVAILABILITY_LABELS,
  DAYS_OPTIONS,
  FEATURE_FILTERS,
  OPERATOR_LABELS,
  SORT_LABELS,
  type AvailabilityFilter,
  type DiningControlsProps,
  type FeatureKey,
  type Operator,
  type SortKey,
} from "#/components/dining/dining-filters.ts";
import { HOURS_LABELS, type HoursFilter } from "#/components/dining/dining-hours.ts";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label className="text-muted-foreground text-xs">{label}</Label>
      {children}
    </div>
  );
}

/** A labeled single-select that includes a leading "All" option. */
function AllSelect({
  label,
  value,
  onValueChange,
  allLabel,
  options,
  width = "w-40",
}: {
  label: string;
  value: string;
  onValueChange: (v: string) => void;
  allLabel: string;
  options: Array<string>;
  width?: string;
}) {
  const items: Record<string, string> = { ALL: allLabel };
  for (const o of options) items[o] = o;
  return (
    <Field label={label}>
      <Select value={value} onValueChange={(v) => v && onValueChange(v)} items={items}>
        <SelectTrigger size="sm" className={width} aria-label={label}>
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
    </Field>
  );
}

/**
 * One connected segmented row of feature toggles. Several of these stack to
 * cover all features — a single wrapping `ToggleGroup` renders square corners on
 * wrapped items, so we split features into fixed rows that never wrap instead.
 */
function FeatureGroup({
  row,
  selected,
  onChange,
}: {
  row: typeof FEATURE_FILTERS;
  selected: Array<FeatureKey>;
  onChange: (next: Array<FeatureKey>) => void;
}) {
  const rowKeys = row.map((f) => f.key);
  const value = selected.filter((k) => rowKeys.includes(k));
  return (
    <ToggleGroup
      multiple
      value={value}
      onValueChange={(v) =>
        onChange([...selected.filter((k) => !rowKeys.includes(k)), ...(v as Array<FeatureKey>)])
      }
      variant="outline"
      size="sm"
    >
      {row.map((f) => (
        <ToggleGroupItem key={f.key} value={f.key} className="px-3!">
          {f.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}

/**
 * Sticky desktop filter bar. Hidden on mobile (the bottom FAB drawer carries the
 * same controls there). Sticks to the top once the page header scrolls away. The
 * primary search + query-shaping controls stay visible; a "Filters" button
 * expands the rest (park, cuisine, experience, operator, price, hours, features).
 */
export function DiningFilterBar({
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
  const [expanded, setExpanded] = React.useState(false);
  // Pairs of features, each rendered as its own connected toggle group; the
  // container wraps between groups so they reflow without clipping at any width.
  const featureRows = Array.from({ length: Math.ceil(FEATURE_FILTERS.length / 2) }, (_, i) =>
    FEATURE_FILTERS.slice(i * 2, i * 2 + 2),
  );
  return (
    <div className="bg-background/95 supports-backdrop-filter:backdrop-blur sticky top-0 z-20 hidden border-b md:block">
      <div className="flex flex-wrap items-end gap-3 px-4 py-3 lg:px-6">
        <Field label="Search">
          <div className="relative">
            <SearchIcon className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
            <Input
              value={filters.search}
              onChange={(e) => onFilters({ search: e.target.value })}
              placeholder="Restaurant name"
              aria-label="Search restaurants"
              className="h-8 w-48 pl-9"
            />
          </div>
        </Field>

        <Field label="Filters">
          <Button
            variant={expanded ? "secondary" : "outline"}
            size="sm"
            onClick={() => setExpanded((e) => !e)}
            aria-expanded={expanded}
          >
            <SlidersHorizontalIcon data-icon="inline-start" />
            Filters{activeCount > 0 ? ` (${activeCount})` : ""}
          </Button>
        </Field>

        {/* Push the query-shaping controls (these refetch) to the right. */}
        <div className="ml-auto flex items-end gap-3">
          <Field label="Party size">
            <Select
              value={partySize}
              onValueChange={(v) => v && onPartySize(v)}
              items={Object.fromEntries(
                Array.from({ length: 8 }, (_, i) => [String(i + 1), String(i + 1)]),
              )}
            >
              <SelectTrigger size="sm" className="w-16" aria-label="Party size">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Array.from({ length: 8 }, (_, i) => (
                  <SelectItem key={i + 1} value={String(i + 1)}>
                    {i + 1}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field label="Window">
            <ToggleGroup
              multiple={false}
              value={[days]}
              onValueChange={(v) => onDays(v[0] ?? "30")}
              variant="outline"
              size="sm"
              className="*:data-[slot=toggle-group-item]:px-3!"
            >
              {DAYS_OPTIONS.map((o) => (
                <ToggleGroupItem key={o.value} value={o.value}>
                  {o.label}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </Field>

          <Field label="Sort by">
            <Select
              value={sortKey}
              onValueChange={(v) => v && onSortKey(v as SortKey)}
              items={SORT_LABELS}
            >
              <SelectTrigger size="sm" className="w-48" aria-label="Sort by">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(SORT_LABELS) as Array<SortKey>).map((k) => (
                  <SelectItem key={k} value={k}>
                    {SORT_LABELS[k]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          {activeCount > 0 && (
            <Button variant="ghost" size="sm" onClick={onClear} className="mb-px">
              <XIcon data-icon="inline-start" />
              Clear ({activeCount})
            </Button>
          )}
        </div>
      </div>

      {expanded && (
        <div className="flex flex-wrap items-end gap-x-6 gap-y-3 border-t px-4 py-3 lg:px-6">
          <AllSelect
            label="Park / Resort"
            value={filters.parkResort}
            onValueChange={(v) => onFilters({ parkResort: v })}
            allLabel="All parks"
            options={options.parks}
            width="w-48"
          />

          <AllSelect
            label="Cuisine"
            value={filters.cuisine}
            onValueChange={(v) => onFilters({ cuisine: v })}
            allLabel="All cuisines"
            options={options.cuisines}
          />

          <AllSelect
            label="Experience"
            value={filters.experienceType}
            onValueChange={(v) => onFilters({ experienceType: v })}
            allLabel="All types"
            options={options.experiences}
          />

          <Field label="Operator">
            <ToggleGroup
              multiple={false}
              value={[filters.operator]}
              onValueChange={(v) => onFilters({ operator: (v[0] as Operator) ?? "ALL" })}
              variant="outline"
              size="sm"
            >
              {(Object.keys(OPERATOR_LABELS) as Array<Operator>).map((k) => (
                <ToggleGroupItem key={k} value={k} className="px-3!">
                  {k === "ALL" ? "All" : OPERATOR_LABELS[k]}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </Field>

          {options.prices.length > 0 && (
            <Field label="Price">
              <ToggleGroup
                multiple
                value={filters.prices}
                onValueChange={(v) => onFilters({ prices: v })}
                variant="outline"
                size="sm"
              >
                {options.prices.map((p) => (
                  <ToggleGroupItem key={p} value={p} className="px-3!">
                    {p}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            </Field>
          )}

          <Field label="Availability">
            <ToggleGroup
              multiple={false}
              value={[filters.availability]}
              onValueChange={(v) =>
                onFilters({ availability: (v[0] as AvailabilityFilter) ?? "ALL" })
              }
              variant="outline"
              size="sm"
            >
              {(Object.keys(AVAILABILITY_LABELS) as Array<AvailabilityFilter>).map((k) => (
                <ToggleGroupItem key={k} value={k} className="px-3!">
                  {k === "ALL" ? "Any" : AVAILABILITY_LABELS[k]}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </Field>

          <Field label="Hours">
            <ToggleGroup
              multiple={false}
              value={[filters.hours]}
              onValueChange={(v) => onFilters({ hours: (v[0] as HoursFilter) ?? "ALL" })}
              variant="outline"
              size="sm"
            >
              {(Object.keys(HOURS_LABELS) as Array<HoursFilter>).map((k) => (
                <ToggleGroupItem key={k} value={k} className="px-3!">
                  {k === "ALL" ? "Any" : HOURS_LABELS[k]}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </Field>

          <Field label="Features">
            <div className="flex flex-wrap gap-2">
              {featureRows.map((row, i) => (
                <FeatureGroup
                  key={i}
                  row={row}
                  selected={filters.features}
                  onChange={(features) => onFilters({ features })}
                />
              ))}
            </div>
          </Field>
        </div>
      )}
    </div>
  );
}
