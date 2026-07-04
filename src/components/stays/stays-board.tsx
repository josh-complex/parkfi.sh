"use client";

import * as React from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { differenceInCalendarDays, format } from "date-fns";
import { type DateRange } from "react-day-picker";
import {
  ArrowUpDownIcon,
  CheckIcon,
  MinusIcon,
  PlusIcon,
  SearchIcon,
  SlidersHorizontalIcon,
} from "lucide-react";

import {
  CoreSearchButton,
  coreSearchPopoverClass,
  coreSegClass,
  SegContent,
  useCloseOnScroll,
} from "#/components/core-search.tsx";
import { StayAlertButton, type StayAlertDims } from "#/components/stays/stay-alert-button.tsx";
import {
  EMPTY_FILTERS,
  STAY_OPERATORS,
  STAY_SORT_LABELS,
  TIER_LABEL,
  TIER_META,
  activeFilterCount,
  reasonLabel,
  sortOffers,
  type StayFilters,
  type StaySortKey,
} from "#/components/stays/stays-filters.ts";
import { Badge } from "#/components/ui/badge.tsx";
import { Button } from "#/components/ui/button.tsx";
import { Calendar } from "#/components/ui/calendar.tsx";
import {
  Carousel,
  CarouselArrows,
  CarouselContent,
  CarouselItem,
} from "#/components/ui/carousel.tsx";
import { Empty, EmptyDescription, EmptyTitle } from "#/components/ui/empty.tsx";
import { Label } from "#/components/ui/label.tsx";
import { Popover, PopoverContent, PopoverTrigger } from "#/components/ui/popover.tsx";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "#/components/ui/select.tsx";
import { Skeleton } from "#/components/ui/skeleton.tsx";
import { Switch } from "#/components/ui/switch.tsx";
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
import { useIsMobile } from "#/hooks/use-mobile.ts";
import { useTRPC } from "#/integrations/trpc/react.ts";
import { authClient } from "#/lib/auth-client.ts";
import { cn } from "#/lib/utils.ts";
import {
  RESORT_CATALOG,
  type ResortCatalogEntry,
  type ResortTier,
} from "#/server/stays/resort-catalog.generated.ts";

/** Resort facility id → catalog slug, for linking availability rows to detail pages. */
const SLUG_BY_ID = new Map(RESORT_CATALOG.map((r) => [r.id, r.slug]));

const ISO = "yyyy-MM-dd";

function iso(d: Date): string {
  return format(d, ISO);
}

function rangeLabel(range: DateRange | undefined): string {
  if (!range?.from) return "Add dates";
  if (!range.to) return format(range.from, "MMM d");
  return `${format(range.from, "MMM d")} – ${format(range.to, "MMM d")}`;
}

interface SearchState {
  range: DateRange;
  adults: number;
  children: number;
  filters: StayFilters;
}

