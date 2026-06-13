"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { AnimatePresence, motion } from "motion/react";
import { createPortal } from "react-dom";
import { ArrowUpDownIcon, CheckIcon, SearchIcon, SlidersHorizontalIcon, XIcon } from "lucide-react";

import {
  CoreSearchButton,
  coreSearchPopoverClass,
  coreSegClass,
  SegContent,
  useCloseOnScroll,
  type SegPos,
} from "#/components/core-search.tsx";
import {
  countExtraFilters,
  DEFAULT_FILTERS,
  deriveOptions,
  FEATURE_FILTERS,
  filterRestaurants,
  OPERATOR_LABELS,
  priceTier,
  SORT_LABELS,
  sortRestaurants,
  type AvailabilityEntry,
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
  HOURS_OPTIONS,
  hoursLabel,
  isOpenNow,
  parkNowMinutes,
  type HoursMap,
  type ScheduleEntry,
} from "#/components/dining/dining-hours.ts";
import { DiningMenuChanges } from "#/components/dining/dining-menu-changes.tsx";
import { DiningMenuDrawer } from "#/components/dining/dining-menu-drawer.tsx";
import { DiningPicks } from "#/components/dining/dining-picks.tsx";
import { Badge } from "#/components/ui/badge.tsx";
import { Button, buttonVariants } from "#/components/ui/button.tsx";
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
import { Switch } from "../animate-ui/components/switch-anim";

