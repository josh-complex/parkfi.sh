"use client";

import * as React from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { differenceInCalendarDays, format } from "date-fns";
import { type DateRange } from "react-day-picker";
import { CheckIcon, MinusIcon, PlusIcon, SearchIcon } from "lucide-react";

import { StaysMobileControls } from "#/components/stays/stays-controls.tsx";
import {
  EMPTY_FILTERS,
  RESORT_AREAS,
  STAY_SORT_LABELS,
  TIER_LABEL,
  TIER_META,
  activeFilterCount,
  areaLabelForKey,
  areaStringForKey,
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
import { useIsMobile } from "#/hooks/use-mobile.ts";
import { useTRPC } from "#/integrations/trpc/react.ts";
import { cn } from "#/lib/utils.ts";
import type { ResortCatalogEntry, ResortTier } from "#/server/stays/resort-catalog.generated.ts";

const ISO = "yyyy-MM-dd";

function iso(d: Date): string {
  return format(d, ISO);
}

function rangeLabel(range: DateRange | undefined): string {
  if (!range?.from) return "Add dates";
  if (!range.to) return format(range.from, "MMM d");
  return `${format(range.from, "MMM d")} – ${format(range.to, "MMM d")}`;
}

type SegKey = "where" | "when" | "adults" | "kids";

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
  tier,
  pricePerNight,
  available,
  reasonCode,
  nights,
}: {
  name: string;
  area: string | null;
  image: string | null;
  detailUrl: string;
  tier: ResortTier;
  pricePerNight?: number | null;
  available?: boolean;
  reasonCode?: string | null;
  nights?: number;
}) {
  const hasResult = pricePerNight !== undefined;
  return (
    <a
      href={detailUrl}
      target="_blank"
      rel="noreferrer"
      className={cn(
        "group flex flex-col gap-2 outline-none",
        hasResult && available === false && "opacity-60",
      )}
    >
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
          <span className="mt-0.5 text-sm">
            <span className="text-muted-foreground">From </span>
            <span className="font-semibold">${pricePerNight.toLocaleString()}</span>{" "}
            <span className="text-muted-foreground">
              / night{nights ? ` · $${(pricePerNight * nights).toLocaleString()} total` : ""}
            </span>
          </span>
        )}
      </div>
    </a>
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

type SegPos = "first" | "middle" | "last";

/**
 * Shared styling for a search-pill segment. On desktop the highlight keeps the
 * pill's rounded ends but squares the interior edges, so the hovered/active
 * segment reads as part of one continuous bar. Hover/active uses the accent's
 * light foreground so text stays legible over the dark fill.
 */
function segClass(pos: SegPos, active: boolean) {
  return cn(
    "group flex min-w-0 flex-col rounded-2xl px-5 py-2.5 text-left outline-none transition-colors md:rounded-none",
    pos === "first" && "md:rounded-l-full",
    pos === "last" && "md:rounded-r-full",
    active
      ? "bg-accent text-accent-foreground"
      : "hover:bg-accent/60 hover:text-accent-foreground focus-visible:bg-accent/60 focus-visible:text-accent-foreground",
  );
}

/** Label + value stack inside a search-pill segment. */
function SegInner({
  label,
  value,
  muted,
  active,
}: {
  label: string;
  value: string;
  muted?: boolean;
  active: boolean;
}) {
  return (
    <>
      <span className="text-xs font-semibold">{label}</span>
      <span
        className={cn(
          "truncate text-sm transition-colors",
          !active &&
            muted &&
            "text-muted-foreground group-hover:text-accent-foreground group-focus-visible:text-accent-foreground",
        )}
      >
        {value}
      </span>
    </>
  );
}

/** Vertical hairline between two pill segments; fades when a neighbor is active. */
function SegDivider({ hide }: { hide: boolean }) {
  return (
    <div
      className={cn(
        "mx-1 hidden h-7 w-px self-center bg-border transition-opacity md:block",
        hide ? "opacity-0" : "opacity-100",
      )}
    />
  );
}

