"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";

import { DiningFilterBar } from "#/components/dining/dining-filter-bar.tsx";
import {
  AVAILABILITY_LABELS,
  countActiveFilters,
  DEFAULT_FILTERS,
  deriveOptions,
  featureLabels,
  filterRestaurants,
  OPERATOR_LABELS,
  sortRestaurants,
  type AvailabilityEntry,
  type AvailabilityMap,
  type ClientFilters,
  type DayEntry,
  type Restaurant,
  type SortKey,
} from "#/components/dining/dining-filters.ts";
import {
  HOURS_LABELS,
  hoursLabel,
  isOpenNow,
  parkNowMinutes,
  type HoursMap,
  type ScheduleEntry,
} from "#/components/dining/dining-hours.ts";
import { DiningMenuChanges } from "#/components/dining/dining-menu-changes.tsx";
import { DiningMenuDrawer } from "#/components/dining/dining-menu-drawer.tsx";
import { DiningMobileControls } from "#/components/dining/dining-mobile-controls.tsx";
import { DiningPicks } from "#/components/dining/dining-picks.tsx";
import { Badge } from "#/components/ui/badge.tsx";
import { Button } from "#/components/ui/button.tsx";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "#/components/ui/card.tsx";
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
import { Skeleton } from "#/components/ui/skeleton.tsx";
import { useTRPC } from "#/integrations/trpc/react.ts";
import { cn } from "#/lib/utils.ts";

const PAGE_SIZE = 12;

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function formatDate(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diff / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  return `${hr}h ago`;
}

function AvailabilitySparkline({
  days,
  windowDays,
}: {
  days: Array<DayEntry>;
  windowDays: number;
}) {
  const shown = days.slice(0, windowDays);
  return (
    <div className="flex gap-0.5">
      {shown.map((d) => (
        <div
          key={d.date}
          title={`${formatDate(d.date)}: ${d.available ? `${d.offerCount} slot${d.offerCount === 1 ? "" : "s"}` : "none"}`}
          className={cn(
            "h-2 w-1.5 rounded-sm",
            d.available ? "bg-primary" : "bg-muted-foreground/20",
          )}
        />
      ))}
    </div>
  );
}