/** A single resort tile. Shows price + status only when `offer` carries them. */
function ResortCard({
  name,
  area,
  image,
  detailUrl,
  slug,
  tier,
  pricePerNight,
  available,
  reasonCode,
  nights,
  alertSlot,
}: {
  name: string;
  area: string | null;
  image: string | null;
  detailUrl: string;
  /** Catalog slug — when set, the tile links to the in-app `/resort/$slug` page. */
  slug?: string | null;
  tier: ResortTier;
  pricePerNight?: number | null;
  available?: boolean;
  reasonCode?: string | null;
  nights?: number;
  alertSlot?: React.ReactNode;
}) {
  const hasResult = pricePerNight !== undefined;
  const className = cn(
    "group flex flex-col gap-2 outline-none",
    hasResult && available === false && "opacity-60",
  );
  const inner = (
    <>
      <div className="bg-muted relative aspect-[4/3] w-full overflow-hidden rounded-2xl">
        {image ? (
          <img
            src={image}
            alt={name}
            loading="lazy"
            className="size-full object-cover transition-transform duration-300 group-hover:scale-105"
          />
        ) : null}
        <Badge
          variant="secondary"
          className="absolute top-3 left-3 bg-background/85 font-medium shadow-sm backdrop-blur-sm"
        >
          {TIER_LABEL[tier]}
        </Badge>
        {hasResult && available === false && (
          <div className="absolute inset-0 grid place-items-center bg-background/55">
            <Badge variant="secondary" className="shadow-sm">
              {reasonLabel(reasonCode ?? null)}
            </Badge>
          </div>
        )}
      </div>
      <div className="flex flex-col gap-0.5 px-0.5">
        <div className="flex items-start justify-between gap-2">
          <span className="line-clamp-1 text-sm font-medium group-hover:underline">{name}</span>
        </div>
        {area && <span className="text-muted-foreground line-clamp-1 text-xs">{area}</span>}
        {hasResult && available && pricePerNight != null && (
          <div className="mt-0.5 flex flex-col leading-tight">
            <span className="text-sm">
              <span className="text-muted-foreground">From </span>
              <span className="font-semibold">${pricePerNight.toLocaleString()}</span>{" "}
              <span className="text-muted-foreground">/ night</span>
            </span>
            {nights ? (
              <span className="text-muted-foreground text-xs tabular-nums">
                ${(pricePerNight * nights).toLocaleString()} total
              </span>
            ) : null}
          </div>
        )}
      </div>
    </>
  );
  const card = slug ? (
    <Link to="/resort/$slug" params={{ slug }} className={className}>
      {inner}
    </Link>
  ) : (
    <a href={detailUrl} target="_blank" rel="noreferrer" className={className}>
      {inner}
    </a>
  );
  if (!alertSlot) return card;
  // The card is an <a>, so the alert control lives as an overlay sibling (not a
  // nested button) — top-right, opposite the tier badge.
  return (
    <div className="relative">
      {card}
      <div className="absolute top-2 right-2 z-10">{alertSlot}</div>
    </div>
  );
}

function Stepper({
  label,
  hint,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  hint?: string;
  value: number;
  min: number;
  max: number;
  onChange: (next: number) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-2">
      <div className="flex flex-col">
        <span className="text-sm font-medium">{label}</span>
        {hint && <span className="text-muted-foreground text-xs">{hint}</span>}
      </div>
      <div className="flex items-center gap-3">
        <Button
          type="button"
          variant="outline"
          size="icon-sm"
          className="rounded-full"
          disabled={value <= min}
          onClick={() => onChange(Math.max(min, value - 1))}
          aria-label={`Decrease ${label}`}
        >
          <MinusIcon />
        </Button>
        <span className="w-5 text-center text-sm tabular-nums">{value}</span>
        <Button
          type="button"
          variant="outline"
          size="icon-sm"
          className="rounded-full"
          disabled={value >= max}
          onClick={() => onChange(Math.min(max, value + 1))}
          aria-label={`Increase ${label}`}
        >
          <PlusIcon />
        </Button>
      </div>
    </div>
  );
}

const TIER_CHIPS: Array<{ key: ResortTier | "ALL"; label: string }> = [
  { key: "ALL", label: "All resorts" },
  ...TIER_META.map((t) => ({ key: t.key, label: t.label })),
];

/** A selectable operator row inside the "Where" popover. */
function OperatorOption({
  label,
  selected,
  disabled,
  onSelect,
}: {
  label: string;
  selected: boolean;
  disabled?: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onSelect}
      className={cn(
        "hover:bg-accent hover:text-accent-foreground flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-sm outline-none transition-colors",
        selected && "font-medium",
        disabled &&
          "parkfi-caution-strip cursor-not-allowed hover:bg-transparent hover:text-inherit",
      )}
    >
      <span className="truncate">{label}</span>
      {disabled ? (
        <span className="text-muted-foreground shrink-0 text-xs">Coming soon</span>
      ) : (
        selected && <CheckIcon className="size-4 shrink-0" />
      )}
    </button>
  );
}

