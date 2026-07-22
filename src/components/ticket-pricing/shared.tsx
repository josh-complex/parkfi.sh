"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import type { DayButton } from "react-day-picker";

import { Store, useSelector } from "@tanstack/react-store";
import { CloudDrizzle } from "#/components/animate-ui/icons/cloud-drizzle.tsx";
import { CloudHail } from "#/components/animate-ui/icons/cloud-hail.tsx";
import { AnimateIcon } from "#/components/animate-ui/icons/icon.tsx";
import { CloudLightning } from "#/components/animate-ui/icons/cloud-lightning.tsx";
import { CloudRain } from "#/components/animate-ui/icons/cloud-rain.tsx";
import { CloudRainWind } from "#/components/animate-ui/icons/cloud-rain-wind.tsx";
import { CloudSnow } from "#/components/animate-ui/icons/cloud-snow.tsx";
import { CloudSun } from "#/components/animate-ui/icons/cloud-sun.tsx";
import { CloudSunRain } from "#/components/animate-ui/icons/cloud-sun-rain.tsx";
import { Sun } from "#/components/animate-ui/icons/sun.tsx";

import { Button } from "#/components/ui/button.tsx";
import { Calendar } from "#/components/ui/calendar.tsx";
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from "#/components/ui/drawer.tsx";
import { Empty, EmptyDescription, EmptyTitle } from "#/components/ui/empty.tsx";
import { Skeleton } from "#/components/ui/skeleton.tsx";
import { useTRPC } from "#/integrations/trpc/react.ts";
import { formatHourRange } from "#/lib/park-hours.ts";
import { RESORT_DEFAULT_SLUG, UOR_PARKS, WDW_PARKS } from "#/lib/parks.ts";
import { unitsLeftChip, type ScarcityTier } from "#/lib/ticket-scarcity.ts";
import { cn } from "#/lib/utils.ts";

export type Resort = "WDW" | "UOR";
export type AgeGroup = "ADULT" | "CHILD";

export const RESORTS: Array<{ value: Resort; label: string }> = [
  { value: "WDW", label: "Walt Disney World" },
  { value: "UOR", label: "Universal Orlando" },
];

export const DAYS = 150;
export const PAST_DAYS = 90;

export interface DayPrice {
  priceCents: number;
  available: boolean;
  /** Raw Express units left (Universal only); null = no unit signal. */
  availableUnits: number | null;
  /** Express-inventory scarcity tier (Universal only); drives the accent color. */
  scarcity: ScarcityTier | null;
}

export interface DayOverlay {
  crowdIndex: number | null;
  crowdIsEstimate: boolean;
  highF: number | null;
  precipProb: number | null;
  condition: string | null;
  /** Compact operating-hours range for the day, e.g. "9a–11p"; null when closed/unknown. */
  hours: string | null;
}

export function localIso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
}

export function dollars(cents: number): string {
  return `$${Math.round(cents / 100)}`;
}

export interface CrowdConfig {
  bg: string;
  pill: string;
  label: string;
}

export function crowdConfig(index: number): CrowdConfig {
  if (index <= 3)
    return {
      bg: "bg-emerald-500",
      pill: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300",
      label: "Low",
    };
  if (index <= 5)
    return {
      bg: "bg-amber-400",
      pill: "bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300",
      label: "Moderate",
    };
  if (index <= 7)
    return {
      bg: "bg-orange-400",
      pill: "bg-orange-100 text-orange-600 dark:bg-orange-900/50 dark:text-orange-300",
      label: "Busy",
    };
  return {
    bg: "bg-red-500",
    pill: "bg-red-100 text-red-600 dark:bg-red-900/50 dark:text-red-300",
    label: "Packed",
  };
}

