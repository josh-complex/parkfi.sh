"use client";

import * as React from "react";
import { useStore } from "@tanstack/react-store";
import { ArrowUpDownIcon, CheckIcon, SearchIcon, SlidersHorizontalIcon } from "lucide-react";

import {
  CoreSearchButton,
  coreSearchPopoverClass,
  coreSegClass,
  SegContent,
  useCloseOnScroll,
  type SegPos,
} from "#/components/core-search.tsx";
import {
  AllSelect,
  ExtendedFilters,
  PillRow,
  Section,
} from "#/components/dining/dining-filters-modal.tsx";
import {
  clearExtraFilters,
  commitSearch,
  diningStore,
  patchFilters,
  setPartySize,
  setSortKey,
} from "#/components/dining/dining-store.ts";
import {
  countExtraFilters,
  OPERATOR_LABELS,
  SORT_LABELS,
  type FilterOptions,
  type Operator,
  type SortKey,
} from "#/components/dining/dining-filters.ts";
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
import { Popover, PopoverContent, PopoverTrigger } from "#/components/ui/popover.tsx";
import { cn } from "#/lib/utils.ts";

/** Party-size choices shared by the desktop pill and the mobile search drawer. */
const PARTY_SIZE_OPTIONS = Array.from({ length: 8 }, (_, i) => String(i + 1));

function partySizeLabel(size: string): string {
  return `${size} ${size === "1" ? "guest" : "guests"}`;
}

/** A selectable option row inside the Where / Cuisine popovers. */
function OptionRow({
  label,
  selected,
  onSelect,
}: {
  label: string;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "hover:bg-accent hover:text-accent-foreground flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-sm outline-none transition-colors",
        selected && "font-medium",
      )}
    >
      <span className="truncate">{label}</span>
      {selected && <CheckIcon className="size-4 shrink-0" />}
    </button>
  );
}

/**
 * One core-search field: a toggle-styled trigger that opens children in a
 * popover. Styling is shared with the Stays search bar (see core-search).
 */
function SearchSegment({
  pos,
  label,
  value,
  muted,
  open,
  onOpenChange,
  align,
  children,
}: {
  pos: SegPos;
  label: string;
  value: string;
  muted: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  align: "start" | "center" | "end";
  children: React.ReactNode;
}) {
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger
        render={
          <button type="button" className={coreSegClass(pos, open)}>
            <SegContent label={label} value={value} muted={muted} active={open} />
          </button>
        }
      />
      <PopoverContent
        align={align}
        className={cn("max-h-80 w-64 overflow-y-auto p-1.5", coreSearchPopoverClass)}
      >
        {children}
      </PopoverContent>
    </Popover>
  );
}