export function StaysBoard() {
  const trpc = useTRPC();
  const isMobile = useIsMobile();
  const { data: session } = authClient.useSession();

  // Draft search inputs (the pill); committed to `search` on submit so the
  // availability query only fires for a complete, intentional search.
  const [range, setRange] = React.useState<DateRange | undefined>();
  const [adults, setAdults] = React.useState(2);
  const [children, setChildren] = React.useState(0);
  const [filters, setFilters] = React.useState<StayFilters>(EMPTY_FILTERS);
  const [whereOpen, setWhereOpen] = React.useState(false);
  const [datesOpen, setDatesOpen] = React.useState(false);
  const [adultsOpen, setAdultsOpen] = React.useState(false);
  const [kidsOpen, setKidsOpen] = React.useState(false);
  const [search, setSearch] = React.useState<SearchState | null>(null);
  const [tierFilter, setTierFilter] = React.useState<ResortTier | "ALL">("ALL");
  const [sortKey, setSortKey] = React.useState<StaySortKey>("recommended");

  // Close any open search segment when the page scrolls under the sticky bar.
  const closeSegments = React.useCallback(() => {
    setWhereOpen(false);
    setDatesOpen(false);
    setAdultsOpen(false);
    setKidsOpen(false);
  }, []);
  useCloseOnScroll(whereOpen || datesOpen || adultsOpen || kidsOpen, closeSegments);

  // The search pill rides a subtle blue hero wash at rest, then flips to the
  // translucent white bar once it sticks over the scrolling content. A flow
  // sentinel placed just above it tells us when that hand-off happens.
  const [stuck, setStuck] = React.useState(false);
  const sentinelRef = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    // The bar pins under the mobile header (sticky there) but to the viewport
    // top on desktop; nudge the observer's top edge to match its resting line.
    const headerOffset = isMobile ? 48 : 0;
    const obs = new IntersectionObserver(([entry]) => setStuck(!entry.isIntersecting), {
      rootMargin: `-${headerOffset + 1}px 0px 0px 0px`,
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, [isMobile]);

  const catalogQ = useQuery(trpc.stays.catalog.queryOptions());
  const catalog = catalogQ.data ?? [];

  const availabilityQ = useQuery({
    ...trpc.stays.availability.queryOptions({
      checkInDate: search ? iso(search.range.from!) : "",
      checkOutDate: search ? iso(search.range.to!) : "",
      adults: search?.adults ?? 2,
      children: search?.children ?? 0,
      // Disney requires an age per child; default to 10 (the common rack bucket).
      childAges: search ? Array.from({ length: search.children }, () => 10) : [],
      accessible: search?.filters.accessible ?? false,
      floridaResident: search?.filters.floridaResident ?? false,
    }),
    enabled: !!search,
  });

  const nights =
    search?.range.from && search.range.to
      ? differenceInCalendarDays(search.range.to, search.range.from)
      : 0;

  const submit = React.useCallback(() => {
    if (!range?.from || !range.to) {
      setDatesOpen(true);
      return;
    }
    setSearch({ range, adults, children, filters });
    setTierFilter("ALL");
  }, [range, adults, children, filters]);

  // Applying a rate filter updates the draft and, if a search is live, re-runs it.
  const applyFilters = React.useCallback((patch: Partial<StayFilters>) => {
    setFilters((f) => ({ ...f, ...patch }));
    setSearch((s) => (s ? { ...s, filters: { ...s.filters, ...patch } } : s));
  }, []);

  const guestLabel = `${adults} adult${adults === 1 ? "" : "s"}`;
  const kidsLabel = `${children} kid${children === 1 ? "" : "s"}`;
  const today = React.useMemo(() => new Date(), []);

  const activeCount = activeFilterCount(filters) + (tierFilter === "ALL" ? 0 : 1);
  const onClear = React.useCallback(() => {
    applyFilters(EMPTY_FILTERS);
    setTierFilter("ALL");
  }, [applyFilters]);

  const mobileSearchLabel =
    range?.from && range.to ? `${rangeLabel(range)} · ${guestLabel}` : "Search resorts";

  // Refs so the auto-submit effect can read current values without re-running.
  const searchRef = React.useRef(search);
  searchRef.current = search;
  const filtersRef = React.useRef(filters);
  filtersRef.current = filters;
  const didMountRef = React.useRef(false);

  // Mobile: any change auto-submits. Desktop: auto-updates once a search is active.
  React.useEffect(() => {
    if (!didMountRef.current) {
      didMountRef.current = true;
      return;
    }
    if (!range?.from || !range.to) return;
    if (!isMobile && !searchRef.current) return;
    setSearch({
      range: { from: range.from, to: range.to },
      adults,
      children,
      filters: filtersRef.current,
    });
  }, [range, adults, children, isMobile]);

  const offers = availabilityQ.data?.offers ?? [];
  const tierScoped = tierFilter === "ALL" ? offers : offers.filter((o) => o.tier === tierFilter);
  const filteredOffers = sortOffers(
    tierScoped.filter((o) => o.available),
    sortKey,
  );
  const availableCount = offers.filter((o) => o.available).length;

  // Browse rows (pre-search): catalog grouped by tier, in TIER_META order.
  const byTier = React.useMemo(() => {
    return TIER_META.map((meta) => ({
      meta,
      resorts: catalog.filter((r) => r.tier === meta.key),
    })).filter((g) => g.resorts.length > 0);
  }, [catalog]);

  return (
    <div className="relative isolate flex flex-col">
      {/* Slight radial wash in the sidebar's Disney blue, behind the hero copy
          and the at-rest search pill; scrolls away with the page. Desktop only —
          mobile goes straight into the content. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 hidden h-60 bg-[radial-gradient(120%_140%_at_50%_-25%,color-mix(in_oklab,var(--color-sidebar)_26%,transparent),transparent_70%)] md:block"
      />

      {/* Hero — desktop only, collapses away once the user commits a search. */}
      <div
        className={cn(
          "hidden transition-all duration-500 ease-in-out md:grid",
          search ? "grid-rows-[0fr] opacity-0" : "grid-rows-[1fr] opacity-100",
        )}
      >
        <div className="overflow-hidden">
          <div className="px-4 pt-8 pb-5 text-center lg:px-6">
            <h1 className="text-2xl font-bold tracking-tight">
              Find your stay at Walt Disney World
            </h1>
            <p className="text-muted-foreground mx-auto mt-1 max-w-xl text-sm">
              Browse every Disney Resort hotel, then add dates to see live nightly rates.
            </p>
          </div>
        </div>
      </div>

      {/* Flow sentinel: marks where the bar starts sticking (see the effect). */}
      <div ref={sentinelRef} aria-hidden className="h-0" />

      {/* Search bar — compact Airbnb-style pill that collapses to a stack on mobile. */}
      <div
        className={cn(
          "sticky top-(--header-height) z-20 hidden px-4 py-4 transition-colors duration-200 md:top-0 md:block lg:px-6",
          stuck
            ? "bg-background/80 border-b backdrop-blur-md"
            : "border-b border-transparent bg-transparent",
        )}
      >
        <div className="mx-auto flex w-fit items-stretch gap-3">
          <div className="flex">
            {/* Where */}
            <Popover open={whereOpen} onOpenChange={setWhereOpen}>
              <PopoverTrigger
                render={
                  <button type="button" className={coreSegClass("first", whereOpen)}>
                    <SegContent label="Where" value="Disney" muted={false} active={whereOpen} />
                  </button>
                }
              />
              <PopoverContent align="start" className={cn("w-64 p-1.5", coreSearchPopoverClass)}>
                {STAY_OPERATORS.map((op) => (
                  <OperatorOption
                    key={op.key}
                    label={op.label}
                    selected={op.available}
                    disabled={!op.available}
                    onSelect={() => setWhereOpen(false)}
                  />
                ))}
              </PopoverContent>
            </Popover>

            {/* When */}
            <Popover open={datesOpen} onOpenChange={setDatesOpen}>
              <PopoverTrigger
                render={
                  <button type="button" className={coreSegClass("middle", datesOpen)}>
                    <SegContent
                      label="When"
                      value={rangeLabel(range)}
                      muted={!range?.from}
                      active={datesOpen}
                    />
                  </button>
                }
              />
              <PopoverContent align="center" className={cn("w-auto p-2", coreSearchPopoverClass)}>
                <Calendar
                  mode="range"
                  selected={range}
                  onSelect={(r) => {
                    setRange(r);
                    // Keep open until a real multi-night range is picked.
                    if (r?.from && r.to && differenceInCalendarDays(r.to, r.from) >= 1) {
                      setDatesOpen(false);
                    }
                  }}
                  numberOfMonths={isMobile ? 1 : 2}
                  disabled={{ before: today }}
                  startMonth={today}
                  showOutsideDays
                />
                <div className="mt-1 flex items-center justify-between border-t px-2 pt-2">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={!range?.from}
                    onClick={() => setRange(undefined)}
                  >
                    Clear
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    className="rounded-full"
                    onClick={() => setDatesOpen(false)}
                  >
                    Done
                  </Button>
                </div>
              </PopoverContent>
            </Popover>

            {/* Adults */}
            <Popover open={adultsOpen} onOpenChange={setAdultsOpen}>
              <PopoverTrigger
                render={
                  <button type="button" className={cn(coreSegClass("middle", adultsOpen), "w-32")}>
                    <SegContent
                      label="Adults"
                      value={guestLabel}
                      muted={false}
                      active={adultsOpen}
                    />
                  </button>
                }
              />
              <PopoverContent align="center" className={cn("w-72", coreSearchPopoverClass)}>
                <Stepper
                  label="Adults"
                  hint="Ages 10+"
                  value={adults}
                  min={1}
                  max={10}
                  onChange={setAdults}
                />
              </PopoverContent>
            </Popover>

            {/* Kids */}
            <Popover open={kidsOpen} onOpenChange={setKidsOpen}>
              <PopoverTrigger
                render={
                  <button type="button" className={cn(coreSegClass("last", kidsOpen), "w-32")}>
                    <SegContent
                      label="Kids"
                      value={kidsLabel}
                      muted={children === 0}
                      active={kidsOpen}
                    />
                  </button>
                }
              />
              <PopoverContent align="end" className={cn("w-72", coreSearchPopoverClass)}>
                <Stepper
                  label="Kids"
                  hint="Ages 3 – 9"
                  value={children}
                  min={0}
                  max={10}
                  onChange={setChildren}
                />
              </PopoverContent>
            </Popover>
          </div>

          {!search && <CoreSearchButton onClick={submit} />}
        </div>
      </div>

      {/* Mobile search + controls FAB — replaces the sticky pill on small screens */}
      <div
        className="fixed left-1/2 z-40 -translate-x-1/2 md:hidden"
        style={{ bottom: "calc(env(safe-area-inset-bottom) + var(--bottom-nav-height) + 1rem)" }}
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
                <DrawerTitle className="[text-shadow:0_1px_3px_hsl(var(--foreground)/0.12)]">
                  Search resorts
                </DrawerTitle>
                <DrawerDescription>Choose your dates and guests.</DrawerDescription>
              </DrawerHeader>
              <div className="flex flex-col gap-5 overflow-y-auto px-4 pb-4 pt-6">
                {/* Where */}
                <div className="flex flex-col gap-2">
                  <span className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
                    Where
                  </span>
                  <div className="flex flex-wrap gap-2 pt-3">
                    {STAY_OPERATORS.map((op) => (
                      <Button
                        key={op.key}
                        size="sm"
                        variant={op.available ? "default" : "outline"}
                        className="rounded-full"
                        disabled={!op.available}
                        title={op.available ? undefined : "Coming soon"}
                      >
                        {op.label}
                        {!op.available && (
                          <span className="text-muted-foreground ml-1.5 text-xs">Coming soon</span>
                        )}
                      </Button>
                    ))}
                  </div>
                </div>
                {/* Who */}
                <div className="flex flex-col gap-1 border-t pt-4">
                  <span className="text-muted-foreground mb-1 text-xs font-medium uppercase tracking-wide">
                    Who
                  </span>
                  <Stepper
                    label="Adults"
                    hint="Ages 10+"
                    value={adults}
                    min={1}
                    max={10}
                    onChange={setAdults}
                  />
                  <Stepper
                    label="Kids"
                    hint="Ages 3–9"
                    value={children}
                    min={0}
                    max={10}
                    onChange={setChildren}
                  />
                </div>
                {/* When */}
                <div className="flex flex-col gap-2 border-t pt-4">
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
                      When
                    </span>
                    {range?.from && (
                      <Button variant="ghost" size="xs" onClick={() => setRange(undefined)}>
                        Clear
                      </Button>
                    )}
                  </div>
                  <div className="flex justify-center">
                    <Calendar
                      mode="range"
                      selected={range}
                      onSelect={setRange}
                      numberOfMonths={isMobile ? 1 : 2}
                      classNames={{ months: "relative flex flex-nowrap gap-4" }}
                      disabled={{ before: today }}
                      startMonth={today}
                      showOutsideDays
                    />
                  </div>
                </div>
              </div>
              <DrawerFooter>
                <DrawerClose asChild>
                  <Button className="rounded-full">Done</Button>
                </DrawerClose>
              </DrawerFooter>
            </DrawerContent>
          </Drawer>

          {search && (
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
                    <DrawerTitle>Sort resorts</DrawerTitle>
                    <DrawerDescription>Choose how the list is ordered.</DrawerDescription>
                  </DrawerHeader>
                  <div className="flex flex-col gap-1 px-4 pb-4">
                    {(Object.keys(STAY_SORT_LABELS) as Array<StaySortKey>).map((k) => (
                      <DrawerClose key={k} asChild>
                        <Button
                          variant={sortKey === k ? "secondary" : "ghost"}
                          className="w-full justify-start"
                          onClick={() => setSortKey(k)}
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
                    Filters
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
                      <span className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
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
                            onClick={() => setTierFilter(c.key)}
                          >
                            {c.label}
                          </Button>
                        ))}
                      </div>
                    </div>
                    <div className="flex flex-col gap-4 border-t pt-5">
                      <div className="flex items-center justify-between gap-4">
                        <div className="flex flex-col gap-0.5">
                          <span className="text-sm font-medium">Florida resident rates</span>
                          <span className="text-muted-foreground text-xs">
                            Show discounted nightly rates for Florida residents.
                          </span>
                        </div>
                        <Switch
                          checked={filters.floridaResident}
                          onCheckedChange={(v) => applyFilters({ floridaResident: v })}
                        />
                      </div>
                      <div className="flex items-center justify-between gap-4">
                        <div className="flex flex-col gap-0.5">
                          <span className="text-sm font-medium">Accessible rooms only</span>
                          <span className="text-muted-foreground text-xs">
                            Limit results to rooms with accessibility features.
                          </span>
                        </div>
                        <Switch
                          checked={filters.accessible}
                          onCheckedChange={(v) => applyFilters({ accessible: v })}
                        />
                      </div>
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
            </>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-8 px-4 py-6 pb-24 lg:px-6">
        {search ? (
          <ResultsView
            isLoading={availabilityQ.isLoading}
            isError={availabilityQ.isError}
            offers={filteredOffers}
            totalAvailable={availableCount}
            tierFilter={tierFilter}
            onTierFilter={setTierFilter}
            nights={nights}
            filters={filters}
            onApplyFilters={applyFilters}
            sortKey={sortKey}
            onSortKey={setSortKey}
            onRetry={() => void availabilityQ.refetch()}
            onEditDates={() => setDatesOpen(true)}
            alertDims={{
              checkInDate: iso(search.range.from!),
              checkOutDate: iso(search.range.to!),
              adults: search.adults,
              children: search.children,
              childAges: Array.from({ length: search.children }, () => 10),
              accessible: search.filters.accessible,
              floridaResident: search.filters.floridaResident,
            }}
            loggedIn={!!session?.user}
          />
        ) : (
          <BrowseView
            isLoading={catalogQ.isLoading}
            groups={byTier}
            onPickTier={(t) => {
              // Selecting a tier before searching nudges the user to pick dates.
              setTierFilter(t);
              setDatesOpen(true);
            }}
          />
        )}
      </div>
    </div>
  );
}

function BrowseView({
  isLoading,
  groups,
  onPickTier,
}: {
  isLoading: boolean;
  groups: Array<{
    meta: (typeof TIER_META)[number];
    resorts: Array<ResortCatalogEntry>;
  }>;
  onPickTier: (tier: ResortTier) => void;
}) {
  if (isLoading) {
    return (
      <div className="flex flex-col gap-10">
        {Array.from({ length: 3 }).map((_, g) => (
          <div key={g} className="flex flex-col gap-4">
            <Skeleton className="h-6 w-56" />
            <div className="grid grid-cols-2 gap-4 md:grid-cols-4 lg:grid-cols-5">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="flex flex-col gap-2">
                  <Skeleton className="aspect-[4/3] rounded-2xl" />
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="h-3 w-1/2" />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {groups.map(({ meta, resorts }) => (
        <Carousel key={meta.key} opts={{ align: "start", dragFree: true }} className="w-full">
          <section className="flex flex-col gap-3 py-4">
            <div className="flex items-end justify-between gap-4">
              <div className="flex flex-col gap-0.5">
                <button
                  type="button"
                  onClick={() => onPickTier(meta.key)}
                  className="text-left text-lg font-semibold tracking-tight hover:underline"
                >
                  {meta.heading}
                </button>
                <p className="text-muted-foreground text-sm">{meta.blurb}</p>
              </div>
              <CarouselArrows className="hidden md:flex" />
            </div>
            <CarouselContent className="-ml-4">
              {resorts.map((r) => (
                <CarouselItem
                  key={r.id}
                  className="basis-1/2 pl-4 md:basis-1/3 lg:basis-1/4 xl:basis-1/5"
                >
                  <ResortCard
                    name={r.name}
                    area={r.area}
                    image={r.image}
                    detailUrl={r.detailUrl}
                    slug={r.slug}
                    tier={r.tier}
                  />
                </CarouselItem>
              ))}
            </CarouselContent>
          </section>
        </Carousel>
      ))}
    </div>
  );
}

/** A compact inline switch + label used in the desktop results controls. */
function InlineToggle({
  id,
  label,
  checked,
  onCheckedChange,
}: {
  id: string;
  label: string;
  checked: boolean;
  onCheckedChange: (next: boolean) => void;
}) {
  return (
    <div className="flex shrink-0 items-center gap-2">
      <Switch id={id} size="sm" checked={checked} onCheckedChange={onCheckedChange} />
      <Label htmlFor={id} className="text-sm font-normal whitespace-nowrap">
        {label}
      </Label>
    </div>
  );
}

/**
 * Friendly empty/error state for the results grid: the lost-map mascot plus a
 * headline, sub-copy, and a primary CTA (with an optional secondary action).
 */
function StaysEmptyState({
  title,
  description,
  primaryLabel,
  onPrimary,
  secondaryLabel,
  onSecondary,
}: {
  title: string;
  description: string;
  primaryLabel: string;
  onPrimary: () => void;
  secondaryLabel?: string;
  onSecondary?: () => void;
}) {
  return (
    <Empty>
      <img
        src="/img/oops-map.png"
        alt=""
        aria-hidden
        className="-mb-7 -mt-10 w-full max-w-[320px] select-none"
      />
      <EmptyTitle>{title}</EmptyTitle>
      <EmptyDescription className="max-w-md">{description}</EmptyDescription>
      <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
        {secondaryLabel && onSecondary ? (
          <Button variant="outline" size="sm" onClick={onSecondary}>
            {secondaryLabel}
          </Button>
        ) : null}
        <Button size="sm" onClick={onPrimary}>
          {primaryLabel}
        </Button>
      </div>
    </Empty>
  );
}

function ResultsView({
  isLoading,
  isError,
  offers,
  tierFilter,
  onTierFilter,
  nights,
  filters,
  onApplyFilters,
  sortKey,
  onSortKey,
  onRetry,
  onEditDates,
  alertDims,
  loggedIn,
}: {
  isLoading: boolean;
  isError: boolean;
  offers: Array<{
    id: string;
    name: string;
    area: string | null;
    image: string | null;
    detailUrl: string;
    tier: ResortTier;
    pricePerNight: number | null;
    available: boolean;
    reasonCode: string | null;
  }>;
  totalAvailable: number;
  tierFilter: ResortTier | "ALL";
  onTierFilter: (t: ResortTier | "ALL") => void;
  nights: number;
  filters: StayFilters;
  onApplyFilters: (patch: Partial<StayFilters>) => void;
  sortKey: StaySortKey;
  onSortKey: (k: StaySortKey) => void;
  onRetry: () => void;
  onEditDates: () => void;
  alertDims: StayAlertDims;
  loggedIn: boolean;
}) {
  const chips: Array<{ key: ResortTier | "ALL"; label: string }> = [
    { key: "ALL", label: "All resorts" },
    ...TIER_META.map((t) => ({ key: t.key, label: t.label })),
  ];

  const activeCount = activeFilterCount(filters) + (tierFilter === "ALL" ? 0 : 1);
  const onClear = React.useCallback(() => {
    onApplyFilters(EMPTY_FILTERS);
    onTierFilter("ALL");
  }, [onApplyFilters, onTierFilter]);

  const countLabel = isLoading
    ? "Searching resorts…"
    : `${offers.length} resort${offers.length === 1 ? "" : "s"} available`;

  return (
    <div className="flex flex-col gap-5">
      {/* Desktop controls: tier chips wrap on their own row; toggles, count,
          and sort sit on the row below. The mobile FAB carries the same set. */}
      <div className="hidden flex-col gap-2 md:flex">
        <div className="flex flex-wrap items-center gap-2">
          {chips.map((c) => (
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
          <div className="bg-border mx-1 h-6 w-px" />
          <InlineToggle
            id="flt-fl"
            label="Florida resident"
            checked={filters.floridaResident}
            onCheckedChange={(v) => onApplyFilters({ floridaResident: v })}
          />
          <InlineToggle
            id="flt-access"
            label="Accessible rooms"
            checked={filters.accessible}
            onCheckedChange={(v) => onApplyFilters({ accessible: v })}
          />
          <span className="text-muted-foreground ml-auto shrink-0 text-sm whitespace-nowrap">
            {countLabel}
          </span>
          <Select
            value={sortKey}
            onValueChange={(v) => v && onSortKey(v as StaySortKey)}
            items={STAY_SORT_LABELS}
          >
            <SelectTrigger size="sm" className="w-44 shrink-0" aria-label="Sort resorts">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(STAY_SORT_LABELS) as Array<StaySortKey>).map((k) => (
                <SelectItem key={k} value={k}>
                  {STAY_SORT_LABELS[k]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Mobile summary — the FAB owns sort/filter editing here. */}
      <div className="flex items-center justify-between gap-2 md:hidden">
        <span className="text-sm font-medium">{countLabel}</span>
        {activeCount > 0 && (
          <Button variant="ghost" size="xs" onClick={onClear}>
            Clear ({activeCount})
          </Button>
        )}
      </div>

      {isLoading ? (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="flex flex-col gap-2">
              <Skeleton className="aspect-[4/3] rounded-2xl" />
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-3 w-1/2" />
            </div>
          ))}
        </div>
      ) : isError ? (
        <StaysEmptyState
          title="Even magic needs a map!"
          description="We couldn't pull live rates just now. Give it another try, or adjust your dates to chart a new course."
          primaryLabel="Try again"
          onPrimary={onRetry}
          secondaryLabel="Edit search dates"
          onSecondary={onEditDates}
        />
      ) : offers.length === 0 ? (
        <StaysEmptyState
          title="Even magic needs a map!"
          description="We couldn't find any available resort rooms for those exact dates. Try adjusting your dates or checking a neighboring resort area to get back on track."
          primaryLabel="Edit search dates"
          onPrimary={onEditDates}
        />
      ) : (
        <div className="grid grid-cols-2 gap-x-4 gap-y-6 md:grid-cols-3 lg:grid-cols-4">
          {offers.map((o) => (
            <ResortCard
              key={o.id}
              name={o.name}
              area={o.area}
              image={o.image}
              detailUrl={o.detailUrl}
              slug={SLUG_BY_ID.get(o.id) ?? null}
              tier={o.tier}
              pricePerNight={o.pricePerNight}
              available={o.available}
              reasonCode={o.reasonCode}
              nights={nights}
              alertSlot={
                <StayAlertButton
                  resortId={o.id}
                  resortName={o.name}
                  tier={o.tier}
                  area={o.area}
                  dims={alertDims}
                  loggedIn={loggedIn}
                />
              }
            />
          ))}
        </div>
      )}
    </div>
  );
}