const PAGE_SIZE = 12;

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function AvailabilityCalendar({
  days,
  windowDays,
  referenceDate,
}: {
  days: Array<DayEntry>;
  windowDays: number;
  referenceDate: string;
}) {
  const shown = days.slice(0, Math.min(windowDays, 7));
  return (
    <div className="flex gap-1">
      {shown.map((d) => {
        const date = new Date(`${d.date}T00:00:00`);
        const dayName = date.toLocaleDateString("en-US", { weekday: "short" });
        const dayNum = date.getDate();
        const isToday = d.date === referenceDate;
        return (
          <div
            key={d.date}
            title={
              d.available
                ? `${d.offerCount} slot${d.offerCount === 1 ? "" : "s"}`
                : "No availability"
            }
            className={cn(
              "flex flex-1 flex-col items-center gap-0.5 rounded py-1",
              d.available
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground/60",
              isToday && "ring-2 ring-inset ring-foreground/20",
            )}
          >
            <span className="text-[10px] leading-none">{dayName}</span>
            <span className="text-xs font-medium leading-none">{dayNum}</span>
          </div>
        );
      })}
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
  const subtitle = [restaurant.parkResort, restaurant.experienceType ?? restaurant.cuisine]
    .filter(Boolean)
    .join(" · ");
  const todayHours = schedules ? hoursLabel(schedules) : null;
  const openNow = schedules ? isOpenNow(schedules, nowMin) : false;

  const hasTags =
    restaurant.requiresParkTicket ||
    restaurant.characterDining ||
    restaurant.dinnerShow ||
    restaurant.fineDining;

  const tagBadges = hasTags && (
    <>
      {restaurant.requiresParkTicket && (
        <Badge className="bg-black/60 text-white text-xs font-normal border-0 shadow-none backdrop-blur-sm">
          Park ticket
        </Badge>
      )}
      {restaurant.characterDining && (
        <Badge className="bg-black/60 text-white text-xs font-normal border-0 shadow-none backdrop-blur-sm">
          Characters
        </Badge>
      )}
      {restaurant.dinnerShow && (
        <Badge className="bg-black/60 text-white text-xs font-normal border-0 shadow-none backdrop-blur-sm">
          Dinner show
        </Badge>
      )}
      {restaurant.fineDining && (
        <Badge className="bg-black/60 text-white text-xs font-normal border-0 shadow-none backdrop-blur-sm">
          Signature
        </Badge>
      )}
    </>
  );

  return (
    <Card className="@container/card overflow-hidden pt-0 gap-2 pb-2">
      {restaurant.imageUrl && (
        <div className="bg-muted relative h-32 w-full overflow-hidden">
          <img
            src={restaurant.imageUrl}
            alt={restaurant.name}
            loading="lazy"
            className="size-full object-cover"
          />
          {restaurant.priceRange && (
            <Badge className="absolute top-2 left-2 bg-black/60 text-white text-xs font-normal border-0 shadow-none backdrop-blur-sm">
              {priceTier(restaurant.priceRange)}
            </Badge>
          )}
          {todayHours &&
            (openNow ? (
              <Badge className="absolute top-2 right-2 bg-emerald-500 text-white shadow">
                Open · {todayHours}
              </Badge>
            ) : (
              <Badge variant="secondary" className="absolute top-2 right-2 shadow">
                Closed · {todayHours}
              </Badge>
            ))}
          {hasTags && (
            <div className="absolute bottom-2 left-2 flex flex-wrap gap-1">{tagBadges}</div>
          )}
        </div>
      )}
      <CardHeader
        className={cn("px-3 sm:px-4 pb-1", restaurant.imageUrl ? "pt-2 sm:pt-3" : "pt-3 sm:pt-4")}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <CardTitle className="line-clamp-1 text-base sm:text-lg">
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
          {!restaurant.imageUrl && todayHours && openNow && (
            <Badge className="bg-emerald-500 text-white shrink-0">Open · {todayHours}</Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="px-3 sm:px-4 flex flex-col gap-1 pt-0 pb-2">
        {availability ? (
          <>
            <AvailabilityCalendar
              days={availability.days}
              windowDays={windowDays}
              referenceDate={referenceDate}
            />
          </>
        ) : (
          <p className="text-xs text-muted-foreground">No observations yet</p>
        )}
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          {availability ? (
            <span className="flex items-center gap-1.5">
              <span className="size-2 rounded-sm bg-primary shrink-0" />
              Reservations available
            </span>
          ) : (
            <span>No availability data</span>
          )}
          {!restaurant.imageUrl && restaurant.priceRange && (
            <Badge variant="outline" className="font-normal text-xs shrink-0">
              {priceTier(restaurant.priceRange)}
            </Badge>
          )}
        </div>
        {!restaurant.imageUrl && hasTags && <div className="flex flex-wrap gap-1">{tagBadges}</div>}
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
 * inside the FiltersModal for both mobile and desktop.
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
  const todayOnly = filters.availability === "today";
  return (
    <div className="divide-y">
      <div className="relative py-4">
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
                  className="min-w-10 rounded-full"
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
        <label className="flex cursor-pointer items-center gap-3">
          <Switch
            checked={todayOnly}
            onCheckedChange={(checked) => onFilters({ availability: checked ? "today" : "ALL" })}
          />
          <span className="text-sm font-medium">Open today</span>
        </label>
      </Section>

      <Section label="Hours">
        <PillRow
          options={[...HOURS_OPTIONS]}
          value={filters.hours}
          onSelect={(v) => onFilters({ hours: v })}
          labelOf={(v) => HOURS_LABELS[v]}
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
    <div className="flex flex-col gap-3 py-4">
      <span className="text-muted-foreground text-[11px] font-semibold tracking-widest uppercase">
        {label}
      </span>
      {children}
    </div>
  );
}

// Shared-layout ids: the panel id morphs the trigger box ↔ the modal container;
// the label id carries the "Filters" word from the button into the dialog title.
const FILTERS_PANEL_ID = "dining-filters-panel";
const FILTERS_LABEL_ID = "dining-filters-label";
// Matched border radius on both ends so the box morph interpolates cleanly.
const FILTERS_RADIUS = 18;
// One spring drives the box morph in both directions (and the title travel),
// so opening and closing feel symmetrical.
const FILTERS_SPRING = { type: "spring" as const, stiffness: 420, damping: 34, mass: 0.9 };

// Same 3D border + glare + drop-shadow the outline Button wears, so the panel
// reads as the very same surface the trigger grew out of.
const FILTERS_SURFACE =
  "bg-background border border-(--btn-3d) [--btn-3d:color-mix(in_oklch,var(--border),var(--border))] [--btn-glare:oklch(1_0_0/0.55)] shadow-[0_4px_0_0_var(--btn-3d),inset_0_1px_0_0_var(--btn-glare)] dark:bg-popover dark:[--btn-3d:transparent] dark:[--btn-glare:oklch(1_0_0/0.06)] dark:ring-1 dark:ring-foreground/10";

/**
 * The desktop "Filters" control. The trigger is a standard outline button that
 * physically morphs into the filter modal (and back) via shared-layout: the box
 * itself grows, while the "Filters" label travels from the button into the
 * dialog title. Only the container's position/size and the label's position
 * change — the surface styling is identical at both ends.
 */
function FiltersModal({
  filters,
  onFilters,
  options,
  partySize,
  onPartySize,
  extraCount,
  onClearExtra,
}: {
  filters: ClientFilters;
  onFilters: (patch: Partial<ClientFilters>) => void;
  options: FilterOptions;
  partySize: string;
  onPartySize: (v: string) => void;
  extraCount: number;
  onClearExtra: () => void;
}) {
  const [open, setOpen] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      <motion.button
        layoutId={FILTERS_PANEL_ID}
        type="button"
        onClick={() => setOpen(true)}
        // Fade out fast on open (the modal carries the morph on top); delay
        // fade-in on close so the icon appears after the box has mostly shrunk.
        animate={{ opacity: open ? 0 : 1 }}
        transition={{
          layout: FILTERS_SPRING,
          opacity: { duration: open ? 0.06 : 0.18, delay: open ? 0 : 0.2 },
        }}
        style={{ borderRadius: FILTERS_RADIUS }}
        className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
      >
        <SlidersHorizontalIcon data-icon="inline-start" />
        {!open && (
          <motion.span
            layoutId={FILTERS_LABEL_ID}
            transition={{ layout: FILTERS_SPRING }}
            className="inline-block"
          >
            Filters
          </motion.span>
        )}
      </motion.button>

      {createPortal(
        <AnimatePresence>
          {open && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
              <motion.div
                className="absolute inset-0 bg-black/40 supports-backdrop-filter:backdrop-blur-sm"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1, transition: { duration: 0.14 } }}
                exit={{ opacity: 0, transition: { duration: 0.07 } }}
                onClick={() => setOpen(false)}
              />

              <motion.div
                layoutId={FILTERS_PANEL_ID}
                role="dialog"
                aria-modal="true"
                aria-label="Filters"
                style={{ borderRadius: FILTERS_RADIUS }}
                transition={{ layout: FILTERS_SPRING }}
                className={cn(
                  "relative z-10 flex max-h-[80vh] w-full max-w-md flex-col overflow-hidden",
                  FILTERS_SURFACE,
                )}
              >
                <div className="flex shrink-0 items-center justify-between gap-4 border-b px-5 py-3.5">
                  <motion.span
                    layoutId={FILTERS_LABEL_ID}
                    transition={{ layout: FILTERS_SPRING }}
                    className="inline-block text-base font-semibold"
                  >
                    Filters
                  </motion.span>
                  <motion.button
                    type="button"
                    onClick={() => setOpen(false)}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1, transition: { delay: 0.16, duration: 0.12 } }}
                    exit={{ opacity: 0, transition: { duration: 0.05 } }}
                    className="text-muted-foreground hover:bg-muted hover:text-foreground -mr-1 rounded-full p-1.5 transition-colors"
                    aria-label="Close"
                  >
                    <XIcon className="size-4" />
                  </motion.button>
                </div>

                <motion.div
                  className="flex min-h-0 flex-1 flex-col"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1, transition: { delay: 0.16, duration: 0.12 } }}
                  exit={{ opacity: 0, transition: { duration: 0.05 } }}
                >
                  <div className="flex-1 overflow-y-auto px-5">
                    <ExtendedFilters
                      filters={filters}
                      onFilters={onFilters}
                      options={options}
                      partySize={partySize}
                      onPartySize={onPartySize}
                    />
                  </div>

                  <div className="flex shrink-0 gap-2 border-t p-4">
                    <Button
                      variant="outline"
                      className={cn("flex-1", extraCount === 0 && "opacity-40")}
                      disabled={extraCount === 0}
                      onClick={onClearExtra}
                    >
                      Clear all
                    </Button>
                    <Button className="flex-1" onClick={() => setOpen(false)}>
                      Done
                    </Button>
                  </div>
                </motion.div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>,
        document.body,
      )}
    </>
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

      {/* Short hero — collapses away once the user commits a search. */}
      <div
        className={cn(
          "grid transition-all duration-500 ease-in-out",
          searched ? "grid-rows-[0fr] opacity-0" : "grid-rows-[1fr] opacity-100",
        )}
      >
        <div className="overflow-hidden">
          <div className="px-4 pt-8 pb-5 text-center lg:px-6">
            <h1 className="text-2xl font-bold tracking-tight">Find a table at the parks</h1>
            <p className="text-muted-foreground mx-auto mt-1 max-w-xl text-sm">
              Browse Disney &amp; Universal restaurants, then search to see live reservation
              availability.
            </p>
          </div>
        </div>
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
        <div className="relative mx-auto flex w-fit items-stretch gap-2">
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

              {/* Filters — a bottom drawer is the right fit on mobile. */}
              <Drawer>
                <DrawerTrigger asChild>
                  <Button variant="ghost" size="sm" className="rounded-full">
                    <SlidersHorizontalIcon data-icon="inline-start" />
                    Filters
                    {extraCount > 0 ? <span className="bg-primary size-1.5 rounded-full" /> : null}
                  </Button>
                </DrawerTrigger>
                <DrawerContent>
                  <DrawerHeader className="border-b pb-4">
                    <DrawerTitle>Filters</DrawerTitle>
                    <DrawerDescription>
                      Narrow by price, hours, features, and more.
                    </DrawerDescription>
                  </DrawerHeader>
                  <div className="overflow-y-auto px-4">
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

      <div className="flex flex-col gap-8 p-4 pb-24 lg:px-6">
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
      {/* Desktop controls: Filters modal + active chips on the left; count + sort right. */}
      <div className="hidden items-center gap-2 md:flex">
        <FiltersModal
          filters={filters}
          onFilters={onFilters}
          options={options}
          partySize={partySize}
          onPartySize={onPartySize}
          extraCount={extraCount}
          onClearExtra={onClearExtra}
        />
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
