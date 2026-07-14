"use client";

import { useStore } from "@tanstack/react-store";

import { FiltersModal } from "#/components/dining/dining-filters-modal.tsx";
import { RestaurantCard } from "#/components/dining/dining-restaurant-card.tsx";
import { stateToSearch } from "#/components/dining/dining-search-params.ts";
import {
  clearExtraFilters,
  diningStore,
  setPage,
  setSort,
} from "#/components/dining/dining-store.ts";
import {
  countExtraFilters,
  SORT_LABELS,
  type AvailabilityMap,
  type FilterOptions,
  type Restaurant,
  type SortKey,
} from "#/components/dining/dining-filters.ts";
import { SortDirToggle, flipDir } from "#/components/ui/sort-menu.tsx";
import { type HoursMap } from "#/components/dining/dining-hours.ts";
import { Button } from "#/components/ui/button.tsx";
import { Empty, EmptyDescription, EmptyTitle } from "#/components/ui/empty.tsx";
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "#/components/ui/pagination.tsx";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "#/components/ui/select.tsx";
import { Skeleton } from "#/components/ui/skeleton.tsx";
import { cn } from "#/lib/utils.ts";

/** Page numbers to render, with `null` sentinels marking ellipsis gaps. */
function pageList(current: number, total: number): Array<number | null> {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i);
  const out: Array<number | null> = [0];
  const start = Math.max(1, current - 1);
  const end = Math.min(total - 2, current + 1);
  if (start > 1) out.push(null);
  for (let i = start; i <= end; i++) out.push(i);
  if (end < total - 2) out.push(null);
  out.push(total - 1);
  return out;
}