/** Desktop sticky search bar — hidden on mobile, the FAB carries it there. */
export function DiningSearchBar({ options }: { options: FilterOptions }) {
  const filters = useStore(diningStore, (s) => s.filters);
  const partySize = useStore(diningStore, (s) => s.partySize);
  const searched = useStore(diningStore, (s) => s.searched);
  const stuck = useStore(diningStore, (s) => s.stuck);

  const [operatorOpen, setOperatorOpen] = React.useState(false);
  const [whereOpen, setWhereOpen] = React.useState(false);
  const [cuisineOpen, setCuisineOpen] = React.useState(false);
  const [partyOpen, setPartyOpen] = React.useState(false);

  const closeSegments = React.useCallback(() => {
    setOperatorOpen(false);
    setWhereOpen(false);
    setCuisineOpen(false);
    setPartyOpen(false);
  }, []);
  useCloseOnScroll(operatorOpen || whereOpen || cuisineOpen || partyOpen, closeSegments);

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
      setOperatorOpen(false);
    },
    [options.parksByOperator, filters.parkResort],
  );

  const parkOptions = options.parksByOperator[filters.operator];
  const operatorLabel = OPERATOR_LABELS[filters.operator];
  const whereLabel = filters.parkResort === "ALL" ? "All restaurants" : filters.parkResort;
  const cuisineLabel = filters.cuisine === "ALL" ? "All cuisines" : filters.cuisine;

  return (
    <div
      className={cn(
        "sticky top-(--header-height) z-20 hidden px-4 py-4 transition duration-300 ease-out md:top-0 md:block lg:px-6",
        stuck
          ? "bg-background/80 border-b backdrop-blur-md"
          : "border-b border-transparent bg-transparent",
      )}
    >
      <div className="relative mx-auto flex w-fit items-stretch gap-2">
        <div className="flex">
          <SearchSegment
            pos="first"
            label="Parks"
            value={operatorLabel}
            muted={filters.operator === "ALL"}
            open={operatorOpen}
            onOpenChange={setOperatorOpen}
            align="start"
          >
            {(Object.keys(OPERATOR_LABELS) as Array<Operator>).map((op) => (
              <OptionRow
                key={op}
                label={OPERATOR_LABELS[op]}
                selected={filters.operator === op}
                onSelect={() => selectOperator(op)}
              />
            ))}
          </SearchSegment>

          <SearchSegment
            pos="middle"
            label="Where"
            value={whereLabel}
            muted={filters.parkResort === "ALL"}
            open={whereOpen}
            onOpenChange={setWhereOpen}
            align="start"
          >
            <OptionRow
              label="All restaurants"
              selected={filters.parkResort === "ALL"}
              onSelect={() => {
                patchFilters({ parkResort: "ALL" });
                setWhereOpen(false);
              }}
            />
            {parkOptions.map((p) => (
              <OptionRow
                key={p}
                label={p}
                selected={filters.parkResort === p}
                onSelect={() => {
                  patchFilters({ parkResort: p });
                  setWhereOpen(false);
                }}
              />
            ))}
          </SearchSegment>

          <SearchSegment
            pos="middle"
            label="Cuisine"
            value={cuisineLabel}
            muted={filters.cuisine === "ALL"}
            open={cuisineOpen}
            onOpenChange={setCuisineOpen}
            align="center"
          >
            <OptionRow
              label="All cuisines"
              selected={filters.cuisine === "ALL"}
              onSelect={() => {
                patchFilters({ cuisine: "ALL" });
                setCuisineOpen(false);
              }}
            />
            {options.cuisines.map((c) => (
              <OptionRow
                key={c}
                label={c}
                selected={filters.cuisine === c}
                onSelect={() => {
                  patchFilters({ cuisine: c });
                  setCuisineOpen(false);
                }}
              />
            ))}
          </SearchSegment>

          <SearchSegment
            pos="last"
            label="Party size"
            value={partySizeLabel(partySize)}
            muted={false}
            open={partyOpen}
            onOpenChange={setPartyOpen}
            align="end"
          >
            {PARTY_SIZE_OPTIONS.map((n) => (
              <OptionRow
                key={n}
                label={partySizeLabel(n)}
                selected={partySize === n}
                onSelect={() => {
                  setPartySize(n);
                  setPartyOpen(false);
                }}
              />
            ))}
          </SearchSegment>
        </div>

        {!searched && <CoreSearchButton onClick={commitSearch} />}
      </div>
    </div>
  );
}