function RestaurantCard({
  restaurant,
  availability,
  windowDays,
  schedules,
  nowMin,
}: {
  restaurant: Restaurant;
  availability: AvailabilityEntry | undefined;
  windowDays: number;
  schedules: Array<ScheduleEntry> | undefined;
  nowMin: number;
}) {
  const todayStr = today();
  const todayData = availability?.days.find((d) => d.date === todayStr);
  const nextAvailable = availability?.days.find((d) => d.available && d.date >= todayStr);
  const latestObserved = availability?.days[0]?.observedAt;
  const subtitle = [restaurant.parkResort, restaurant.experienceType ?? restaurant.cuisine]
    .filter(Boolean)
    .join(" · ");
  const todayHours = schedules ? hoursLabel(schedules) : null;
  const openNow = schedules ? isOpenNow(schedules, nowMin) : false;

  return (
    <Card className="@container/card overflow-hidden pt-0">
      {restaurant.imageUrl && (
        <div className="bg-muted relative h-32 w-full overflow-hidden">
          <img
            src={restaurant.imageUrl}
            alt={restaurant.name}
            loading="lazy"
            className="size-full object-cover"
          />
          {availability &&
            (todayData?.available ? (
              <Badge className="absolute top-3 right-3 bg-emerald-500 text-white shadow">
                Open today
              </Badge>
            ) : (
              <Badge variant="secondary" className="absolute top-3 right-3 shadow">
                None today
              </Badge>
            ))}
        </div>
      )}
      <CardHeader className={restaurant.imageUrl ? "pt-4" : undefined}>
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <CardTitle className="line-clamp-1">
              {restaurant.detailUrl ? (
                <a
                  href={restaurant.detailUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="hover:underline"
                >
                  {restaurant.name}
                </a>
              ) : (
                restaurant.name
              )}
            </CardTitle>
            <CardDescription className="mt-0.5 line-clamp-1">{subtitle}</CardDescription>
          </div>
          {/* Status badge lives on the image when present; show it here otherwise. */}
          {!restaurant.imageUrl && availability ? (
            todayData?.available ? (
              <Badge className="bg-emerald-500 text-white shrink-0">Open today</Badge>
            ) : (
              <Badge variant="outline" className="shrink-0 text-muted-foreground">
                None today
              </Badge>
            )
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {availability ? (
          <>
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>
                {nextAvailable
                  ? `Next: ${nextAvailable.date === todayStr ? "today" : formatDate(nextAvailable.date)}`
                  : "No availability in window"}
              </span>
              {latestObserved && <span>Updated {relativeTime(latestObserved)}</span>}
            </div>
            <AvailabilitySparkline days={availability.days} windowDays={windowDays} />
          </>
        ) : (
          <p className="text-xs text-muted-foreground">No observations yet</p>
        )}
        <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
          {restaurant.priceRange ? <span>{restaurant.priceRange}</span> : <span />}
          {todayHours && (
            <span className="flex items-center gap-1.5">
              {openNow && <span className="size-1.5 rounded-full bg-emerald-500" />}
              <span>
                {openNow ? "Open now" : "Today"} · {todayHours}
              </span>
            </span>
          )}
        </div>
        {restaurant.hasMenu && (
          <DiningMenuDrawer
            facilityId={restaurant.facilityId}
            name={restaurant.name}
            trigger={
              <Button variant="outline" size="sm" className="w-full">
                View menu
              </Button>
            }
          />
        )}
      </CardContent>
    </Card>
  );
}

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

export function DiningBoard() {
  const trpc = useTRPC();
  const [partySize, setPartySize] = React.useState("2");
  const [days, setDays] = React.useState("30");
  const [filters, setFilters] = React.useState<ClientFilters>(DEFAULT_FILTERS);
  const [sortKey, setSortKey] = React.useState<SortKey>("park");
  const [page, setPage] = React.useState(0);

  const restaurantsQ = useQuery(trpc.dining.restaurants.queryOptions());
  const availabilityQ = useQuery(
    trpc.dining.availability.queryOptions({
      partySize: Number(partySize),
      days: Number(days),
    }),
  );
  const hoursQ = useQuery(trpc.dining.hours.queryOptions({}));

  const restaurants = restaurantsQ.data;
  const availabilityMap: AvailabilityMap = React.useMemo(() => {
    const m = new Map<string, AvailabilityEntry>();
    for (const entry of availabilityQ.data ?? []) m.set(entry.facilityId, entry);
    return m;
  }, [availabilityQ.data]);
  const hoursMap: HoursMap = React.useMemo(() => {
    const m = new Map<string, Array<ScheduleEntry>>();
    for (const entry of hoursQ.data ?? []) m.set(entry.facilityId, entry.schedules);
    return m;
  }, [hoursQ.data]);

  const options = React.useMemo(() => deriveOptions(restaurants ?? []), [restaurants]);

  const todayStr = today();
  const nowMin = parkNowMinutes();
  const visible = React.useMemo(() => {
    if (!restaurants) return [];
    const filtered = filterRestaurants(
      restaurants,
      availabilityMap,
      filters,
      todayStr,
      hoursMap,
      nowMin,
    );
    return sortRestaurants(filtered, availabilityMap, sortKey, todayStr);
  }, [restaurants, availabilityMap, filters, sortKey, todayStr, hoursMap, nowMin]);

  const activeCount = countActiveFilters(filters);
  const pageCount = Math.max(1, Math.ceil(visible.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount - 1);
  const pageItems = visible.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);

  // Snap back to the first page whenever the result set changes shape.
  React.useEffect(() => {
    setPage(0);
  }, [filters, sortKey, partySize, days]);

  const onFilters = React.useCallback(
    (patch: Partial<ClientFilters>) => setFilters((prev) => ({ ...prev, ...patch })),
    [],
  );
  const onClear = React.useCallback(() => setFilters(DEFAULT_FILTERS), []);

  const controls = {
    filters,
    onFilters,
    options,
    sortKey,
    onSortKey: setSortKey,
    partySize,
    onPartySize: setPartySize,
    days,
    onDays: setDays,
    activeCount,
    onClear,
  };

  const isLoading = restaurantsQ.isLoading || availabilityQ.isLoading;

  return (
    <div className="flex flex-col">
      <div className="flex flex-col gap-1 px-4 pt-4 md:pt-6 lg:px-6">
        <h2 className="text-xl font-semibold tracking-tight">Dining Reservations</h2>
        <p className="text-muted-foreground text-sm">
          Live reservation availability across Disney &amp; Universal restaurants.
        </p>
      </div>

      <DiningFilterBar {...controls} />

      <div className="flex flex-col gap-4 px-4 py-4 pb-24 md:gap-6 md:py-6 lg:px-6">
        {/* Discovery shelves + price-change feed — only while browsing (no filters).
            Both self-hide when they have nothing to show. */}
        {!isLoading && activeCount === 0 ? (
          <>
            <DiningMenuChanges />
            <DiningPicks />
          </>
        ) : null}

        {/* Result summary + active-filter chips (chips are read-only here; the
            bar / mobile drawer own editing). */}
        {!isLoading && restaurants?.length ? (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-muted-foreground">
              {visible.length} {visible.length === 1 ? "restaurant" : "restaurants"}
            </span>
            <ActiveChips filters={filters} />
            {activeCount > 0 && (
              <Button variant="ghost" size="xs" onClick={onClear} className="md:hidden">
                Clear
              </Button>
            )}
          </div>
        ) : null}

        {isLoading ? (
          <div className="grid gap-4 @xl/main:grid-cols-2 @4xl/main:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-[160px] rounded-4xl" />
            ))}
          </div>
        ) : !restaurants?.length ? (
          <Empty>
            <EmptyTitle>No priority restaurants</EmptyTitle>
            <EmptyDescription>
              The dining sweep only covers restaurants marked as priority. None are configured yet.
            </EmptyDescription>
          </Empty>
        ) : visible.length === 0 ? (
          <Empty>
            <EmptyTitle>No matches</EmptyTitle>
            <EmptyDescription>No restaurants match your current filters.</EmptyDescription>
            <Button variant="outline" size="sm" onClick={onClear} className="mt-2">
              Clear filters
            </Button>
          </Empty>
        ) : (
          <>
            <div className="grid gap-4 @xl/main:grid-cols-2 @4xl/main:grid-cols-3">
              {pageItems.map((r) => (
                <RestaurantCard
                  key={r.facilityId}
                  restaurant={r}
                  availability={availabilityMap.get(r.facilityId)}
                  windowDays={Number(days)}
                  schedules={hoursMap.get(r.facilityId)}
                  nowMin={nowMin}
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
                  {pageList(currentPage, pageCount).map((p, i) =>
                    p === null ? (
                      <PaginationItem key={`gap-${i}`}>
                        <PaginationEllipsis />
                      </PaginationItem>
                    ) : (
                      <PaginationItem key={p}>
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

      <DiningMobileControls {...controls} />
    </div>
  );
}

/** Read-only summary chips for the active client filters. */
function ActiveChips({ filters }: { filters: ClientFilters }) {
  const chips: Array<string> = [];
  if (filters.search.trim()) chips.push(`"${filters.search.trim()}"`);
  if (filters.parkResort !== "ALL") chips.push(filters.parkResort);
  if (filters.cuisine !== "ALL") chips.push(filters.cuisine);
  if (filters.experienceType !== "ALL") chips.push(filters.experienceType);
  if (filters.operator !== "ALL") chips.push(OPERATOR_LABELS[filters.operator]);
  if (filters.prices.length) chips.push(filters.prices.join(" / "));
  if (filters.availability !== "ALL") chips.push(AVAILABILITY_LABELS[filters.availability]);
  if (filters.hours !== "ALL") chips.push(HOURS_LABELS[filters.hours]);
  for (const label of featureLabels(filters.features)) chips.push(label);
  if (!chips.length) return null;
  return (
    <>
      {chips.map((c) => (
        <Badge key={c} variant="secondary" className="font-normal">
          {c}
        </Badge>
      ))}
    </>
  );
}