export function ResultsView({
  isLoading,
  isError,
  restaurants,
  availabilityMap,
  hoursMap,
  nowMin,
  referenceDate,
  total,
  hasRestaurants,
  options,
  currentPage,
  pageCount,
  loggedIn,
  defaultPartySize,
}: {
  isLoading: boolean;
  isError: boolean;
  restaurants: Array<Restaurant>;
  availabilityMap: AvailabilityMap;
  hoursMap: HoursMap;
  nowMin: number;
  referenceDate: string;
  total: number;
  hasRestaurants: boolean;
  options: FilterOptions;
  currentPage: number;
  pageCount: number;
  loggedIn: boolean;
  defaultPartySize: number;
}) {
  const sortKey = useStore(diningStore, (s) => s.sortKey);
  const sortDir = useStore(diningStore, (s) => s.sortDir);
  const filters = useStore(diningStore, (s) => s.filters);
  const page = useStore(diningStore, (s) => s.page);
  const extraCount = useStore(diningStore, (s) => countExtraFilters(s.filters));

  // The committed search that got us here, carried onto each restaurant link so
  // the detail-page breadcrumb can show the trail and return to this exact list.
  const linkSearch = stateToSearch({ filters, searched: true, sortKey, sortDir, page });

  const countLabel = isLoading
    ? "Searching restaurants…"
    : `${total} ${total === 1 ? "restaurant" : "restaurants"}`;

  return (
    <div className="flex flex-col gap-5">
      {/* Desktop controls: Filters modal + count + sort */}
      <div className="hidden items-center gap-2 md:flex">
        <FiltersModal options={options} />
        {extraCount > 0 && (
          <Button variant="ghost" size="sm" onClick={clearExtraFilters}>
            Clear ({extraCount})
          </Button>
        )}
        <span className="text-muted-foreground ml-auto shrink-0 text-sm whitespace-nowrap">
          {countLabel}
        </span>
        <Select
          value={sortKey}
          onValueChange={(v) => v && setSort(v as SortKey, sortDir)}
          items={SORT_LABELS}
        >
          <SelectTrigger size="sm" className="w-40 shrink-0" aria-label="Sort by">
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
        <SortDirToggle dir={sortDir} onToggle={() => setSort(sortKey, flipDir(sortDir))} />
      </div>

      {/* Mobile summary — the FAB owns sort/filter editing here. */}
      <div className="flex items-center justify-between gap-2 md:hidden">
        <span className="text-sm font-medium">{countLabel}</span>
        {extraCount > 0 && (
          <Button variant="ghost" size="xs" onClick={clearExtraFilters}>
            Clear ({extraCount})
          </Button>
        )}
      </div>

      {isLoading ? (
        <div className="grid gap-4 @xl/main:grid-cols-2 @4xl/main:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="overflow-hidden rounded-4xl border">
              <Skeleton className="h-32 w-full rounded-none" />
              <div className="flex flex-col gap-2 px-3 py-3 sm:px-4">
                <Skeleton className="h-5 w-3/4" />
                <Skeleton className="h-3 w-1/2" />
              </div>
            </div>
          ))}
        </div>
      ) : isError ? (
        <Empty>
          <EmptyTitle>Couldn't load availability</EmptyTitle>
          <EmptyDescription>
            We hit a snag pulling live reservations. Try a different date or search again.
          </EmptyDescription>
        </Empty>
      ) : !hasRestaurants ? (
        <Empty>
          <EmptyTitle>No restaurants yet</EmptyTitle>
          <EmptyDescription>The dining catalog hasn't loaded any venues yet.</EmptyDescription>
        </Empty>
      ) : total === 0 ? (
        <Empty>
          <EmptyTitle>No matches</EmptyTitle>
          <EmptyDescription>No restaurants match your current search.</EmptyDescription>
          {extraCount > 0 && (
            <Button variant="outline" size="sm" onClick={clearExtraFilters} className="mt-2">
              Clear filters
            </Button>
          )}
        </Empty>
      ) : (
        <>
          <div className="grid gap-4 @xl/main:grid-cols-2 @4xl/main:grid-cols-3">
            {restaurants.map((r) => (
              <RestaurantCard
                key={r.facilityId}
                restaurant={r}
                availability={availabilityMap.get(r.facilityId)}
                referenceDate={referenceDate}
                schedules={hoursMap.get(r.facilityId)}
                nowMin={nowMin}
                loggedIn={loggedIn}
                defaultPartySize={defaultPartySize}
                linkSearch={linkSearch}
              />
            ))}
          </div>

          {pageCount > 1 && (
            <Pagination>
              <PaginationContent>
                <PaginationItem>
                  <PaginationPrevious
                    onClick={(e) => {
                      e.preventDefault();
                      setPage(Math.max(0, currentPage - 1));
                    }}
                    aria-disabled={currentPage === 0}
                    className={cn(currentPage === 0 && "pointer-events-none opacity-50")}
                  />
                </PaginationItem>
                {/* Below 400px the numbered links crowd the row — collapse to a
                    plain "Page X of Y" label between the prev/next controls. */}
                <PaginationItem className="hidden max-[400px]:flex">
                  <span className="px-2 text-sm text-muted-foreground tabular-nums">
                    Page {currentPage + 1} of {pageCount}
                  </span>
                </PaginationItem>
                {pageList(currentPage, pageCount).map((p, i) =>
                  p === null ? (
                    <PaginationItem key={`gap-${i}`} className="max-[400px]:hidden">
                      <PaginationEllipsis />
                    </PaginationItem>
                  ) : (
                    <PaginationItem key={p} className="max-[400px]:hidden">
                      <PaginationLink
                        isActive={p === currentPage}
                        onClick={(e) => {
                          e.preventDefault();
                          setPage(p);
                        }}
                      >
                        {p + 1}
                      </PaginationLink>
                    </PaginationItem>
                  ),
                )}
                <PaginationItem>
                  <PaginationNext
                    onClick={(e) => {
                      e.preventDefault();
                      setPage(Math.min(pageCount - 1, currentPage + 1));
                    }}
                    aria-disabled={currentPage === pageCount - 1}
                    className={cn(
                      currentPage === pageCount - 1 && "pointer-events-none opacity-50",
                    )}
                  />
                </PaginationItem>
              </PaginationContent>
            </Pagination>
          )}
        </>
      )}
    </div>
  );
}