/** Mobile floating action button — owns search, sort, and filters drawers. */
export function DiningMobileFAB({ options }: { options: FilterOptions }) {
  const filters = useStore(diningStore, (s) => s.filters);
  const partySize = useStore(diningStore, (s) => s.partySize);
  const sortKey = useStore(diningStore, (s) => s.sortKey);
  const searched = useStore(diningStore, (s) => s.searched);
  const extraCount = useStore(diningStore, (s) => countExtraFilters(s.filters));

  // The Where/Cuisine/Service-level dropdowns are Base UI Selects portaled out of
  // the React tree. Inside a vaul Drawer they must portal into the drawer's own
  // node, not document.body — otherwise the popup sits outside the drawer's
  // pointer scope and a tap only dismisses it instead of committing the choice.
  const [searchNode, setSearchNode] = React.useState<HTMLElement | null>(null);
  const [filtersNode, setFiltersNode] = React.useState<HTMLElement | null>(null);

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
    },
    [options.parksByOperator, filters.parkResort],
  );

  const activeSearchFacets = [
    filters.operator !== "ALL" ? OPERATOR_LABELS[filters.operator] : null,
    filters.parkResort !== "ALL" ? filters.parkResort : null,
    filters.cuisine !== "ALL" ? filters.cuisine : null,
  ].filter(Boolean);
  const mobileSearchLabel = activeSearchFacets.length
    ? activeSearchFacets.join(" · ")
    : "Search restaurants";

  return (
    <div
      className="fixed left-1/2 z-40 -translate-x-1/2 md:hidden"
      style={{ bottom: "calc(env(safe-area-inset-bottom) + 1rem)" }}
    >
      <div className="bg-popover/95 supports-backdrop-filter:backdrop-blur flex items-center gap-1 rounded-full border p-1 shadow-xl">
        {/* Search / edit search */}
        <Drawer>
          <DrawerTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="rounded-full gap-1.5 px-3 text-xs font-medium"
            >
              <SearchIcon className="size-3.5" />
              {mobileSearchLabel}
            </Button>
          </DrawerTrigger>
          <DrawerContent ref={setSearchNode}>
            <DrawerHeader className="border-b pb-4">
              <DrawerTitle>Search restaurants</DrawerTitle>
              <DrawerDescription>Choose a place, cuisine, and party size.</DrawerDescription>
            </DrawerHeader>
            <div className="flex flex-col gap-5 overflow-y-auto px-4 pb-4 pt-6">
              <Section label="Parks">
                <PillRow
                  options={Object.keys(OPERATOR_LABELS) as Array<Operator>}
                  value={filters.operator}
                  onSelect={selectOperator}
                  labelOf={(v) => OPERATOR_LABELS[v]}
                />
              </Section>
              <Section label="Where">
                <AllSelect
                  value={filters.parkResort}
                  onValueChange={(v) => patchFilters({ parkResort: v })}
                  allLabel="All restaurants"
                  options={options.parksByOperator[filters.operator]}
                  ariaLabel="Park or resort"
                  container={searchNode}
                />
              </Section>
              <Section label="Cuisine">
                <AllSelect
                  value={filters.cuisine}
                  onValueChange={(v) => patchFilters({ cuisine: v })}
                  allLabel="All cuisines"
                  options={options.cuisines}
                  ariaLabel="Cuisine"
                  container={searchNode}
                />
              </Section>
              <Section label="Party size">
                <PillRow
                  options={PARTY_SIZE_OPTIONS}
                  value={partySize}
                  onSelect={setPartySize}
                  labelOf={(v) => v}
                />
              </Section>
            </div>
            <DrawerFooter>
              <DrawerClose asChild>
                <Button className="rounded-full" onClick={commitSearch}>
                  {searched ? "Update search" : "Search"}
                </Button>
              </DrawerClose>
            </DrawerFooter>
          </DrawerContent>
        </Drawer>

        {searched && (
          <>
            <span className="bg-border h-5 w-px" />

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
                        onClick={() => setSortKey(k)}
                      >
                        {SORT_LABELS[k]}
                      </Button>
                    </DrawerClose>
                  ))}
                </div>
              </DrawerContent>
            </Drawer>

            <span className="bg-border h-5 w-px" />

            {/* Filters */}
            <Drawer>
              <DrawerTrigger asChild>
                <Button variant="ghost" size="sm" className="rounded-full">
                  <SlidersHorizontalIcon data-icon="inline-start" />
                  Filters
                  {extraCount > 0 ? <span className="bg-primary size-1.5 rounded-full" /> : null}
                </Button>
              </DrawerTrigger>
              <DrawerContent ref={setFiltersNode}>
                <DrawerHeader className="border-b pb-4">
                  <DrawerTitle>Filters</DrawerTitle>
                  <DrawerDescription>Narrow by price, hours, features, and more.</DrawerDescription>
                </DrawerHeader>
                <div className="overflow-y-auto px-4">
                  <ExtendedFilters options={options} container={filtersNode} />
                </div>
                <DrawerFooter className="flex-row gap-2">
                  <Button
                    variant="outline"
                    className={cn("flex-1", extraCount === 0 && "opacity-50")}
                    disabled={extraCount === 0}
                    onClick={clearExtraFilters}
                  >
                    Clear all
                  </Button>
                  <DrawerClose asChild>
                    <Button className="flex-1">Done</Button>
                  </DrawerClose>
                </DrawerFooter>
              </DrawerContent>
            </Drawer>
          </>
        )}
      </div>
    </div>
  );
}
