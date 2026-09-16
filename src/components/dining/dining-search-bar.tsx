"use client";

import * as React from "react";
import { useStore } from "@tanstack/react-store";
import { ArrowUpDownIcon, SlidersHorizontalIcon } from "lucide-react";

import {
  CoreSearchBar,
  CoreSearchButton,
  CoreSearchOption,
  CoreSearchPanel,
  type CoreField,
} from "#/components/core-search.tsx";
import { ExtendedFilters } from "#/components/dining/dining-filters-modal.tsx";
import {
  clearExtraFilters,
  commitSearch,
  diningStore,
  patchFilters,
  setPartySize,
  setSort,
} from "#/components/dining/dining-store.ts";
import {
  countExtraFilters,
  OPERATOR_LABELS,
  SORT_OPTIONS,
  type FilterOptions,
  type Operator,
} from "#/components/dining/dining-filters.ts";
import { SortRows } from "#/components/ui/sort-menu.tsx";
import { MAP_FILTER_PILL, MAP_FILTER_STACK } from "#/components/rides/ride-filter-button.tsx";
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
import { cn } from "#/lib/utils.ts";

/** Party-size choices shared by the desktop pill and the mobile search drawer. */
const PARTY_SIZE_OPTIONS = Array.from({ length: 8 }, (_, i) => String(i + 1));

function partySizeLabel(size: string): string {
  return `${size} ${size === "1" ? "guest" : "guests"}`;
}

/** The bar's fields, in the order they sit on the row. */
type DiningSeg = "operator" | "where" | "cuisine" | "party";

/** Desktop sticky search bar — hidden on mobile, the FAB carries it there. */
export function DiningSearchBar({ options }: { options: FilterOptions }) {
  const filters = useStore(diningStore, (s) => s.filters);
  const partySize = useStore(diningStore, (s) => s.partySize);
  const searched = useStore(diningStore, (s) => s.searched);
  const stuck = useStore(diningStore, (s) => s.stuck);

  // One open field at a time — the four share a single panel, which slides
  // between them rather than closing and reopening (see `CoreSearchBar`).
  const [openSeg, setOpenSeg] = React.useState<DiningSeg | null>(null);
  const close = React.useCallback(() => setOpenSeg(null), []);

  // Switching operator drops a now-invalid park selection back to "all".
  const selectOperator = React.useCallback(
    (op: Operator) => {
      const valid = options.parksByOperator[op];
      patchFilters({
        operator: op,
        parkResort:
          filters.parkResort !== "ALL" && !valid.includes(filters.parkResort)
            ? "ALL"
            : filters.parkResort,
      });
      setOpenSeg(null);
    },
    [options.parksByOperator, filters.parkResort],
  );

  const parkOptions = options.parksByOperator[filters.operator];
  const operatorLabel = OPERATOR_LABELS[filters.operator];
  const whereLabel = filters.parkResort === "ALL" ? "All restaurants" : filters.parkResort;
  const cuisineLabel = filters.cuisine === "ALL" ? "All cuisines" : filters.cuisine;

  const fields: Array<CoreField<DiningSeg>> = [
    {
      key: "operator",
      label: "Parks",
      value: operatorLabel,
      muted: filters.operator === "ALL",
      panel: (
        <CoreSearchPanel>
          {(Object.keys(OPERATOR_LABELS) as Array<Operator>).map((op) => (
            <CoreSearchOption
              key={op}
              label={OPERATOR_LABELS[op]}
              selected={filters.operator === op}
              onSelect={() => selectOperator(op)}
            />
          ))}
        </CoreSearchPanel>
      ),
    },
    {
      key: "where",
      label: "Where",
      value: whereLabel,
      muted: filters.parkResort === "ALL",
      panel: (
        <CoreSearchPanel
          hint={`${parkOptions.length} parks & resorts${
            filters.operator === "ALL" ? "" : ` · ${operatorLabel}`
          }`}
        >
          <CoreSearchOption
            label="All restaurants"
            selected={filters.parkResort === "ALL"}
            onSelect={() => {
              patchFilters({ parkResort: "ALL" });
              close();
            }}
          />
          {parkOptions.map((p) => (
            <CoreSearchOption
              key={p}
              label={p}
              selected={filters.parkResort === p}
              onSelect={() => {
                patchFilters({ parkResort: p });
                close();
              }}
            />
          ))}
        </CoreSearchPanel>
      ),
    },
    {
      key: "cuisine",
      label: "Cuisine",
      value: cuisineLabel,
      muted: filters.cuisine === "ALL",
      panel: (
        <CoreSearchPanel hint="Most common first">
          <CoreSearchOption
            label="All cuisines"
            selected={filters.cuisine === "ALL"}
            onSelect={() => {
              patchFilters({ cuisine: "ALL" });
              close();
            }}
          />
          {options.cuisines.map((c) => (
            <CoreSearchOption
              key={c}
              label={c}
              selected={filters.cuisine === c}
              onSelect={() => {
                patchFilters({ cuisine: c });
                close();
              }}
            />
          ))}
        </CoreSearchPanel>
      ),
    },
    {
      key: "party",
      label: "Party size",
      value: partySizeLabel(partySize),
      panel: (
        <CoreSearchPanel hint="Larger parties book further out">
          {PARTY_SIZE_OPTIONS.map((n) => (
            <CoreSearchOption
              key={n}
              label={partySizeLabel(n)}
              selected={partySize === n}
              onSelect={() => {
                setPartySize(n);
                close();
              }}
            />
          ))}
        </CoreSearchPanel>
      ),
    },
  ];

  return (
    <div
      className={cn(
        "sticky top-(--header-height) z-20 hidden px-4 py-4 transition duration-300 ease-out md:top-0 md:block lg:px-6",
        stuck
          ? "bg-background/80 border-b backdrop-blur-md"
          : "border-b border-transparent bg-transparent",
      )}
    >
      <CoreSearchBar
        fields={fields}
        open={openSeg}
        onOpenChange={setOpenSeg}
        // Sized to "Disney's Grand Floridian Resort & Spa" — the longest label
        // any of the four lists holds.
        panelWidth={320}
        action={!searched && <CoreSearchButton onClick={commitSearch} />}
      />
    </div>
  );
}