export function WeatherIcon({
  condition,
  precipProb = null,
  size = 14,
}: {
  condition: string | null;
  precipProb?: number | null;
  size?: number;
}) {
  const c = condition?.toLowerCase() ?? "";
  const p = { size, className: "shrink-0" };
  if (c.includes("thunder") || c.includes("lightning")) return <CloudLightning {...p} />;
  if (c.includes("hail")) return <CloudHail {...p} />;
  if (c.includes("snow")) return <CloudSnow {...p} />;
  if (c.includes("drizzle")) return <CloudDrizzle {...p} />;
  if (c.includes("wind") && c.includes("rain")) return <CloudRainWind {...p} />;
  if ((c.includes("rain") || c.includes("shower")) && (c.includes("sun") || c.includes("partly")))
    return <CloudSunRain {...p} />;
  if (c.includes("rain") || c.includes("shower")) return <CloudRain {...p} />;
  if (c.includes("partly") || (c.includes("cloud") && c.includes("sun")))
    return <CloudSun {...p} />;
  if (c.includes("cloud") || c.includes("overcast")) return <CloudSun {...p} />;
  if (c.includes("clear") || c.includes("sun") || c.includes("fair")) return <Sun {...p} />;
  // Fallback: infer from precip probability when condition string is absent
  if (precipProb != null) {
    const pct = precipProb > 1 ? precipProb : precipProb * 100;
    if (pct >= 70) return <CloudRain {...p} />;
    if (pct >= 30) return <CloudSunRain {...p} />;
    return <CloudSun {...p} />;
  }
  return <Sun {...p} />;
}

export function formatPrecip(precipProb: number | null): string | null {
  if (precipProb == null) return null;
  // Normalize: stored as 0-100 or 0-1
  const pct = precipProb > 1 ? Math.round(precipProb) : Math.round(precipProb * 100);
  return pct >= 20 ? `${pct}%` : null;
}

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

// Day cell classNames override — removes aspect-square so cells use a fixed
// height rather than growing as tall as they are wide in a full-width calendar.
const DAY_CELL_CLASS =
  "group/day relative h-[64px] sm:h-[90px] lg:h-[100px] w-full rounded-(--cell-radius) p-0 text-center select-none " +
  "[&:last-child[data-selected=true]_button]:rounded-r-(--cell-radius) " +
  "[&:first-child[data-selected=true]_button]:rounded-l-(--cell-radius)";

interface CalendarState {
  priceMap: Map<string, DayPrice>;
  min: number | undefined;
  overlayMap: Map<string, DayOverlay>;
  /** ISO dates blocked for this selection's Annual Passholders (WDW only). */
  blockedDates: Set<string>;
}

function newCalendarStore(): Store<CalendarState> {
  return new Store<CalendarState>({
    priceMap: new Map(),
    min: undefined,
    overlayMap: new Map(),
    blockedDates: new Set<string>(),
  });
}

// Fallback for a DayButton rendered outside a provider (shouldn't happen in practice).
const EMPTY_STORE = newCalendarStore();

// Per-instance store so more than one calendar can be mounted at once (the desktop
// calendar and the mobile shelf's calendar drawer). `react-day-picker` renders the
// DayButton without letting us thread extra props through, so it reads its cell data
// from the nearest store on context instead.
const CalendarStoreContext = React.createContext<Store<CalendarState> | null>(null);

