"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { motion } from "motion/react";
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";

import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "#/components/ui/card.tsx";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "#/components/ui/chart.tsx";
import { ConstructionState } from "#/components/ui/anim-icons/construction.tsx";
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
      if (r.open) return { ...r.p, closed: false, [AVG_KEY]: r.avg };
      const inRange = first >= 0 && i >= first && i <= last;
      // Closed-but-in-range bucket (park shut overnight): floor every series to 0
      // so ride lines and the park average drop to the baseline together instead
      // of breaking. Out-of-range buckets stay null so we draw no phantom line.
      if (!inRange) return { ...r.p, closed: false, [AVG_KEY]: null };
      const zeroed: Record<string, number> = { [AVG_KEY]: 0 };
      for (const id of ids) zeroed[String(id)] = 0;
      return { ...r.p, ...zeroed, closed: true };
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
  const description = `Whole-park average ${metricNoun} — toggle rides at right`;

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
          // Closed bucket: one clean "Park closed" line off the park-average
          // series instead of a 0; ride series are null here and drop out.
          const closed = Boolean(item?.payload?.closed);
          if (closed) {
            if (key !== AVG_KEY) return null;
            return (
              <span className="flex items-center gap-1.5 text-muted-foreground">
                <span className="bg-muted-foreground/40 size-2 shrink-0 rounded-[2px]" />
                Park closed
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
        <CardTitle>{parkSlug ? "Park wait history" : "Wait History"}</CardTitle>
        <CardDescription>{description}</CardDescription>
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
          <div className="flex min-h-0 gap-3">
            <ChartContainer config={chartConfig} className="aspect-auto h-[340px] min-w-0 flex-1">
              <LineChart data={chartData} margin={{ left: 4, right: 8, top: 8 }}>
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
                  tickLine={false}
                  axisLine={false}
                  width={26}
                  tickMargin={2}
                  tick={{ textAnchor: "end" }}
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

            {/* Scrollable ride legend — toggle individual ride series on/off. */}
            <div
              className="flex max-h-[340px] w-44 shrink-0 flex-col overflow-y-auto rounded-lg border bg-muted/20"
              role="group"
              aria-label="Toggle ride series"
            >
              <div className="text-muted-foreground sticky top-0 z-10 flex items-center justify-between gap-2 bg-card/95 px-3 py-2 text-xs font-medium supports-backdrop-filter:backdrop-blur">
                <span>Rides ({rides.length})</span>
                <button
                  type="button"
                  onClick={toggleAll}
                  aria-pressed={allEnabled}
                  className="text-primary rounded px-1 py-0.5 font-medium transition-colors hover:underline"
                >
                  {allEnabled ? "Clear all" : "Select all"}
                </button>
              </div>
              <div className="flex flex-col gap-0.5 p-1">
                {rides.map((r) => {
                  const on = enabled.has(r.id);
                  const isFocused = r.id === focusedId;
                  return (
                    <button
                      key={r.id}
                      type="button"
                      onClick={() => toggle(r.id)}
                      aria-pressed={on}
                      title={r.name}
                      className={cn(
                        "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors",
                        on ? "text-foreground" : "text-muted-foreground hover:bg-muted/50",
                        isFocused && "bg-muted ring-2 ring-ring/50",
                      )}
                    >
                      <span
                        className="size-2.5 shrink-0 rounded-[3px]"
                        style={{
                          backgroundColor: on ? colorOf(r.id) : "transparent",
                          boxShadow: on ? undefined : `inset 0 0 0 1.5px ${colorOf(r.id)}`,
                        }}
                      />
                      <span className="truncate">{r.name}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
