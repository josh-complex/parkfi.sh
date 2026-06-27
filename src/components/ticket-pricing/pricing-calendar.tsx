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

import { Calendar } from "#/components/ui/calendar.tsx";
import { Card, CardDescription, CardHeader, CardTitle } from "#/components/ui/card.tsx";
import { Empty, EmptyDescription, EmptyTitle } from "#/components/ui/empty.tsx";
import { Skeleton } from "#/components/ui/skeleton.tsx";
import {
  CoreSearchOption,
  CoreSearchSegment,
  useCloseOnScroll,
  type SegPos,
} from "#/components/core-search.tsx";
import { useTRPC } from "#/integrations/trpc/react.ts";
import { formatHourRange } from "#/lib/park-hours.ts";
import { RESORT_DEFAULT_SLUG, UOR_PARKS, WDW_PARKS } from "#/lib/parks.ts";
import { cn } from "#/lib/utils.ts";
import { Button } from "../ui/button";

type Resort = "WDW" | "UOR";
type AgeGroup = "ADULT" | "CHILD";

const RESORTS: Array<{ value: Resort; label: string }> = [
  { value: "WDW", label: "Walt Disney World" },
  { value: "UOR", label: "Universal Orlando" },
];

const DAYS = 150;
const PAST_DAYS = 90;

interface DayPrice {
  priceCents: number;
  available: boolean;
}

interface DayOverlay {
  crowdIndex: number | null;
  crowdIsEstimate: boolean;
  highF: number | null;
  precipProb: number | null;
  condition: string | null;
  /** Compact operating-hours range for the day, e.g. "9a–11p"; null when closed/unknown. */
  hours: string | null;
}

function localIso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
}

function dollars(cents: number): string {
  return `$${Math.round(cents / 100)}`;
}

interface CrowdConfig {
  bg: string;
  pill: string;
  label: string;
}