/** A selectable park/area row inside the "Where" popover. */
function AreaOption({
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

export function StaysBoard({ areaKey }: { areaKey: string | null }) {
  const trpc = useTRPC();
  const isMobile = useIsMobile();
  const navigate = useNavigate();

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
  const [hovered, setHovered] = React.useState<SegKey | null>(null);
  const [search, setSearch] = React.useState<SearchState | null>(null);
  const [tierFilter, setTierFilter] = React.useState<ResortTier | "ALL">("ALL");
  const [sortKey, setSortKey] = React.useState<StaySortKey>("recommended");

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

  // The "where" segment scopes by resort area via the route's `?area=` param.
  const pickArea = React.useCallback(
    (key: string | null) => {
      setWhereOpen(false);
      void navigate({ to: "/stays", search: key ? { area: key } : {} });
    },
    [navigate],
  );

  const guestLabel = `${adults} adult${adults === 1 ? "" : "s"}`;
  const kidsLabel = `${children} kid${children === 1 ? "" : "s"}`;
  const today = React.useMemo(() => new Date(), []);

  const areaStr = areaStringForKey(areaKey);
  const areaLabel = areaLabelForKey(areaKey);

  const offers = availabilityQ.data?.offers ?? [];
  const inArea = areaStr ? offers.filter((o) => o.area === areaStr) : offers;
  const tierScoped = tierFilter === "ALL" ? inArea : inArea.filter((o) => o.tier === tierFilter);
  const filteredOffers = sortOffers(tierScoped, sortKey);
  const availableCount = inArea.filter((o) => o.available).length;

  // Browse rows (pre-search): catalog grouped by tier, in TIER_META order.
  const byTier = React.useMemo(() => {
    const scoped = areaStr ? catalog.filter((r) => r.area === areaStr) : catalog;
    return TIER_META.map((meta) => ({
      meta,
      resorts: scoped.filter((r) => r.tier === meta.key),
    })).filter((g) => g.resorts.length > 0);
  }, [catalog, areaStr]);

  const focusKey: SegKey | null = whereOpen
    ? "where"
    : datesOpen
      ? "when"
      : adultsOpen
        ? "adults"
        : kidsOpen
          ? "kids"
          : hovered;

  const seg = (key: SegKey) => ({
    onMouseEnter: () => setHovered(key),
    onMouseLeave: () => setHovered((h) => (h === key ? null : h)),
  });

  return (
    <div className="relative isolate flex flex-col">
      {/* Slight radial wash in the sidebar's Disney blue, behind the hero copy
          and the at-rest search pill; scrolls away with the page. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-60 bg-[radial-gradient(120%_140%_at_50%_-25%,color-mix(in_oklab,var(--color-sidebar)_26%,transparent),transparent_70%)]"
      />

      {/* Hero — the page's stay headline sits above the search, which becomes
          sticky beneath it. */}
      <div className="px-4 pt-8 pb-5 text-center lg:px-6">
        <h1 className="text-2xl font-bold tracking-tight">
          {areaLabel ? `Stays near ${areaLabel}` : "Find your stay at Walt Disney World"}
        </h1>
        <p className="text-muted-foreground mx-auto mt-1 max-w-xl text-sm">
          Browse {areaLabel ? "these" : "every"} Disney Resort hotel
          {areaLabel ? "s" : ""}, then add dates below to see live nightly rates.
        </p>
      </div>

      {/* Flow sentinel: marks where the bar starts sticking (see the effect). */}
      <div ref={sentinelRef} aria-hidden className="h-0" />

      {/* Search bar — compact Airbnb-style pill that collapses to a stack on mobile. */}
      <div
        className={cn(
          "sticky top-(--header-height) z-20 px-4 py-4 transition-colors duration-200 md:top-0 lg:px-6",
          stuck
            ? "bg-background/80 border-b backdrop-blur-md"
            : "border-b border-transparent bg-transparent",
        )}
      >
        <div className="mx-auto flex w-full max-w-sm flex-col gap-2 rounded-3xl border bg-card p-2 shadow-sm md:w-fit md:max-w-none md:flex-row md:items-center md:gap-0 md:rounded-full md:p-1.5">
          {/* Where */}
          <Popover open={whereOpen} onOpenChange={setWhereOpen}>
            <PopoverTrigger
              render={
                <button
                  type="button"
                  className={segClass("first", focusKey === "where")}
                  {...seg("where")}
                >
                  <SegInner
                    label="Where"
                    value={areaLabel ?? "All resorts"}
                    muted={!areaLabel}
                    active={focusKey === "where"}
                  />
                </button>
              }
            />
            <PopoverContent align="start" className="w-64 p-1.5">
              <AreaOption label="All resorts" selected={!areaKey} onSelect={() => pickArea(null)} />
              {RESORT_AREAS.map((a) => (
                <AreaOption
                  key={a.key}
                  label={a.label}
                  selected={areaKey === a.key}
                  onSelect={() => pickArea(a.key)}
                />
              ))}
            </PopoverContent>
          </Popover>

          <SegDivider hide={focusKey === "where" || focusKey === "when"} />

          {/* When */}
          <Popover open={datesOpen} onOpenChange={setDatesOpen}>
            <PopoverTrigger
              render={
                <button
                  type="button"
                  className={segClass("middle", focusKey === "when")}
                  {...seg("when")}
                >
                  <SegInner
                    label="When"
                    value={rangeLabel(range)}
                    muted={!range?.from}
                    active={focusKey === "when"}
                  />
                </button>
              }
            />
            <PopoverContent align="center" className="w-auto p-2">
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

          <SegDivider hide={focusKey === "when" || focusKey === "adults"} />

          {/* Adults */}
          <Popover open={adultsOpen} onOpenChange={setAdultsOpen}>
            <PopoverTrigger
              render={
                <button
                  type="button"
                  className={segClass("middle", focusKey === "adults")}
                  {...seg("adults")}
                >
                  <SegInner label="Adults" value={guestLabel} active={focusKey === "adults"} />
                </button>
              }
            />
            <PopoverContent align="center" className="w-72">
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

          <SegDivider hide={focusKey === "adults" || focusKey === "kids"} />

          {/* Kids */}
          <Popover open={kidsOpen} onOpenChange={setKidsOpen}>
            <PopoverTrigger
              render={
                <button
                  type="button"
                  className={segClass("last", focusKey === "kids")}
                  {...seg("kids")}
                >
                  <SegInner
                    label="Kids"
                    value={kidsLabel}
                    muted={children === 0}
                    active={focusKey === "kids"}
                  />
                </button>
              }
            />
            <PopoverContent align="end" className="w-72">
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

          <Button
            type="button"
            size="lg"
            onClick={submit}
            className="rounded-2xl md:ml-1 md:size-11 md:rounded-full md:p-0"
          >
            <SearchIcon />
            <span className="md:hidden">Search resorts</span>
          </Button>
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
                <Skeleton key={i} className="aspect-[4/3] rounded-2xl" />
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
        src="/img/oops.png"
        alt=""
        aria-hidden
        className="mb-1 w-full max-w-[320px] select-none"
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
  totalAvailable,
  tierFilter,
  onTierFilter,
  nights,
  filters,
  onApplyFilters,
  sortKey,
  onSortKey,
  onRetry,
  onEditDates,
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
    : `${totalAvailable} resort${totalAvailable === 1 ? "" : "s"} available`;

  return (
    <div className="flex flex-col gap-5">
      {/* Desktop controls: resort-type chips and the rate toggles sit together
          on the left; the live count and sort are pinned to the right. The
          mobile FAB carries the same set. */}
      <div className="hidden items-center gap-3 md:flex">
        <div className="flex min-w-0 items-center gap-2 overflow-x-auto pb-1">
          {chips.map((c) => (
            <Button
              key={c.key}
              type="button"
              size="sm"
              variant={tierFilter === c.key ? "default" : "outline"}
              className="shrink-0 rounded-full"
              onClick={() => onTierFilter(c.key)}
            >
              {c.label}
            </Button>
          ))}
        </div>
        <div className="bg-border h-6 w-px shrink-0" />
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
              tier={o.tier}
              pricePerNight={o.pricePerNight}
              available={o.available}
              reasonCode={o.reasonCode}
              nights={nights}
            />
          ))}
        </div>
      )}

      <StaysMobileControls
        tierFilter={tierFilter}
        onTierFilter={onTierFilter}
        filters={filters}
        onFilters={onApplyFilters}
        sortKey={sortKey}
        onSortKey={onSortKey}
        activeCount={activeCount}
        onClear={onClear}
      />
    </div>
  );
}
