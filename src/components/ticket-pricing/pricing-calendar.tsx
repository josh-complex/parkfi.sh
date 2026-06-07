"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import type { DayButton } from "react-day-picker";

import { Button } from "#/components/ui/button.tsx";
import { Calendar } from "#/components/ui/calendar.tsx";
import { Card, CardDescription, CardHeader, CardTitle } from "#/components/ui/card.tsx";
import { Empty, EmptyDescription, EmptyTitle } from "#/components/ui/empty.tsx";
import { Skeleton } from "#/components/ui/skeleton.tsx";
import { ToggleGroup, ToggleGroupItem } from "#/components/ui/toggle-group.tsx";
import { useTRPC } from "#/integrations/trpc/react.ts";
import { UOR_PARKS, WDW_PARKS } from "#/lib/parks.ts";
import { cn } from "#/lib/utils.ts";

type Resort = "WDW" | "UOR";
type AgeGroup = "ADULT" | "CHILD";

const RESORTS: Array<{ value: Resort; label: string }> = [
  { value: "WDW", label: "Walt Disney World" },
  { value: "UOR", label: "Universal Orlando" },
];

const DAYS = 150;

interface DayPrice {
  priceCents: number;
  available: boolean;
}

function localIso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
}

function dollars(cents: number): string {
  return `$${Math.round(cents / 100)}`;
}

// Day cell classNames override — removes aspect-square so cells use a fixed
// height rather than growing as tall as they are wide in a full-width calendar.
const DAY_CELL_CLASS =
  "group/day relative h-16 w-full rounded-(--cell-radius) p-0 text-center select-none " +
  "[&:last-child[data-selected=true]_button]:rounded-r-(--cell-radius) " +
  "[&:first-child[data-selected=true]_button]:rounded-l-(--cell-radius)";

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
      parkHopper,
      ageGroup,
      park,
    }),
  );
  const rows = calQ.data?.days;
  const productLabel = calQ.data?.productLabel ?? "Ticket";

  const priceMap = React.useMemo(() => {
    const m = new Map<string, DayPrice>();
    for (const r of rows ?? []) m.set(r.date, { priceCents: r.priceCents, available: r.available });
    return m;
  }, [rows]);

  const stats = React.useMemo(() => {
    if (!rows || rows.length === 0) return null;
    const prices = rows.map((r) => r.priceCents);
    const min = Math.min(...prices);
    const max = Math.max(...prices);
    const cheapest = rows.find((r) => r.priceCents === min);
    return { min, max, cheapest };
  }, [rows]);

  const { today, endDate } = React.useMemo(() => {
    const t = new Date();
    t.setHours(0, 0, 0, 0);
    const e = new Date(t);
    e.setDate(e.getDate() + DAYS);
    return { today: t, endDate: e };
  }, []);

  const PriceDay = React.useMemo(() => {
    const min = stats?.min;
    return function PriceDayButton({
      className,
      day,
      modifiers,
      children: _children,
      ...props
    }: React.ComponentProps<typeof DayButton>) {
      const info = priceMap.get(localIso(day.date));
      const isCheapest = info != null && min != null && info.priceCents === min;
      return (
        <Button
          variant="ghost"
          className={cn(
            "flex h-full w-full flex-col items-center justify-center gap-0.5 p-0 leading-none font-normal",
            modifiers.outside && "opacity-40",
            className,
          )}
          {...props}
        >
          <span className="text-xs">{day.date.getDate()}</span>
          {info ? (
            <span
              className={cn(
                "text-[10px] tabular-nums",
                !info.available && "text-muted-foreground line-through",
                isCheapest && info.available
                  ? "font-semibold text-primary"
                  : "text-muted-foreground",
              )}
            >
              {dollars(info.priceCents)}
            </span>
          ) : (
            <span className="text-[10px]">·</span>
          )}
        </Button>
      );
    };
  }, [priceMap, stats?.min]);

  return (
    <div className="flex flex-col gap-4 py-4 md:gap-6 md:py-6">
      <div className="flex flex-col gap-2 px-4 sm:flex-row sm:items-end sm:justify-between lg:px-6">
        <div className="flex flex-col gap-1">
          <h2 className="text-xl font-semibold tracking-tight">Ticket Pricing</h2>
          <p className="text-muted-foreground text-sm">
            Cheapest {productLabel.toLowerCase()} by date — find the cheapest day to go.
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
            <CardDescription>
              {productLabel} · cheapest dates in <span className="text-primary">color</span>,
              sold-out struck through
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
                startMonth={today}
                endMonth={endDate}
                disabled={{ before: today, after: endDate }}
                showOutsideDays
                className="w-full"
                classNames={{ day: DAY_CELL_CLASS }}
                components={{ DayButton: PriceDay }}
              />
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}