function crowdConfig(index: number): CrowdConfig {
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

function WeatherIcon({
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

function formatPrecip(precipProb: number | null): string | null {
  if (precipProb == null) return null;
  // Normalize: stored as 0-100 or 0-1
  const pct = precipProb > 1 ? Math.round(precipProb) : Math.round(precipProb * 100);
  return pct >= 20 ? `${pct}%` : null;
}

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

// Day cell classNames override — removes aspect-square so cells use a fixed
// height rather than growing as tall as they are wide in a full-width calendar.
const DAY_CELL_CLASS =
  "group/day relative h-[72px] sm:h-[90px] lg:h-[100px] w-full rounded-(--cell-radius) p-0 text-center select-none " +
  "[&:last-child[data-selected=true]_button]:rounded-r-(--cell-radius) " +
  "[&:first-child[data-selected=true]_button]:rounded-l-(--cell-radius)";

interface CalendarState {
  priceMap: Map<string, DayPrice>;
  min: number | undefined;
  overlayMap: Map<string, DayOverlay>;
}

const calendarStore = new Store<CalendarState>({
  priceMap: new Map(),
  min: undefined,
  overlayMap: new Map(),
});

// Defined at module level so the component type is stable across renders.
function PriceDayButton({
  className,
  day,
  modifiers,
  ...props
}: React.ComponentProps<typeof DayButton>) {
  const priceMap = useSelector(calendarStore, (s) => s.priceMap);
  const min = useSelector(calendarStore, (s) => s.min);
  const overlayMap = useSelector(calendarStore, (s) => s.overlayMap);
  const iso = localIso(day.date);
  const info = priceMap.get(iso);
  const overlay = overlayMap.get(iso);
  const isCheapest = info != null && min != null && info.priceCents === min;
  const crowd = overlay?.crowdIndex != null ? crowdConfig(overlay.crowdIndex) : null;
  const precip = formatPrecip(overlay?.precipProb ?? null);

  return (
    <AnimateIcon animateOnHover asChild>
      <Button
        variant="outlineCal"
        className={cn(
          "relative flex h-full w-full overflow-hidden p-0 font-normal",
          modifiers.outside && "opacity-40",
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
                  ? "text-[9px] text-muted-foreground/40 line-through"
                  : isCheapest
                    ? "text-[12px] font-extrabold text-primary"
                    : "text-[10px] font-semibold text-foreground/75",
              )}
            >
              {dollars(info.priceCents)}
            </span>
          ) : (
            <span className="text-[9px] text-muted-foreground/25">—</span>
          )}
        </div>

        {/* ── TABLET (sm–lg): centered stack with all data ── */}
        <div className="hidden h-full w-full flex-col items-center justify-between p-2 pb-3 sm:flex lg:hidden">
          <div className="flex flex-col items-center gap-[2px]">
            <span className="text-[15px] font-bold tabular-nums leading-none">
              {day.date.getDate()}
            </span>
            <span className="text-[7px] font-medium uppercase tracking-widest text-muted-foreground/55 leading-none">
              {DOW[day.date.getDay()]}
            </span>
            {overlay?.hours && (
              <span className="text-[8px] font-semibold tabular-nums leading-none text-foreground/65">
                {overlay.hours}
              </span>
            )}
          </div>

          {overlay?.highF != null ? (
            <span className="text-[10px] tabular-nums text-muted-foreground/80 leading-none">
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
                    ? "text-[14px] font-extrabold text-primary"
                    : "text-[11px] font-semibold text-foreground/80",
              )}
            >
              {dollars(info.priceCents)}
            </span>
          ) : (
            <span className="text-[9px] text-muted-foreground/25">—</span>
          )}

          {crowd ? (
            <span
              className={cn(
                "shrink-0 rounded-full px-1.5 py-[2px] text-[6px] font-bold uppercase tracking-widest leading-none",
                crowd.pill,
                overlay?.crowdIsEstimate && "opacity-60",
              )}
            >
              {crowd.label}
            </span>
          ) : (
            <span className="h-[14px]" />
          )}
        </div>

        {/* ── DESKTOP (lg+): date+dow left / overflowing icon bg / price+pill bottom ── */}
        <div className="hidden h-full w-full flex-col justify-between p-2.5 lg:flex">
          <div className="relative flex w-full items-start justify-between">
            <div className="flex flex-col gap-0.75">
              <span className="text-[18px] font-bold tabular-nums leading-none">
                {day.date.getDate()}
              </span>
              <span className="text-[8px] font-medium uppercase tracking-widest text-muted-foreground/60 leading-none">
                {DOW[day.date.getDay()]}
              </span>
              {overlay?.hours && (
                <span className="text-[9px] font-semibold tabular-nums leading-none text-foreground/65">
                  {overlay.hours}
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

            {crowd && (
              <span
                className={cn(
                  "shrink-0 rounded-full px-1.5 py-[3px] text-[7px] font-bold uppercase tracking-widest leading-none",
                  crowd.pill,
                  overlay?.crowdIsEstimate && "opacity-60",
                )}
              >
                {crowd.label}
              </span>
            )}
          </div>
        </div>

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
      </Button>
    </AnimateIcon>
  );
}

export function PricingCalendar() {
  const trpc = useTRPC();
  const [resort, setResort] = React.useState<Resort>("WDW");
  const [month, setMonth] = React.useState(() => new Date());
  const [parkHopper, setParkHopper] = React.useState(false);
  const [ageGroup, setAgeGroup] = React.useState<AgeGroup>("ADULT");
  const [park, setPark] = React.useState<string | null>(null);
  const [openSeg, setOpenSeg] = React.useState<string | null>(null);

  useCloseOnScroll(openSeg !== null, () => setOpenSeg(null));

  // Picking a park also sets its resort (the resort segment is gone — resort is
  // inferred from the chosen park). A null code = that resort's "All parks".
  const selectPark = (nextResort: Resort, code: string | null) => {
    setResort(nextResort);
    setPark(code);
    setOpenSeg(null);
  };

  const parks = resort === "WDW" ? WDW_PARKS : UOR_PARKS;
  const resortLabel = RESORTS.find((r) => r.value === resort)?.label ?? "";

  // Build the visible segment list so pill positions (rounded ends, shared
  // borders) stay correct as the ticket-type field appears only for WDW.
  const segKeys = resort === "WDW" ? ["park", "type", "age"] : ["park", "age"];
  const posOf = (key: string): SegPos =>
    segKeys[0] === key ? "first" : segKeys[segKeys.length - 1] === key ? "last" : "middle";
  const parkLabel = park
    ? (parks.find((p) => p.code === park)?.label ?? "All parks")
    : `All ${resortLabel} parks`;

  // Default to the busiest park today; applied once, and only if the user
  // hasn't already touched the picker (a specific park is selected on mount).
  const busiestQ = useQuery(trpc.forecast.busiestPark.queryOptions({}));
  const appliedDefault = React.useRef(false);
  React.useEffect(() => {
    if (appliedDefault.current || park) return;
    const b = busiestQ.data;
    if (!b) return;
    appliedDefault.current = true;
    setResort(b.resort);
    setPark(b.code);
  }, [busiestQ.data, park]);

  const calQ = useQuery(
    trpc.tickets.priceCalendar.queryOptions({
      resort,
      days: DAYS,
      pastDays: PAST_DAYS,
      parkHopper,
      ageGroup,
      park,
    }),
  );
  const rows = calQ.data?.days;
  const productLabel = calQ.data?.productLabel ?? "Ticket";
  const lastUpdatedAt = calQ.data?.lastUpdatedAt ?? null;

  const priceMap = React.useMemo(() => {
    const m = new Map<string, DayPrice>();
    for (const r of rows ?? []) m.set(r.date, { priceCents: r.priceCents, available: r.available });
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
    const cheapest = future.find((r) => r.priceCents === min);
    return { min, max, cheapest };
  }, [rows, today]);

  // Derive the park slug for crowd/weather: use the selected park's slug,
  // or fall back to the resort's primary park when "All" is selected.
  const parkSlug = React.useMemo(() => {
    if (park) {
      const entry = parks.find((p) => p.code === park);
      return entry?.slug ?? null;
    }
    return RESORT_DEFAULT_SLUG[resort] ?? null;
  }, [park, parks, resort]);

  const overlayQ = useQuery({
    ...trpc.forecast.parkCalendar.queryOptions({
      parkSlug: parkSlug ?? "",
      startDate: startIso,
      endDate: endIso,
    }),
    enabled: !!parkSlug,
  });

  const hoursQ = useQuery({
    ...trpc.parks.hours.queryOptions({
      parkSlug: parkSlug ?? "",
      startDate: startIso,
      endDate: endIso,
    }),
    enabled: !!parkSlug,
  });

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

  React.useEffect(() => {
    calendarStore.setState(() => ({ priceMap, min: stats?.min, overlayMap }));
  }, [priceMap, stats?.min, overlayMap]);

  return (
    <div className="flex flex-col gap-4 py-4 md:gap-6 md:py-6">
      <div className="flex flex-col gap-1 px-4 lg:px-6">
        <h2 className="text-xl font-semibold tracking-tight">Ticket Pricing</h2>
        <p className="text-muted-foreground text-sm">
          Cheapest {productLabel.toLowerCase()} by date — find the cheapest day to go.
          {lastUpdatedAt && (
            <span className="ml-2 text-xs">
              Updated{" "}
              {(() => {
                const diff = Date.now() - new Date(lastUpdatedAt).getTime();
                const min = Math.floor(diff / 60_000);
                if (min < 1) return "just now";
                if (min < 60) return `${min}m ago`;
                return `${Math.floor(min / 60)}h ago`;
              })()}
            </span>
          )}
        </p>
      </div>

      {/* Core-search bar — park (resort inferred) + (WDW) ticket type + age */}
      <div className="-mx-1 min-w-0 overflow-x-auto overflow-y-clip px-5 py-1 lg:px-7">
        <div className="flex w-max items-stretch">
          <CoreSearchSegment
            pos={posOf("park")}
            label="Park"
            value={parkLabel}
            muted={!park}
            open={openSeg === "park"}
            onOpenChange={(o) => setOpenSeg(o ? "park" : null)}
            align="start"
            contentClassName="w-72"
          >
            {RESORTS.map((r) => {
              const groupParks = r.value === "WDW" ? WDW_PARKS : UOR_PARKS;
              return (
                <div key={r.value} className="not-first:mt-1">
                  <p className="text-muted-foreground px-3 pt-2 pb-1 text-xs font-medium">
                    {r.label}
                  </p>
                  <CoreSearchOption
                    label={`All ${r.label} parks`}
                    selected={resort === r.value && !park}
                    onSelect={() => selectPark(r.value, null)}
                  />
                  {groupParks.map((p) => (
                    <CoreSearchOption
                      key={p.code}
                      label={p.label}
                      selected={resort === r.value && park === p.code}
                      onSelect={() => selectPark(r.value, p.code)}
                    />
                  ))}
                </div>
              );
            })}
          </CoreSearchSegment>

          {resort === "WDW" && (
            <CoreSearchSegment
              pos={posOf("type")}
              label="Ticket type"
              value={parkHopper ? "Park Hopper" : "Standard"}
              muted={false}
              open={openSeg === "type"}
              onOpenChange={(o) => setOpenSeg(o ? "type" : null)}
              align="center"
            >
              <CoreSearchOption
                label="Standard"
                selected={!parkHopper}
                onSelect={() => {
                  setParkHopper(false);
                  setOpenSeg(null);
                }}
              />
              <CoreSearchOption
                label="Park Hopper"
                selected={parkHopper}
                onSelect={() => {
                  setParkHopper(true);
                  setOpenSeg(null);
                }}
              />
            </CoreSearchSegment>
          )}

          <CoreSearchSegment
            pos={posOf("age")}
            label="Age"
            value={ageGroup === "ADULT" ? "Adult" : "Child"}
            muted={false}
            open={openSeg === "age"}
            onOpenChange={(o) => setOpenSeg(o ? "age" : null)}
            align="end"
          >
            <CoreSearchOption
              label="Adult"
              selected={ageGroup === "ADULT"}
              onSelect={() => {
                setAgeGroup("ADULT");
                setOpenSeg(null);
              }}
            />
            <CoreSearchOption
              label="Child"
              selected={ageGroup === "CHILD"}
              onSelect={() => {
                setAgeGroup("CHILD");
                setOpenSeg(null);
              }}
            />
          </CoreSearchSegment>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 px-4 *:data-[slot=card]:bg-linear-to-t *:data-[slot=card]:from-primary/5 *:data-[slot=card]:to-card *:data-[slot=card]:shadow-xs lg:px-6 @xl/main:grid-cols-3 dark:*:data-[slot=card]:bg-card">
        <Card className="@container/card">
          <CardHeader>
            <CardDescription>Cheapest day</CardDescription>
            <CardTitle className="text-2xl font-semibold tabular-nums">
              {stats ? dollars(stats.min) : "—"}
            </CardTitle>
            <CardDescription>
              {stats?.cheapest
                ? new Date(`${stats.cheapest.date}T00:00:00`).toLocaleDateString("en-US", {
                    weekday: "short",
                    month: "long",
                    day: "numeric",
                  })
                : "No pricing yet"}
            </CardDescription>
          </CardHeader>
        </Card>
        <Card className="@container/card">
          <CardHeader>
            <CardDescription>Price range</CardDescription>
            <CardTitle className="text-2xl font-semibold tabular-nums">
              {stats ? `${dollars(stats.min)}–${dollars(stats.max)}` : "—"}
            </CardTitle>
            <CardDescription>
              {productLabel} over the next {DAYS} days
            </CardDescription>
          </CardHeader>
        </Card>
        <Card className="@container/card">
          <CardHeader>
            <CardDescription>Today</CardDescription>
            <CardTitle className="text-2xl font-semibold tabular-nums">
              {priceMap.get(localIso(today))
                ? dollars(priceMap.get(localIso(today))!.priceCents)
                : "—"}
            </CardTitle>
            <CardDescription>{productLabel} for today</CardDescription>
          </CardHeader>
        </Card>
      </div>

      <div className="px-4 lg:px-6">
        <Card>
          <CardHeader>
            <CardTitle>{RESORTS.find((r) => r.value === resort)?.label}</CardTitle>
            <CardDescription className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span>
                {productLabel} · cheapest in <span className="text-primary">color</span>, sold-out
                struck through
              </span>
              {overlayQ.data && (
                <span className="flex flex-wrap items-center gap-1.5">
                  {([1, 4, 6, 8] as const).map((idx) => {
                    const cfg = crowdConfig(idx);
                    return (
                      <span
                        key={cfg.label}
                        className={cn(
                          "rounded-full px-2 py-[3px] text-[9px] font-semibold uppercase tracking-widest leading-none",
                          cfg.pill,
                        )}
                      >
                        {cfg.label}
                      </span>
                    );
                  })}
                </span>
              )}
            </CardDescription>
          </CardHeader>
          <div className="px-2 pb-4 sm:px-6">
            {calQ.isLoading ? (
              <Skeleton className="h-[360px] w-full" />
            ) : !rows || rows.length === 0 ? (
              <Empty className="h-[360px]">
                <EmptyTitle>No pricing captured</EmptyTitle>
                <EmptyDescription>
                  The ticket cron hasn't recorded {productLabel.toLowerCase()} prices for this
                  resort yet.
                </EmptyDescription>
              </Empty>
            ) : (
              <Calendar
                month={month}
                onMonthChange={setMonth}
                startMonth={startDate}
                endMonth={endDate}
                disabled={{ before: startDate, after: endDate }}
                modifiers={{ past: { before: today } }}
                modifiersClassNames={{ past: "opacity-60" }}
                showOutsideDays
                className="w-full"
                classNames={{ day: DAY_CELL_CLASS, week: "mt-2 flex w-full gap-1" }}
                components={{ DayButton: PriceDayButton }}
                onDayClick={() => {}}
              />
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}
