"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { motion } from "motion/react";
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";
import { XIcon } from "lucide-react";

import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "#/components/ui/card.tsx";
import { Button } from "#/components/ui/button.tsx";
import { Drawer, DrawerContent, DrawerDescription, DrawerTitle } from "#/components/ui/drawer.tsx";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "#/components/ui/chart.tsx";
import { ConstructionIcon, ConstructionState } from "#/components/ui/anim-icons/construction.tsx";
import { Empty, EmptyDescription, EmptyTitle } from "#/components/ui/empty.tsx";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "#/components/ui/select.tsx";
import { Skeleton } from "#/components/ui/skeleton.tsx";
import { ToggleGroup, ToggleGroupItem } from "#/components/ui/toggle-group.tsx";
import { useTRPC } from "#/integrations/trpc/react.ts";
import { cn } from "#/lib/utils.ts";

import { isUniversal, paidLineProduct } from "./lightning-lane.ts";
import { rideColor } from "./ride-colors.ts";

function getQueueOptions(operatorSlug?: string | null) {
  const paidLabel = paidLineProduct(operatorSlug);
  return [
    { value: "1", label: "Standby wait", mode: "wait" as const },
    isUniversal(operatorSlug)
      ? { value: "3", label: paidLabel, mode: "wait" as const }
      : { value: "4", label: paidLabel, mode: "price" as const },
  ];
}

const RANGE_HOURS: Record<string, number> = { "24h": 24, "7d": 168, "30d": 720 };

/** How many of the busiest rides light up by default, alongside the park lines. */
const DEFAULT_SERIES = 3;

// Reserved series key for the whole-park average line.
const AVG_KEY = "__avg";

/**
 * The ride-series toggle list. Rendered inline beside the chart at `@[640px]/card`
 * and up; on narrower cards it moves into a Sheet behind a "Rides (n)" button so
 * the plot keeps full width. Both surfaces share this list.
 */
function RideLegend({
  rides,
  enabled,
  colorOf,
  toggle,
  toggleAll,
  allEnabled,
  onClose,
}: {
  rides: Array<{ id: number; name: string }>;
  enabled: Set<number>;
  colorOf: (id: number) => string;
  toggle: (id: number) => void;
  toggleAll: () => void;
  allEnabled: boolean;
  /** When provided (the drawer), renders a close control in the header. */
  onClose?: () => void;
}) {
  return (
    <>
      <div className="text-muted-foreground sticky top-0 z-10 flex items-center justify-between gap-2 bg-card/95 px-3 py-2 text-xs font-medium supports-backdrop-filter:backdrop-blur">
        <span>Rides ({rides.length})</span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={toggleAll}
            aria-pressed={allEnabled}
            className="text-primary rounded px-1 py-0.5 font-medium transition-colors hover:underline"
          >
            {allEnabled ? "Clear all" : "Select all"}
          </button>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="inline-flex size-7 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <XIcon className="size-4" />
            </button>
          )}
        </div>
      </div>
      <div className="flex flex-col gap-0.5 p-1">
        {rides.map((r) => {
          const on = enabled.has(r.id);
          return (
            <button
              key={r.id}
              type="button"
              onClick={() => toggle(r.id)}
              aria-pressed={on}
              title={r.name}
              className={cn(
                "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors hover:bg-muted/50",
                on ? "text-foreground" : "text-muted-foreground",
              )}
            >
              <span
                className="size-2.5 shrink-0 rounded-[3px]"
                style={{ backgroundColor: colorOf(r.id), opacity: on ? 1 : 0.35 }}
              />
              <span className="truncate">{r.name}</span>
            </button>
          );
        })}
      </div>
    </>
  );
}