// Defined at module level so the component type is stable across renders.
function PriceDayButton({
  className,
  day,
  modifiers,
  ...props
}: React.ComponentProps<typeof DayButton>) {
  const store = React.useContext(CalendarStoreContext) ?? EMPTY_STORE;
  const priceMap = useSelector(store, (s) => s.priceMap);
  const min = useSelector(store, (s) => s.min);
  const overlayMap = useSelector(store, (s) => s.overlayMap);
  const blockedDates = useSelector(store, (s) => s.blockedDates);
  const iso = localIso(day.date);
  const info = priceMap.get(iso);
  const overlay = overlayMap.get(iso);
  const apBlocked = blockedDates.has(iso);
  const isCheapest = info != null && min != null && info.priceCents === min;
  const crowd = overlay?.crowdIndex != null ? crowdConfig(overlay.crowdIndex) : null;
  const precip = formatPrecip(overlay?.precipProb ?? null);
  // Express units left (Universal only; hidden for sold-out / WDW). The Tickets
  // page shows the actual count even when plentiful.
  const units = info?.available ? unitsLeftChip(info.availableUnits) : null;

  return (
    <AnimateIcon animateOnHover asChild>
      <Button
        variant="outlineCal"
        className={cn(
          "relative flex h-full w-full overflow-hidden p-0 font-normal",
          modifiers.outside && "opacity-40",
          apBlocked && "ring-2 ring-inset ring-red-500/55",
          className,
        )}
        {...props}
      >
        {/* ── MOBILE (< sm): date + price only ── */}
        <div className="flex h-full w-full flex-col items-center justify-between p-1.5 pb-2.5 sm:hidden">
          <span className="text-[13px] font-bold tabular-nums leading-none">
            {day.date.getDate()}
          </span>
          {info ? (
            <span
              className={cn(
                "tabular-nums leading-none",
                !info.available
                  ? "text-[10px] text-muted-foreground/40 line-through"
                  : isCheapest
                    ? "text-[13px] font-extrabold text-primary"
                    : "text-[11px] font-semibold text-foreground/75",
              )}
            >
              {dollars(info.priceCents)}
            </span>
          ) : (
            <span className="text-[10px] text-muted-foreground/25">—</span>
          )}
        </div>

        {/* ── TABLET (sm–lg): date, temp, price. Crowd rides the corner dot +
            bottom bar; hours/DOW live in the tap-a-day detail sheet. ── */}
        <div className="hidden h-full w-full flex-col items-center justify-between p-2 pb-3 sm:flex lg:hidden">
          <span className="text-[15px] font-bold tabular-nums leading-none">
            {day.date.getDate()}
          </span>

          {overlay?.highF != null ? (
            <span className="text-[11px] tabular-nums text-muted-foreground/80 leading-none">
              {overlay.highF}°
              {precip && <span className="ml-1 text-sky-500 dark:text-sky-400">{precip}</span>}
            </span>
          ) : (
            <span className="h-[14px]" />
          )}

          {info ? (
            <span
              className={cn(
                "tabular-nums leading-none",
                !info.available
                  ? "text-[9px] text-muted-foreground/40 line-through"
                  : isCheapest
                    ? "text-[15px] font-extrabold text-primary"
                    : "text-[12px] font-semibold text-foreground/80",
              )}
            >
              {dollars(info.priceCents)}
            </span>
          ) : (
            <span className="text-[9px] text-muted-foreground/25">—</span>
          )}
        </div>

        {/* ── DESKTOP (lg+): date+dow left / overflowing icon bg / price+pill bottom ── */}
        <div className="hidden h-full w-full flex-col justify-between p-2.5 lg:flex">
          <div className="relative flex w-full items-start justify-between">
            <div className="flex flex-col gap-0.75">
              <span className="text-[18px] font-bold tabular-nums leading-none">
                {day.date.getDate()}
              </span>
              <span className="text-[9px] font-medium uppercase tracking-widest text-muted-foreground/60 leading-none">
                {DOW[day.date.getDay()]}
              </span>
              {overlay?.hours && (
                <span className="text-[9px] font-semibold tabular-nums leading-none text-foreground/65">
                  {overlay.hours}
                </span>
              )}
              {apBlocked && (
                <span className="text-[9px] font-bold uppercase leading-none tracking-wide text-red-500 dark:text-red-400">
                  AP blocked
                </span>
              )}
            </div>

            <div className="relative z-10 flex flex-col items-end gap-0.75">
              {overlay?.highF != null && (
                <span className="text-[12px] font-semibold tabular-nums leading-none text-foreground/80">
                  {overlay.highF}°
                </span>
              )}
              {precip && (
                <span className="text-[9px] font-medium tabular-nums leading-none text-sky-500 dark:text-sky-400">
                  {precip} rain
                </span>
              )}
            </div>

            {(overlay?.condition != null ||
              overlay?.highF != null ||
              overlay?.precipProb != null) && (
              <div className="pointer-events-none absolute -right-5 -top-5 text-foreground/[0.12] [&_svg]:lg:size-15! [&_svg]:xl:size-18!">
                <WeatherIcon
                  condition={overlay?.condition ?? null}
                  precipProb={overlay?.precipProb ?? null}
                  size={96}
                />
              </div>
            )}
          </div>

          <div className="flex w-full items-end justify-between gap-1">
            {info ? (
              <span
                className={cn(
                  "tabular-nums leading-none",
                  !info.available
                    ? "text-[10px] text-muted-foreground/40 line-through"
                    : isCheapest
                      ? "text-[15px] font-extrabold text-primary"
                      : "text-[12px] font-semibold text-foreground/80",
                )}
              >
                {dollars(info.priceCents)}
              </span>
            ) : (
              <span className="text-[10px] text-muted-foreground/25">—</span>
            )}

            <div className="flex shrink-0 items-center gap-1">
              {units && (
                <span
                  className={cn(
                    "shrink-0 rounded-full px-1.5 py-[3px] text-[9px] font-bold uppercase tracking-widest leading-none",
                    units.pill,
                  )}
                >
                  {units.label}
                </span>
              )}
              {crowd && (
                <span
                  className={cn(
                    "shrink-0 rounded-full px-1.5 py-[3px] text-[9px] font-bold uppercase tracking-widest leading-none",
                    crowd.pill,
                    overlay?.crowdIsEstimate && "opacity-60",
                  )}
                >
                  {crowd.label}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Crowd corner dot — mobile + tablet only (desktop shows the label pill).
            Color-only is fine: the detail sheet and legend carry the words. */}
        {crowd && (
          <span
            className={cn(
              "absolute right-1 top-1 size-[6px] rounded-full lg:hidden",
              crowd.bg,
              overlay?.crowdIsEstimate ? "opacity-50" : "opacity-90",
            )}
          />
        )}

        {/* Crowd accent bar — visible at all breakpoints */}
        {crowd && (
          <span
            className={cn(
              "absolute bottom-0 left-0 right-0 h-[3px]",
              crowd.bg,
              overlay?.crowdIsEstimate ? "opacity-20" : "opacity-45",
            )}
          />
        )}

        {/* Scarcity top accent bar — mobile + tablet only (desktop shows the "N
            left" pill); only for the urgent tiers so plentiful dates stay calm.
            The exact count lives in the day-detail sheet. */}
        {units && (info?.scarcity === "selling_out" || info?.scarcity === "low") && (
          <span
            className={cn(
              "absolute left-0 right-0 top-0 h-[3px] opacity-70 lg:hidden",
              info.scarcity === "selling_out" ? "bg-red-500" : "bg-amber-400",
            )}
          />
        )}
      </Button>
    </AnimateIcon>
  );
}

export interface PricingData {
  rows:
    | Array<{
        date: string;
        priceCents: number;
        available: boolean;
        availableUnits: number | null;
        scarcity: ScarcityTier | null;
      }>
    | undefined;
  productLabel: string;
  lastUpdatedAt: string | null;
  isLoading: boolean;
  priceMap: Map<string, DayPrice>;
  overlayMap: Map<string, DayOverlay>;
  stats: { min: number; max: number; cheapest: { date: string; priceCents: number } } | null;
  hasOverlay: boolean;
  /** ISO dates blocked for the selection's Annual Passholders (WDW only). */
  blockedDates: Set<string>;
  today: Date;
  startDate: Date;
  endDate: Date;
}

/**
 * Loads and derives everything a pricing calendar needs for one (resort, park,
 * ticket-type, age) selection: the per-day price map, the crowd/weather/hours
 * overlay map, and summary stats. Shared by the desktop page and the mobile
 * calendar drawer; React Query dedupes the underlying requests when both mount.
 */
export function usePricingData({
  resort,
  park,
  parkHopper,
  ageGroup,
  enabled = true,
}: {
  resort: Resort;
  park: string | null;
  parkHopper: boolean;
  ageGroup: AgeGroup;
  enabled?: boolean;
}): PricingData {
  const trpc = useTRPC();

  const calQ = useQuery({
    ...trpc.tickets.priceCalendar.queryOptions({
      resort,
      days: DAYS,
      pastDays: PAST_DAYS,
      parkHopper,
      ageGroup,
      park,
    }),
    enabled,
  });
  const rows = calQ.data?.days;
  const productLabel = calQ.data?.productLabel ?? "Ticket";
  const lastUpdatedAt = calQ.data?.lastUpdatedAt ?? null;

  const priceMap = React.useMemo(() => {
    const m = new Map<string, DayPrice>();
    for (const r of rows ?? [])
      m.set(r.date, {
        priceCents: r.priceCents,
        available: r.available,
        availableUnits: r.availableUnits,
        scarcity: r.scarcity,
      });
    return m;
  }, [rows]);

  const { today, startDate, endDate, startIso, endIso } = React.useMemo(() => {
    const t = new Date();
    t.setHours(0, 0, 0, 0);
    const s = new Date(t);
    s.setDate(s.getDate() - PAST_DAYS);
    const e = new Date(t);
    e.setDate(e.getDate() + DAYS);
    return { today: t, startDate: s, endDate: e, startIso: localIso(s), endIso: localIso(e) };
  }, []);

  const stats = React.useMemo(() => {
    if (!rows || rows.length === 0) return null;
    const todayIso = localIso(today);
    const future = rows.filter((r) => r.date >= todayIso);
    if (future.length === 0) return null;
    const prices = future.map((r) => r.priceCents);
    const min = Math.min(...prices);
    const max = Math.max(...prices);
    const cheapest = future.find((r) => r.priceCents === min) ?? null;
    return cheapest ? { min, max, cheapest } : null;
  }, [rows, today]);

  // Derive the park slug for crowd/weather: use the selected park's slug,
  // or fall back to the resort's primary park when "All" is selected.
  const parkSlug = React.useMemo(() => {
    const parks = resort === "WDW" ? WDW_PARKS : UOR_PARKS;
    if (park) return parks.find((p) => p.code === park)?.slug ?? null;
    return RESORT_DEFAULT_SLUG[resort] ?? null;
  }, [park, resort]);

  const overlayQ = useQuery({
    ...trpc.forecast.parkCalendar.queryOptions({
      parkSlug: parkSlug ?? "",
      startDate: startIso,
      endDate: endIso,
    }),
    enabled: enabled && !!parkSlug,
  });

  const hoursQ = useQuery({
    ...trpc.parks.hours.queryOptions({
      parkSlug: parkSlug ?? "",
      startDate: startIso,
      endDate: endIso,
    }),
    enabled: enabled && !!parkSlug,
  });

  // Annual Pass blockouts (WDW only) — marked on the calendar and the Today card.
  // Scope to the selected park's blocked dates; for "All parks", any WDW park
  // being blocked marks the date.
  const blockoutQ = useQuery({
    ...trpc.tickets.passholderBlockouts.queryOptions({ days: DAYS }),
    enabled: enabled && resort === "WDW",
  });
  const blockedDates = React.useMemo(() => {
    const set = new Set<string>();
    const selectedSlug = park ? (WDW_PARKS.find((p) => p.code === park)?.slug ?? null) : null;
    for (const d of blockoutQ.data?.days ?? []) {
      if (selectedSlug == null || d.blocked.some((b) => b.slug === selectedSlug)) set.add(d.date);
    }
    return set;
  }, [blockoutQ.data, park]);

  const overlayMap = React.useMemo(() => {
    const m = new Map<string, DayOverlay>();
    const ensure = (date: string) => {
      let e = m.get(date);
      if (!e) {
        e = {
          crowdIndex: null,
          crowdIsEstimate: false,
          highF: null,
          precipProb: null,
          condition: null,
          hours: null,
        };
        m.set(date, e);
      }
      return e;
    };
    for (const d of overlayQ.data?.days ?? []) {
      const e = ensure(d.date);
      e.crowdIndex = d.crowdIndex;
      e.crowdIsEstimate = d.crowdIsEstimate;
      e.highF = d.weather?.highF ?? null;
      e.precipProb = d.weather?.precipProb ?? null;
      e.condition = d.weather?.condition ?? null;
    }
    const tz = hoursQ.data?.timezone ?? "America/New_York";
    for (const d of hoursQ.data?.days ?? []) {
      ensure(d.date).hours = formatHourRange(d.open, d.close, tz, true);
    }
    return m;
  }, [overlayQ.data, hoursQ.data]);

  return {
    rows,
    productLabel,
    lastUpdatedAt,
    isLoading: calQ.isLoading,
    priceMap,
    overlayMap,
    stats,
    hasOverlay: !!overlayQ.data,
    blockedDates,
    today,
    startDate,
    endDate,
  };
}

/**
 * The month calendar itself: loads its own data, publishes the cell maps to a
 * per-instance store for `PriceDayButton`, and owns the tap-a-day detail sheet.
 * Reusable — the desktop page renders one inline; the mobile shelf renders one
 * per park inside a drawer.
 */
export function PriceCalendarGrid({
  resort,
  park,
  parkHopper,
  ageGroup,
  enabled = true,
  focusDate,
}: {
  resort: Resort;
  park: string | null;
  parkHopper: boolean;
  ageGroup: AgeGroup;
  enabled?: boolean;
  /** ISO date to open the calendar on and highlight (e.g. the cheapest day). */
  focusDate?: string;
}) {
  const [store] = React.useState(newCalendarStore);
  const [month, setMonth] = React.useState(() =>
    focusDate ? new Date(`${focusDate}T00:00:00`) : new Date(),
  );
  // ISO date of the tapped day, driving the detail bottom sheet; null = closed.
  const [selectedDay, setSelectedDay] = React.useState<string | null>(null);
  const data = usePricingData({ resort, park, parkHopper, ageGroup, enabled });

  React.useEffect(() => {
    store.setState(() => ({
      priceMap: data.priceMap,
      min: data.stats?.min,
      overlayMap: data.overlayMap,
      blockedDates: data.blockedDates,
    }));
  }, [store, data.priceMap, data.stats?.min, data.overlayMap, data.blockedDates]);

  return (
    <CalendarStoreContext.Provider value={store}>
      {data.isLoading ? (
        <Skeleton className="h-[460px] w-full sm:h-[560px] lg:h-[620px]" />
      ) : !data.rows || data.rows.length === 0 ? (
        <Empty className="h-[360px]">
          <EmptyTitle>No pricing captured</EmptyTitle>
          <EmptyDescription>
            The ticket cron hasn&rsquo;t recorded {data.productLabel.toLowerCase()} prices for this
            park yet.
          </EmptyDescription>
        </Empty>
      ) : (
        <Calendar
          month={month}
          onMonthChange={setMonth}
          startMonth={data.startDate}
          endMonth={data.endDate}
          disabled={{ before: data.startDate, after: data.endDate }}
          modifiers={{
            past: { before: data.today },
            ...(focusDate ? { focused: new Date(`${focusDate}T00:00:00`) } : {}),
          }}
          modifiersClassNames={{
            past: "opacity-60",
            focused: "rounded-(--cell-radius) ring-2 ring-primary ring-inset",
          }}
          showOutsideDays
          className="w-full"
          classNames={{ day: DAY_CELL_CLASS, week: "mt-2 flex w-full gap-1" }}
          components={{ DayButton: PriceDayButton }}
          onDayClick={(day) => setSelectedDay(localIso(day))}
        />
      )}

      <DayDetailSheet
        iso={selectedDay}
        onClose={() => setSelectedDay(null)}
        priceMap={data.priceMap}
        overlayMap={data.overlayMap}
        blockedDates={data.blockedDates}
        min={data.stats?.min}
        productLabel={data.productLabel}
      />
    </CalendarStoreContext.Provider>
  );
}

/**
 * Bottom sheet shown on tapping a calendar day — the cell is a summary; this
 * carries the full date, price context, hours, weather, and an explained crowd
 * level. Reads the maps the calendar already built, so it's pure presentation.
 */
function DayDetailSheet({
  iso,
  onClose,
  priceMap,
  overlayMap,
  blockedDates,
  min,
  productLabel,
}: {
  iso: string | null;
  onClose: () => void;
  priceMap: Map<string, DayPrice>;
  overlayMap: Map<string, DayOverlay>;
  blockedDates: Set<string>;
  min: number | undefined;
  productLabel: string;
}) {
  const info = iso ? priceMap.get(iso) : undefined;
  const overlay = iso ? overlayMap.get(iso) : undefined;
  const crowd = overlay?.crowdIndex != null ? crowdConfig(overlay.crowdIndex) : null;
  const precip = formatPrecip(overlay?.precipProb ?? null);
  const isCheapest = info != null && min != null && info.priceCents === min;
  const deltaCents = info != null && min != null ? info.priceCents - min : null;
  const units = info?.available ? unitsLeftChip(info.availableUnits) : null;
  const apBlocked = iso != null && blockedDates.has(iso);

  const fullDate = iso
    ? new Date(`${iso}T00:00:00`).toLocaleDateString("en-US", {
        weekday: "long",
        month: "long",
        day: "numeric",
      })
    : "";

  return (
    <Drawer open={iso != null} onOpenChange={(o) => !o && onClose()}>
      <DrawerContent>
        <DrawerHeader className="border-b pb-4 text-left">
          <DrawerTitle>{fullDate}</DrawerTitle>
          <DrawerDescription>
            {productLabel} price, hours, weather, and crowd forecast for this day.
          </DrawerDescription>
        </DrawerHeader>

        <div className="flex flex-col gap-5 px-4 pb-2 pt-5">
          {/* Price */}
          <div className="flex flex-col gap-1">
            {info ? (
              <>
                <span
                  className={cn(
                    "text-3xl font-semibold tabular-nums",
                    !info.available
                      ? "text-muted-foreground/50 line-through"
                      : isCheapest
                        ? "text-primary"
                        : "text-foreground",
                  )}
                >
                  {dollars(info.priceCents)}
                </span>
                <span className="text-sm text-muted-foreground">
                  {!info.available
                    ? "Sold out for this day"
                    : isCheapest
                      ? "Cheapest day in the window"
                      : deltaCents != null && deltaCents > 0
                        ? `${dollars(deltaCents)} above the cheapest day`
                        : `${productLabel} price`}
                </span>
              </>
            ) : (
              <span className="text-sm text-muted-foreground">
                No pricing captured for this day.
              </span>
            )}
            {units && (
              <span
                className={cn(
                  "mt-1 w-fit rounded-full px-2.5 py-1 text-xs font-bold uppercase tracking-widest leading-none",
                  units.pill,
                )}
              >
                {units.label} · Express
              </span>
            )}
            {apBlocked && (
              <span className="mt-1 w-fit rounded-full bg-red-100 px-2.5 py-1 text-xs font-bold uppercase tracking-widest leading-none text-red-600 dark:bg-red-900/50 dark:text-red-300">
                Annual Pass blocked
              </span>
            )}
          </div>

          {/* Hours + weather */}
          <div className="flex flex-wrap gap-x-8 gap-y-3">
            {overlay?.hours && (
              <div className="flex flex-col gap-0.5">
                <span className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
                  Park hours
                </span>
                <span className="text-sm font-semibold tabular-nums">{overlay.hours}</span>
              </div>
            )}
            {overlay?.highF != null && (
              <div className="flex flex-col gap-0.5">
                <span className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
                  Weather
                </span>
                <span className="flex items-center gap-1.5 text-sm font-semibold tabular-nums">
                  <WeatherIcon
                    condition={overlay.condition}
                    precipProb={overlay.precipProb}
                    size={16}
                  />
                  {overlay.highF}°F
                  {precip && (
                    <span className="font-medium text-sky-500 dark:text-sky-400">
                      {precip} rain
                    </span>
                  )}
                </span>
              </div>
            )}
          </div>

          {/* Crowd, with a plain-language explanation of the scale */}
          {crowd && (
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center gap-2">
                <span
                  className={cn(
                    "rounded-full px-2.5 py-1 text-xs font-bold uppercase tracking-widest leading-none",
                    crowd.pill,
                  )}
                >
                  {crowd.label}
                </span>
                {overlay?.crowdIndex != null && (
                  <span className="text-sm font-semibold tabular-nums text-muted-foreground">
                    {overlay.crowdIndex}/10
                  </span>
                )}
                {overlay?.crowdIsEstimate && (
                  <span className="text-xs text-muted-foreground">estimate</span>
                )}
              </div>
              <span className="text-xs text-muted-foreground">
                Crowd forecast, 1–10 scale — 8+ means peak-holiday level waits.
              </span>
            </div>
          )}
        </div>

        <DrawerFooter>
          <DrawerClose asChild>
            <Button variant="outline" className="rounded-full">
              Close
            </Button>
          </DrawerClose>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}