/** Mobile floating action button — owns search, sort, and filters drawers. */
export function DiningMobileFAB({ options }: { options: FilterOptions }) {
  const sortKey = useStore(diningStore, (s) => s.sortKey);
  const sortDir = useStore(diningStore, (s) => s.sortDir);
  const searched = useStore(diningStore, (s) => s.searched);
  const extraCount = useStore(diningStore, (s) => countExtraFilters(s.filters));
  // The park selector lives inside this drawer on mobile (no search pill here),
  // so its active state feeds the badge dot and enables "Clear all" too.
  const parkActive = useStore(diningStore, (s) => s.filters.parkResort !== "ALL");
  const dirty = extraCount > 0 || parkActive;

  // The extended-filter Selects are Base UI Selects portaled out of the React
  // tree. Inside a vaul Drawer they must portal into the drawer's own node, not
  // document.body — otherwise the popup sits outside the drawer's pointer scope
  // and a tap only dismisses it instead of committing the choice.
  const [filtersNode, setFiltersNode] = React.useState<HTMLElement | null>(null);

  return (
    <div
      className={MAP_FILTER_STACK}
      style={{ bottom: "calc(var(--safe-bottom) + var(--bottom-nav-height) + 1.4rem)" }}
    >
      {/* Left-anchored stacked pills matching the map's Filter button exactly.
          Sort only once there's a committed search (a list to order). */}
      {searched && (
        <Drawer>
          <DrawerTrigger className={MAP_FILTER_PILL}>
            <ArrowUpDownIcon />
            Sort
          </DrawerTrigger>
          <DrawerContent>
            <DrawerHeader>
              <DrawerTitle>Sort restaurants</DrawerTitle>
              <DrawerDescription>
                Choose how the list is ordered. Tap again to flip the direction.
              </DrawerDescription>
            </DrawerHeader>
            <SortRows
              options={SORT_OPTIONS}
              activeKey={sortKey}
              activeDir={sortDir}
              onChange={setSort}
            />
          </DrawerContent>
        </Drawer>
      )}

      {/* Filter */}
      <Drawer>
        <DrawerTrigger className={MAP_FILTER_PILL}>
          <SlidersHorizontalIcon />
          Filter
          {dirty ? <span className="bg-primary size-1.5 rounded-full" /> : null}
        </DrawerTrigger>
        <DrawerContent ref={setFiltersNode}>
          <DrawerHeader className="border-b pb-4">
            <DrawerTitle>Filters</DrawerTitle>
            <DrawerDescription>Narrow by park, price, hours, features, and more.</DrawerDescription>
          </DrawerHeader>
          <div className="overflow-y-auto px-4">
            <ExtendedFilters options={options} container={filtersNode} showPark />
          </div>
          <DrawerFooter className="flex-row gap-2">
            <Button
              variant="outline"
              className={cn("flex-1", !dirty && "opacity-50")}
              disabled={!dirty}
              onClick={() => clearExtraFilters({ includePark: true })}
            >
              Clear all
            </Button>
            <DrawerClose asChild>
              <Button className="flex-1">Done</Button>
            </DrawerClose>
          </DrawerFooter>
        </DrawerContent>
      </Drawer>
    </div>
  );
}