export function ParkWaitChart({
  parkSlug,
  operatorSlug,
  focusedId,
  className,
}: {
  parkSlug: string | null;
  operatorSlug?: string | null;
  focusedId: number | null;
  className?: string;
}) {
  const trpc = useTRPC();
  const queueOptions = React.useMemo(() => getQueueOptions(operatorSlug), [operatorSlug]);
  const [queueType, setQueueType] = React.useState("1");
  const [range, setRange] = React.useState("24h");
  const [ridesOpen, setRidesOpen] = React.useState(false);

  React.useEffect(() => {
    const exists = queueOptions.some((q) => q.value === queueType);
    if (!exists) setQueueType("1");
  }, [queueOptions, queueType]);

  const selectedOption = queueOptions.find((q) => q.value === queueType) ?? queueOptions[0];
  const mode = selectedOption?.mode ?? "wait";
  const hours = RANGE_HOURS[range] ?? 168;

  const historyQ = useQuery({
    ...trpc.parks.parkHistory.queryOptions({
      parkSlug: parkSlug ?? "",
      queueType: Number(queueType),
      hours,
    }),
    enabled: !!parkSlug,
  });

  const rides = historyQ.data?.rides ?? [];
  const points = historyQ.data?.points ?? [];

  // Stable color + ordering by ride id (busiest-first from the server).
  const orderIndex = React.useMemo(() => {
    const m = new Map<number, number>();
    rides.forEach((r, i) => m.set(r.id, i));
    return m;
  }, [rides]);
  const colorOf = React.useCallback(
    (id: number) => rideColor(orderIndex.get(id) ?? 0),
    [orderIndex],
  );

  // Augment each bucket with the whole-park average across rides so the chart
  // always carries a park-wide summary line over the individual ride series.
  const ridesKey = rides.map((r) => r.id).join(",");
  const chartData = React.useMemo(() => {
    const ids = rides.map((r) => r.id);
    // Pass 1: aggregate each bucket and flag the ones where the park was open
    // *and* reporting, so we can bound the 0-baseline to the live data range.
    const rows = points.map((p) => {
      const vals: Array<number> = [];
      for (const id of ids) {
        const v = p[String(id)];
        if (typeof v === "number") vals.push(v);
      }
      const open = !p.closed && vals.length > 0;
      const avg = open
        ? mode === "price"
          ? Number((vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(2))
          : Math.round(vals.reduce((a, b) => a + b, 0) / vals.length)
        : null;
      return { p, open, avg };
    });

    // Bound the baseline to [first, last] live bucket: a gap *inside* the range
    // is the park being shut overnight (draw 0, tooltip says "Park closed");
    // gaps before history starts / after it ends stay null so we don't paint a
    // phantom closed flatline where we simply have no data.
    let first = -1;
    let last = -1;
    rows.forEach((r, i) => {
      if (r.open) {
        if (first < 0) first = i;
        last = i;
      }
    });

    return rows.map((r, i) => {
      // Open bucket: keep raw per-ride values. A missing reading mid-day is ride
      // downtime — left null so the line bridges it (connectNulls), not a break.
      if (r.open) return { ...r.p, status: "open" as const, [AVG_KEY]: r.avg };
      const inRange = first >= 0 && i >= first && i <= last;
      // Out-of-range bucket (before history starts / after it ends): stay null so
      // we don't paint a phantom flatline where we simply have no data.
      if (!inRange) return { ...r.p, status: "open" as const, [AVG_KEY]: null };
      // In-range gap: floor every series to 0 so the ride and park-average lines
      // drop to the baseline together instead of breaking. The operating calendar
      // (server `closed` flag from park_schedule) decides what that flatline means:
      // a true overnight closure ("Park closed") vs. the park being open with a
      // data-collection gap ("Missing data"). Either way we keep the 0 baseline.
      const zeroed: Record<string, number> = { [AVG_KEY]: 0 };
      for (const id of ids) zeroed[String(id)] = 0;
      return { ...r.p, ...zeroed, status: r.p.closed ? ("closed" as const) : ("missing" as const) };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [points, ridesKey, mode]);

  const chartConfig = React.useMemo<ChartConfig>(() => {
    const cfg: ChartConfig = {
      [AVG_KEY]: { label: "Park average", color: "var(--primary)" },
    };
    rides.forEach((r, i) => {
      cfg[String(r.id)] = { label: r.name, color: rideColor(i) };
    });
    return cfg;
  }, [rides]);

  // Which ride series are drawn alongside the park lines. Defaults to the
  // busiest few; resets when the ride roster changes (new park / metric).
  const [enabled, setEnabled] = React.useState<Set<number>>(() => new Set());
  React.useEffect(() => {
    setEnabled(new Set(rides.slice(0, DEFAULT_SERIES).map((r) => r.id)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ridesKey]);

  // Picking a ride on the board/map lights up its series.
  React.useEffect(() => {
    if (focusedId == null) return;
    setEnabled((prev) => (prev.has(focusedId) ? prev : new Set(prev).add(focusedId)));
  }, [focusedId]);

  const toggle = (id: number) =>
    setEnabled((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const allEnabled = rides.length > 0 && rides.every((r) => enabled.has(r.id));
  const toggleAll = () => setEnabled(allEnabled ? new Set() : new Set(rides.map((r) => r.id)));

  const formatTick = (value: string) => {
    const date = new Date(value);
    return hours <= 24
      ? date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
      : date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  };

  const labelFormatter = (value: unknown) =>
    new Date(value as string).toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: hours <= 72 ? "2-digit" : undefined,
    });

  const valueFormatter = (v: number) => (mode === "price" ? `$${v.toFixed(2)}` : `${v} min`);

  const metricNoun = mode === "price" ? "price" : "standby wait";
  const description = `Whole-park average ${metricNoun}`;

  const enabledRides = rides.filter((r) => enabled.has(r.id));
  const hasData = chartData.length > 0 && rides.length > 0;

  const SpringTooltip = (props: React.ComponentProps<typeof ChartTooltipContent>) => (
    <motion.div
      initial={{ opacity: 0, scale: 0.95, y: 6 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      transition={{ type: "spring", stiffness: 460, damping: 26, mass: 0.6 }}
    >
      <ChartTooltipContent
        {...props}
        indicator="dot"
        labelFormatter={labelFormatter}
        formatter={(value, name, item) => {
          const key = String(name);
          const status = item?.payload?.status as "open" | "closed" | "missing" | undefined;
          // Flatlined bucket: render one clean line off the park-average series
          // instead of a 0 for every ride; ride series drop out. Whether it reads
          // as a closure or a data gap is decided by the operating calendar.
          if (status === "closed" || status === "missing") {
            if (key !== AVG_KEY) return null;
            if (status === "closed") {
              return (
                <span className="flex items-center gap-1.5 text-muted-foreground">
                  <span className="bg-muted-foreground/40 size-2 shrink-0 rounded-[2px]" />
                  Park closed
                </span>
              );
            }
            // Park was open per its schedule but no reading landed here — surface
            // the gap honestly rather than wrongly claiming the park was closed.
            return (
              <span className="flex items-center gap-1.5 text-muted-foreground">
                <ConstructionIcon
                  size={14}
                  className="shrink-0 text-amber-500 dark:text-amber-400"
                />
                Missing data
              </span>
            );
          }
          if (value == null) return null;
          const color = key === AVG_KEY ? "var(--primary)" : colorOf(Number(key));
          const label = chartConfig[key]?.label ?? key;
          return (
            <div className="flex w-full items-center justify-between gap-3">
              <span className="flex items-center gap-1.5 text-muted-foreground">
                <span
                  className="size-2 shrink-0 rounded-[2px]"
                  style={{ backgroundColor: color }}
                />
                {label}
              </span>
              <span className="font-mono font-medium tabular-nums text-foreground">
                {valueFormatter(Number(value))}
              </span>
            </div>
          );
        }}
      />
    </motion.div>
  );

  return (
    <Card className={cn("@container/card flex flex-col", className)}>
      <CardHeader>
        <div className="min-w-0">
          <CardTitle className="truncate">
            {parkSlug ? "Park wait history" : "Wait History"}
          </CardTitle>
          <CardDescription className="truncate">{description}</CardDescription>
        </div>
        <CardAction className="flex flex-wrap justify-end gap-2">
          <Select
            value={queueType}
            onValueChange={(v) => v && setQueueType(v)}
            items={Object.fromEntries(queueOptions.map((q) => [q.value, q.label]))}
          >
            <SelectTrigger size="sm" className="w-40" aria-label="Metric">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {queueOptions.map((q) => (
                <SelectItem key={q.value} value={q.value}>
                  {q.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <ToggleGroup
            multiple={false}
            value={range ? [range] : []}
            onValueChange={(v) => setRange(v[0] ?? "24h")}
            variant="outline"
            className="hidden *:data-[slot=toggle-group-item]:px-3! @[640px]/card:flex"
          >
            <ToggleGroupItem value="24h">24h</ToggleGroupItem>
            <ToggleGroupItem value="7d">7d</ToggleGroupItem>
            <ToggleGroupItem value="30d">30d</ToggleGroupItem>
          </ToggleGroup>
          {/* Narrow cards: the legend collapses into a bottom drawer behind this
              button (the inline list is hidden below 640px) so the chart keeps
              full width. */}
          {rides.length > 0 && (
            <>
              <Button
                variant="outline"
                size="sm"
                className="@[640px]/card:hidden"
                onClick={() => setRidesOpen(true)}
              >
                Rides ({rides.length})
              </Button>
              <Drawer open={ridesOpen} onOpenChange={setRidesOpen}>
                <DrawerContent className="max-h-[85vh] px-2">
                  <DrawerTitle className="sr-only">Ride series</DrawerTitle>
                  <DrawerDescription className="sr-only">
                    Toggle which ride series appear on the chart.
                  </DrawerDescription>
                  <div
                    className="flex min-h-0 flex-1 flex-col overflow-y-auto pb-[calc(env(safe-area-inset-bottom)+0.5rem)]"
                    role="group"
                    aria-label="Toggle ride series"
                  >
                    <RideLegend
                      rides={rides}
                      enabled={enabled}
                      colorOf={colorOf}
                      toggle={toggle}
                      toggleAll={toggleAll}
                      allEnabled={allEnabled}
                      onClose={() => setRidesOpen(false)}
                    />
                  </div>
                </DrawerContent>
              </Drawer>
            </>
          )}
        </CardAction>
      </CardHeader>
      <CardContent className="flex min-h-0 flex-1 flex-col px-2 pt-4 sm:px-6 sm:pt-6">
        {!parkSlug ? (
          <Empty className="h-[380px]">
            <EmptyTitle>No park selected</EmptyTitle>
            <EmptyDescription>Pick a park to see its wait history.</EmptyDescription>
          </Empty>
        ) : historyQ.isLoading ? (
          <Skeleton className="h-[340px] w-full" />
        ) : !hasData ? (
          <ConstructionState
            className="h-[380px]"
            title="Charting in progress"
            description={
              <>
                We&rsquo;re still gathering {mode === "price" ? "pricing" : "wait"} history for this
                park. Check back soon.
              </>
            }
          />
        ) : (
          <div className="flex min-h-0 min-w-0 gap-3">
            <ChartContainer config={chartConfig} className="aspect-auto h-[340px] min-w-0 flex-1">
              <LineChart data={chartData} margin={{ left: 0, right: 0, top: 8 }}>
                <CartesianGrid vertical={false} />
                <XAxis
                  dataKey="bucket"
                  tickLine={false}
                  axisLine={false}
                  tickMargin={8}
                  minTickGap={32}
                  tickFormatter={formatTick}
                />
                <YAxis
                  // Axis on the right, with `mirror` drawing the tick labels inside
                  // the plot area so the series still uses the full card width
                  // instead of ceding a gutter to the labels.
                  orientation="right"
                  mirror
                  tickLine={false}
                  axisLine={false}
                  width={24}
                  tickMargin={2}
                  tick={{ fontSize: 11 }}
                  tickFormatter={(v) => (mode === "price" ? `$${v}` : `${v}`)}
                />
                <ChartTooltip
                  cursor={{ strokeDasharray: "3 3" }}
                  isAnimationActive={false}
                  wrapperStyle={{ transition: "transform 90ms ease" }}
                  content={<SpringTooltip />}
                />
                {enabledRides.map((r) => {
                  const isFocused = r.id === focusedId;
                  const dim = focusedId != null && !isFocused;
                  return (
                    <Line
                      key={r.id}
                      dataKey={String(r.id)}
                      name={String(r.id)}
                      type="monotone"
                      stroke={colorOf(r.id)}
                      strokeWidth={isFocused ? 2.75 : 1.75}
                      strokeOpacity={dim ? 0.35 : 1}
                      dot={false}
                      activeDot={{ r: isFocused ? 4 : 3 }}
                      isAnimationActive={false}
                      connectNulls
                    />
                  );
                })}
                {/* Whole-park average always sits on top of the ride series. */}
                <Line
                  dataKey={AVG_KEY}
                  name={AVG_KEY}
                  type="monotone"
                  stroke="var(--primary)"
                  strokeWidth={2.75}
                  strokeDasharray="5 4"
                  dot={false}
                  activeDot={{ r: 4 }}
                  isAnimationActive={false}
                  connectNulls
                />
              </LineChart>
            </ChartContainer>

            {/* Inline ride legend — only from 640px up; below that it lives in the
                Sheet behind the "Rides" button so the chart keeps full width. */}
            <div
              className="hidden max-h-[340px] w-44 shrink-0 flex-col overflow-y-auto rounded-lg border bg-muted/20 @[640px]/card:flex"
              role="group"
              aria-label="Toggle ride series"
            >
              <RideLegend
                rides={rides}
                enabled={enabled}
                colorOf={colorOf}
                toggle={toggle}
                toggleAll={toggleAll}
                allEnabled={allEnabled}
              />
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
