"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
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
  AVAILABILITY_LABELS,
  countExtraFilters,
  DEFAULT_FILTERS,
  deriveOptions,
  featureLabels,
  FEATURE_FILTERS,
  filterRestaurants,
  OPERATOR_LABELS,
  SORT_LABELS,
  sortRestaurants,
  type AvailabilityEntry,
  type AvailabilityFilter,
  type AvailabilityMap,
  type ClientFilters,
  type DayEntry,
  type FilterOptions,
  type Operator,
  type Restaurant,
  type SortKey,
} from "#/components/dining/dining-filters.ts";
import {
  HOURS_LABELS,
  hoursLabel,
  isOpenNow,
  parkNowMinutes,
  type HoursFilter,
  type HoursMap,
  type ScheduleEntry,
} from "#/components/dining/dining-hours.ts";
import { DiningMenuChanges } from "#/components/dining/dining-menu-changes.tsx";
import { DiningMenuDrawer } from "#/components/dining/dining-menu-drawer.tsx";
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
import { Empty, EmptyDescription, EmptyTitle } from "#/components/ui/empty.tsx";
import { Input } from "#/components/ui/input.tsx";
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "#/components/ui/pagination.tsx";
import { Popover, PopoverContent, PopoverTrigger } from "#/components/ui/popover.tsx";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "#/components/ui/select.tsx";
import { Skeleton } from "#/components/ui/skeleton.tsx";
import { ToggleGroup, ToggleGroupItem } from "#/components/ui/toggle-group.tsx";
import { useIsMobile } from "#/hooks/use-mobile.ts";
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
  referenceDate,
  schedules,
  nowMin,
}: {
  restaurant: Restaurant;
  availability: AvailabilityEntry | undefined;
  windowDays: number;
  referenceDate: string;
  schedules: Array<ScheduleEntry> | undefined;
  nowMin: number;
}) {
  const refData = availability?.days.find((d) => d.date === referenceDate);
  const nextAvailable = availability?.days.find((d) => d.available && d.date >= referenceDate);
  const latestObserved = availability?.days[0]?.observedAt;
  const subtitle = [restaurant.parkResort, restaurant.experienceType ?? restaurant.cuisine]
    .filter(Boolean)
    .join(" · ");
  const todayHours = schedules ? hoursLabel(schedules) : null;
  const openNow = schedules ? isOpenNow(schedules, nowMin) : false;
  const dateLabel = formatDate(referenceDate);

  return (
    <Card className="@container/card overflow-hidden pt-0 shadow-none ring-0 border border-border border-t-3">
      {restaurant.imageUrl && (
        <div className="bg-muted relative h-32 w-full overflow-hidden">
          <img
            src={restaurant.imageUrl}
            alt={restaurant.name}
            loading="lazy"
            className="size-full object-cover"
          />
          {availability &&
            (refData?.available ? (
              <Badge className="absolute top-3 right-3 bg-emerald-500 text-white shadow">
                Open {dateLabel}
              </Badge>
            ) : (
              <Badge variant="secondary" className="absolute top-3 right-3 shadow">
                None {dateLabel}
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
            refData?.available ? (
              <Badge className="bg-emerald-500 text-white shrink-0">Open {dateLabel}</Badge>
            ) : (
              <Badge variant="outline" className="shrink-0 text-muted-foreground">
                None {dateLabel}
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
                  ? `Next: ${nextAvailable.date === referenceDate ? dateLabel : formatDate(nextAvailable.date)}`
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
          <DiningMenuDrawer facilityId={restaurant.facilityId} name={restaurant.name} />
        )}
      </CardContent>
    </Card>
  );
}

/**
 * One core-search field: a toggle-styled trigger (field label over its current
 * value) that opens `children` in a popover. `open` drives the pressed/filled
 * emboss state. Styling is shared with the Stays search bar (see core-search).
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
 * Post-search extended-filter body — every facet the pill doesn't own. Rendered
 * inside the desktop Filters popover and the mobile Filters drawer.
 */
function ExtendedFilters({
  filters,
  onFilters,
  options,
  partySize,
  onPartySize,
}: {
  filters: ClientFilters;
  onFilters: (patch: Partial<ClientFilters>) => void;
  options: FilterOptions;
  partySize: string;
  onPartySize: (v: string) => void;
}) {
  return (
    <div className="flex flex-col gap-5">
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

      <Section label="Operator">
        <PillRow
          options={Object.keys(OPERATOR_LABELS) as Array<Operator>}
          value={filters.operator}
          onSelect={(v) => onFilters({ operator: v })}
          labelOf={(v) => (v === "ALL" ? "All" : OPERATOR_LABELS[v])}
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
                      prices: on ? filters.prices.filter((x) => x !== p) : [...filters.prices, p],
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
          labelOf={(v) => (v === "ALL" ? "Any" : AVAILABILITY_LABELS[v])}
        />
      </Section>

      <Section label="Hours">
        <PillRow
          options={Object.keys(HOURS_LABELS) as Array<HoursFilter>}
          value={filters.hours}
          onSelect={(v) => onFilters({ hours: v })}
          labelOf={(v) => (v === "ALL" ? "Any" : HOURS_LABELS[v])}
        />
      </Section>

      <Section label="Features">
        <div className="flex flex-wrap gap-2">
          {FEATURE_FILTERS.map((f) => {
            const on = filters.features.includes(f.key);
            return (
              <Button
                key={f.key}
                type="button"
                size="sm"
                variant={on ? "default" : "outline"}
                className="rounded-full"
                onClick={() =>
                  onFilters({
                    features: on
                      ? filters.features.filter((x) => x !== f.key)
                      : [...filters.features, f.key],
                  })
                }
              >
                {f.label}
              </Button>
            );
          })}
        </div>
      </Section>

      <Section label="Party size">
        <PillRow
          options={Array.from({ length: 8 }, (_, i) => String(i + 1))}
          value={partySize}
          onSelect={onPartySize}
          labelOf={(v) => v}
        />
      </Section>
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

/** Full-width single-select segmented control used throughout the filter body. */
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
    <ToggleGroup
      multiple={false}
      value={[value]}
      onValueChange={(v) => onSelect((v[0] as T) ?? value)}
      variant="outline"
      size="sm"
      className="w-full"
    >
      {options.map((o) => (
        <ToggleGroupItem
          key={o}
          value={o}
          className="flex-1 px-2 text-center leading-tight whitespace-normal"
        >
          {labelOf(o)}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
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
  const isMobile = useIsMobile();

  // The pill drives the three search facets directly on `filters` (parkResort,
  // cuisine, experienceType). `searched` gates the browse → results hand-off.
  const [filters, setFilters] = React.useState<ClientFilters>(DEFAULT_FILTERS);
  const [partySize, setPartySize] = React.useState("2");
  const [sortKey, setSortKey] = React.useState<SortKey>("park");
  const [page, setPage] = React.useState(0);

  const [whereOpen, setWhereOpen] = React.useState(false);
  const [cuisineOpen, setCuisineOpen] = React.useState(false);
  const [serviceOpen, setServiceOpen] = React.useState(false);
  const [searched, setSearched] = React.useState(false);

  // Close any open search segment when the page scrolls under the sticky bar.
  const closeSegments = React.useCallback(() => {
    setWhereOpen(false);
    setCuisineOpen(false);
    setServiceOpen(false);
  }, []);
  useCloseOnScroll(whereOpen || cuisineOpen || serviceOpen, closeSegments);

  // The pill rides a hero wash at rest, then flips to a translucent bar once it
  // sticks over the scrolling content. A flow sentinel marks the hand-off.
  const [stuck, setStuck] = React.useState(false);
  const sentinelRef = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const headerOffset = isMobile ? 48 : 0;
    const obs = new IntersectionObserver(([entry]) => setStuck(!entry.isIntersecting), {
      rootMargin: `-${headerOffset + 1}px 0px 0px 0px`,
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, [isMobile]);

  const restaurantsQ = useQuery(trpc.dining.restaurants.queryOptions());
  const hoursQ = useQuery(trpc.dining.hours.queryOptions({}));

  const days = 30;
  const availabilityQ = useQuery({
    ...trpc.dining.availability.queryOptions({ partySize: Number(partySize), days }),
    enabled: searched,
  });

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
  const referenceDate = todayStr;

  const visible = React.useMemo(() => {
    if (!restaurants) return [];
    const filtered = filterRestaurants(
      restaurants,
      availabilityMap,
      filters,
      referenceDate,
      hoursMap,
      nowMin,
    );
    return sortRestaurants(filtered, availabilityMap, sortKey, referenceDate);
  }, [restaurants, availabilityMap, filters, sortKey, referenceDate, hoursMap, nowMin]);

  const extraCount = countExtraFilters(filters);
  const pageCount = Math.max(1, Math.ceil(visible.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount - 1);
  const pageItems = visible.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);

  // Snap back to the first page whenever the result set changes shape.
  React.useEffect(() => {
    setPage(0);
  }, [filters, sortKey, partySize, searched]);

  const onFilters = React.useCallback(
    (patch: Partial<ClientFilters>) => setFilters((prev) => ({ ...prev, ...patch })),
    [],
  );
  const onClearExtra = React.useCallback(
    () =>
      // Preserve the pill's facets; reset only the extended ones.
      setFilters((prev) => ({
        ...DEFAULT_FILTERS,
        parkResort: prev.parkResort,
        cuisine: prev.cuisine,
      })),
    [],
  );

  // No required field — committing just reveals the live availability list.
  // Pill edits after this update the results in place (filtering is live).
  const submit = React.useCallback(() => setSearched(true), []);

  const whereLabel = filters.parkResort === "ALL" ? "All restaurants" : filters.parkResort;
  const cuisineLabel = filters.cuisine === "ALL" ? "All cuisines" : filters.cuisine;
  const serviceLabel = filters.experienceType === "ALL" ? "Any service" : filters.experienceType;

  const activeSearchFacets = [
    filters.parkResort !== "ALL" ? filters.parkResort : null,
    filters.cuisine !== "ALL" ? filters.cuisine : null,
    filters.experienceType !== "ALL" ? filters.experienceType : null,
  ].filter(Boolean);
  const mobileSearchLabel = activeSearchFacets.length
    ? activeSearchFacets.join(" · ")
    : "Search restaurants";

  const isLoading = restaurantsQ.isLoading || (searched && availabilityQ.isLoading);

  return (
    <div className="relative isolate flex flex-col">
      {/* Hero wash behind the headline + at-rest pill; scrolls away with the page. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-60 bg-[radial-gradient(120%_140%_at_50%_-25%,color-mix(in_oklab,var(--color-sidebar)_26%,transparent),transparent_70%)]"
      />

      {/* Short hero */}
      <div className="px-4 pt-8 pb-5 text-center lg:px-6">
        <h1 className="text-2xl font-bold tracking-tight">Find a table at the parks</h1>
        <p className="text-muted-foreground mx-auto mt-1 max-w-xl text-sm">
          Browse Disney &amp; Universal restaurants, then search to see live reservation
          availability.
        </p>
      </div>

      {/* Flow sentinel: marks where the bar starts sticking (see the effect). */}
      <div ref={sentinelRef} aria-hidden className="h-0" />

      {/* Core search — a fancy toggle-group bar; hidden on mobile (the FAB carries it). */}
      <div
        className={cn(
          "sticky top-(--header-height) z-20 hidden px-4 py-4 transition-colors duration-200 md:top-0 md:block lg:px-6",
          stuck
            ? "bg-background/80 border-b backdrop-blur-md"
            : "border-b border-transparent bg-transparent",
        )}
      >
        <div className="mx-auto flex w-fit items-stretch gap-2">
          <div className="flex">
            <SearchSegment
              pos="first"
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
                  onFilters({ parkResort: "ALL" });
                  setWhereOpen(false);
                }}
              />
              {options.parks.map((p) => (
                <OptionRow
                  key={p}
                  label={p}
                  selected={filters.parkResort === p}
                  onSelect={() => {
                    onFilters({ parkResort: p });
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
                  onFilters({ cuisine: "ALL" });
                  setCuisineOpen(false);
                }}
              />
              {options.cuisines.map((c) => (
                <OptionRow
                  key={c}
                  label={c}
                  selected={filters.cuisine === c}
                  onSelect={() => {
                    onFilters({ cuisine: c });
                    setCuisineOpen(false);
                  }}
                />
              ))}
            </SearchSegment>

            <SearchSegment
              pos="last"
              label="Service"
              value={serviceLabel}
              muted={filters.experienceType === "ALL"}
              open={serviceOpen}
              onOpenChange={setServiceOpen}
              align="end"
            >
              <OptionRow
                label="Any service level"
                selected={filters.experienceType === "ALL"}
                onSelect={() => {
                  onFilters({ experienceType: "ALL" });
                  setServiceOpen(false);
                }}
              />
              {options.experiences.map((e) => (
                <OptionRow
                  key={e}
                  label={e}
                  selected={filters.experienceType === e}
                  onSelect={() => {
                    onFilters({ experienceType: e });
                    setServiceOpen(false);
                  }}
                />
              ))}
            </SearchSegment>
          </div>

          {!searched && <CoreSearchButton onClick={submit} />}
        </div>
      </div>

      {/* Mobile search + controls FAB */}
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
            <DrawerContent>
              <DrawerHeader className="border-b pb-4">
                <DrawerTitle>Search restaurants</DrawerTitle>
                <DrawerDescription>Choose a place, cuisine, and service level.</DrawerDescription>
              </DrawerHeader>
              <div className="flex flex-col gap-5 overflow-y-auto px-4 pb-4 pt-6">
                <Section label="Where">
                  <AllSelect
                    value={filters.parkResort}
                    onValueChange={(v) => onFilters({ parkResort: v })}
                    allLabel="All restaurants"
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
                {options.experiences.length > 0 && (
                  <Section label="Service level">
                    <AllSelect
                      value={filters.experienceType}
                      onValueChange={(v) => onFilters({ experienceType: v })}
                      allLabel="Any service level"
                      options={options.experiences}
                      ariaLabel="Service level"
                    />
                  </Section>
                )}
              </div>
              <DrawerFooter>
                <DrawerClose asChild>
                  <Button className="rounded-full" onClick={submit}>
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
                <DrawerContent>
                  <DrawerHeader>
                    <DrawerTitle>Filter restaurants</DrawerTitle>
                    <DrawerDescription>
                      Narrow by price, hours, features, and more.
                    </DrawerDescription>
                  </DrawerHeader>
                  <div className="overflow-y-auto px-4 pb-4">
                    <ExtendedFilters
                      filters={filters}
                      onFilters={onFilters}
                      options={options}
                      partySize={partySize}
                      onPartySize={setPartySize}
                    />
                  </div>
                  <DrawerFooter className="flex-row gap-2">
                    <Button
                      variant="outline"
                      className={cn("flex-1", extraCount === 0 && "opacity-50")}
                      disabled={extraCount === 0}
                      onClick={onClearExtra}
                    >
                      Clear filters
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

      <div className="flex flex-col gap-8 px-4 py-6 pb-24 lg:px-6">
        {searched ? (
          <ResultsView
            isLoading={isLoading}
            isError={availabilityQ.isError}
            restaurants={pageItems}
            availabilityMap={availabilityMap}
            hoursMap={hoursMap}
            nowMin={nowMin}
            windowDays={days}
            referenceDate={referenceDate}
            total={visible.length}
            hasRestaurants={!!restaurants?.length}
            filters={filters}
            onFilters={onFilters}
            options={options}
            partySize={partySize}
            onPartySize={setPartySize}
            sortKey={sortKey}
            onSortKey={setSortKey}
            extraCount={extraCount}
            onClearExtra={onClearExtra}
            currentPage={currentPage}
            pageCount={pageCount}
            onPage={setPage}
          />
        ) : (
          <BrowseView isLoading={restaurantsQ.isLoading} />
        )}
      </div>
    </div>
  );
}

/** Pre-search browse: the menu-change feed + curated picks shelves only. */
function BrowseView({ isLoading }: { isLoading: boolean }) {
  if (isLoading) {
    return (
      <div className="flex flex-col gap-10">
        {Array.from({ length: 3 }).map((_, g) => (
          <div key={g} className="flex flex-col gap-4">
            <Skeleton className="h-6 w-56" />
            <div className="grid grid-cols-2 gap-4 md:grid-cols-4 lg:grid-cols-5">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="aspect-[4/3] rounded-2xl" />
              ))}
            </div>
          </div>
        ))}
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-6">
      <DiningMenuChanges />
      <DiningPicks />
    </div>
  );
}

function ResultsView({
  isLoading,
  isError,
  restaurants,
  availabilityMap,
  hoursMap,
  nowMin,
  windowDays,
  referenceDate,
  total,
  hasRestaurants,
  filters,
  onFilters,
  options,
  partySize,
  onPartySize,
  sortKey,
  onSortKey,
  extraCount,
  onClearExtra,
  currentPage,
  pageCount,
  onPage,
}: {
  isLoading: boolean;
  isError: boolean;
  restaurants: Array<Restaurant>;
  availabilityMap: AvailabilityMap;
  hoursMap: HoursMap;
  nowMin: number;
  windowDays: number;
  referenceDate: string;
  total: number;
  hasRestaurants: boolean;
  filters: ClientFilters;
  onFilters: (patch: Partial<ClientFilters>) => void;
  options: FilterOptions;
  partySize: string;
  onPartySize: (v: string) => void;
  sortKey: SortKey;
  onSortKey: (k: SortKey) => void;
  extraCount: number;
  onClearExtra: () => void;
  currentPage: number;
  pageCount: number;
  onPage: (p: number) => void;
}) {
  const countLabel = isLoading
    ? "Searching restaurants…"
    : `${total} ${total === 1 ? "restaurant" : "restaurants"}`;

  return (
    <div className="flex flex-col gap-5">
      {/* Desktop controls: Filters popover + active chips on the left; count + sort right. */}
      <div className="hidden items-center gap-3 md:flex">
        <Popover>
          <PopoverTrigger
            render={
              <Button variant="outline" size="sm">
                <SlidersHorizontalIcon data-icon="inline-start" />
                Filters{extraCount > 0 ? ` (${extraCount})` : ""}
              </Button>
            }
          />
          <PopoverContent align="start" className="max-h-[70vh] w-96 overflow-y-auto">
            <ExtendedFilters
              filters={filters}
              onFilters={onFilters}
              options={options}
              partySize={partySize}
              onPartySize={onPartySize}
            />
          </PopoverContent>
        </Popover>
        <ActiveChips filters={filters} />
        {extraCount > 0 && (
          <Button variant="ghost" size="sm" onClick={onClearExtra}>
            Clear ({extraCount})
          </Button>
        )}
        <span className="text-muted-foreground ml-auto shrink-0 text-sm whitespace-nowrap">
          {countLabel}
        </span>
        <Select
          value={sortKey}
          onValueChange={(v) => v && onSortKey(v as SortKey)}
          items={SORT_LABELS}
        >
          <SelectTrigger size="sm" className="w-48 shrink-0" aria-label="Sort by">
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
      </div>

      {/* Mobile summary — the FAB owns sort/filter editing here. */}
      <div className="flex items-center justify-between gap-2 md:hidden">
        <span className="text-sm font-medium">{countLabel}</span>
        {extraCount > 0 && (
          <Button variant="ghost" size="xs" onClick={onClearExtra}>
            Clear ({extraCount})
          </Button>
        )}
      </div>

      {isLoading ? (
        <div className="grid gap-4 @xl/main:grid-cols-2 @4xl/main:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-[160px] rounded-4xl" />
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
          <EmptyTitle>No priority restaurants</EmptyTitle>
          <EmptyDescription>
            The dining sweep only covers restaurants marked as priority. None are configured yet.
          </EmptyDescription>
        </Empty>
      ) : total === 0 ? (
        <Empty>
          <EmptyTitle>No matches</EmptyTitle>
          <EmptyDescription>No restaurants match your current search.</EmptyDescription>
          {extraCount > 0 && (
            <Button variant="outline" size="sm" onClick={onClearExtra} className="mt-2">
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
                windowDays={windowDays}
                referenceDate={referenceDate}
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
                      onPage(Math.max(0, currentPage - 1));
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
                          onPage(p);
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
                      onPage(Math.min(pageCount - 1, currentPage + 1));
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

/** Read-only summary chips for the active extended filters. */
function ActiveChips({ filters }: { filters: ClientFilters }) {
  const chips: Array<string> = [];
  if (filters.search.trim()) chips.push(`"${filters.search.trim()}"`);
  if (filters.operator !== "ALL") chips.push(OPERATOR_LABELS[filters.operator]);
  if (filters.prices.length) chips.push(filters.prices.join(" / "));
  if (filters.availability !== "ALL") chips.push(AVAILABILITY_LABELS[filters.availability]);
  if (filters.hours !== "ALL") chips.push(HOURS_LABELS[filters.hours]);
  for (const label of featureLabels(filters.features)) chips.push(label);
  if (!chips.length) return null;
  return (
    <div className="flex min-w-0 items-center gap-2 overflow-x-auto">
      {chips.map((c) => (
        <Badge key={c} variant="secondary" className="shrink-0 font-normal">
          {c}
        </Badge>
      ))}
    </div>
  );
}
