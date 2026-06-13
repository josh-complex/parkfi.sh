"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import type { DayButton } from "react-day-picker";
import { Cloud, CloudDrizzle, CloudLightning, CloudRain, CloudSnow, Sun } from "lucide-react";

import { Store, useSelector } from "@tanstack/react-store";

import { Calendar } from "#/components/ui/calendar.tsx";
import { Card, CardDescription, CardHeader, CardTitle } from "#/components/ui/card.tsx";
import { Empty, EmptyDescription, EmptyTitle } from "#/components/ui/empty.tsx";
import { Skeleton } from "#/components/ui/skeleton.tsx";
import { ToggleGroup, ToggleGroupItem } from "#/components/ui/toggle-group.tsx";
import { useTRPC } from "#/integrations/trpc/react.ts";
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
  highF: number | null;
  precipProb: number | null;
  condition: string | null;
}

function localIso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
}

function dollars(cents: number): string {
  return `$${Math.round(cents / 100)}`;
}

function crowdColor(index: number): string {
  if (index <= 3) return "bg-emerald-500";
  if (index <= 5) return "bg-yellow-400";
  if (index <= 7) return "bg-orange-400";
  return "bg-red-500";
}

function WeatherIcon({ condition, className }: { condition: string | null; className?: string }) {
  const c = condition?.toLowerCase() ?? "";
  const Icon = c.includes("thunder")
    ? CloudLightning
    : c.includes("snow")
      ? CloudSnow
      : c.includes("rain")
        ? CloudRain
        : c.includes("drizzle")
          ? CloudDrizzle
          : c.includes("cloud")
            ? Cloud
            : c.includes("clear")
              ? Sun
              : null;
  if (!Icon) return null;
  return <Icon className={cn("shrink-0", className)} />;
}

// Day cell classNames override — removes aspect-square so cells use a fixed
// height rather than growing as tall as they are wide in a full-width calendar.
const DAY_CELL_CLASS =
  "group/day relative h-16 w-full rounded-(--cell-radius) p-0 text-center select-none " +
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
  return (
    <Button
      variant="outlineCal"
      className={cn(
        "relative flex h-full w-full flex-col items-center justify-center gap-0.5 overflow-hidden p-0 leading-none font-normal",
        modifiers.outside && "opacity-40",
        className,
      )}
      {...props}
    >
      <span className="text-xs">{day.date.getDate()}</span>
      {overlay?.condition != null || overlay?.highF != null ? (
        <span className="flex items-center gap-0.5 text-muted-foreground">
          <WeatherIcon condition={overlay.condition} className="h-2.5 w-2.5" />
          {overlay.highF != null && (
            <span className="text-[9px] tabular-nums">{overlay.highF}°</span>
          )}
        </span>
      ) : null}
      {info ? (
        <span
          className={cn(
            "text-[10px] tabular-nums",
            !info.available && "text-muted-foreground line-through",
            isCheapest && info.available ? "font-semibold text-primary" : "text-muted-foreground",
          )}
        >
          {dollars(info.priceCents)}
        </span>
      ) : (
        <span className="text-[10px]">·</span>
      )}
      {overlay?.crowdIndex != null && (
        <span
          className={cn(
            "absolute bottom-0 left-0 h-0.5 w-full opacity-70",
            crowdColor(overlay.crowdIndex),
          )}
        />
      )}
    </Button>
  );
}

export function PricingCalendar() {
  const trpc = useTRPC();
  const [resort, setResort] = React.useState<Resort>("WDW");
  const [month, setMonth] = React.useState(() => new Date());
  const [parkHopper, setParkHopper] = React.useState(false);
  const [ageGroup, setAgeGroup] = React.useState<AgeGroup>("ADULT");
  const [park, setPark] = React.useState<string | null>(null);

  // Reset park when resort changes since park codes differ between resorts
  const onResortChange = (next: Resort) => {
    setResort(next);
    setPark(null);
  };

  const parks = resort === "WDW" ? WDW_PARKS : UOR_PARKS;

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

  const overlayMap = React.useMemo(() => {
    const m = new Map<string, DayOverlay>();
    for (const d of overlayQ.data?.days ?? []) {
      m.set(d.date, {
        crowdIndex: d.crowdIndex,
        highF: d.weather?.highF ?? null,
        precipProb: d.weather?.precipProb ?? null,
        condition: d.weather?.condition ?? null,
      });
    }
    return m;
  }, [overlayQ.data]);

  React.useEffect(() => {
    calendarStore.setState(() => ({ priceMap, min: stats?.min, overlayMap }));
  }, [priceMap, stats?.min, overlayMap]);

  return (
    <div className="flex flex-col gap-4 py-4 md:gap-6 md:py-6">
      <div className="flex flex-col gap-2 px-4 sm:flex-row sm:items-end sm:justify-between lg:px-6">
        <div className="flex flex-col gap-1">
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
        <ToggleGroup
          multiple={false}
          value={[resort]}
          onValueChange={(v) => onResortChange((v[0] as Resort) ?? "WDW")}
          variant="outline"
          className="*:data-[slot=toggle-group-item]:px-4!"
        >
          {RESORTS.map((r) => (
            <ToggleGroupItem key={r.value} value={r.value}>
              {r.label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>

      {/* Filters row — WDW gets ticket-type + age + park; UOR gets age + park */}
      <div className="flex flex-wrap gap-x-6 gap-y-3 px-4 lg:px-6">
        {resort === "WDW" && (
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground text-xs font-medium">Ticket type</span>
            <ToggleGroup
              multiple={false}
              value={[parkHopper ? "hopper" : "standard"]}
              onValueChange={(v) => setParkHopper(v[0] === "hopper")}
              variant="outline"
              size="sm"
            >
              <ToggleGroupItem value="standard">Standard</ToggleGroupItem>
              <ToggleGroupItem value="hopper">Park Hopper</ToggleGroupItem>
            </ToggleGroup>
          </div>
        )}
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground text-xs font-medium">Age</span>
          <ToggleGroup
            multiple={false}
            value={[ageGroup]}
            onValueChange={(v) => setAgeGroup((v[0] as AgeGroup) ?? "ADULT")}
            variant="outline"
            size="sm"
          >
            <ToggleGroupItem value="ADULT">Adult</ToggleGroupItem>
            <ToggleGroupItem value="CHILD">Child</ToggleGroupItem>
          </ToggleGroup>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground text-xs font-medium">Park</span>
          <ToggleGroup
            multiple={false}
            value={[park ?? "ALL"]}
            onValueChange={(v) => setPark(v[0] === "ALL" ? null : (v[0] ?? null))}
            variant="outline"
            size="sm"
          >
            <ToggleGroupItem value="ALL">All</ToggleGroupItem>
            {parks.map((p) => (
              <ToggleGroupItem key={p.code} value={p.code}>
                {p.label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
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
                <span className="flex items-center gap-2 text-xs">
                  <span className="flex items-center gap-1">
                    <span className="inline-block h-1.5 w-4 rounded-full bg-emerald-500 opacity-70" />
                    Low
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="inline-block h-1.5 w-4 rounded-full bg-yellow-400 opacity-70" />
                    Moderate
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="inline-block h-1.5 w-4 rounded-full bg-orange-400 opacity-70" />
                    Busy
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="inline-block h-1.5 w-4 rounded-full bg-red-500 opacity-70" />
                    Packed
                  </span>
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
                classNames={{ day: DAY_CELL_CLASS }}
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
