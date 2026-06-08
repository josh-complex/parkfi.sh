"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { motion } from "motion/react";
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";

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
import { ConstructionState } from "#/components/ui/construction.tsx";
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

function getQueueOptions(operatorSlug?: string | null) {
  const paidLabel = paidLineProduct(operatorSlug);
  // Universal Express: uses queue type 3 (return-time/virtual-line), no per-ride price
  // Disney Lightning Lane Single: uses queue type 4 (paid return time), has price
  return [
    { value: "1", label: "Standby wait", mode: "wait" as const },
    isUniversal(operatorSlug)
      ? { value: "3", label: paidLabel, mode: "wait" as const }
      : { value: "4", label: paidLabel, mode: "price" as const },
  ];
}

const RANGE_HOURS: Record<string, number> = { "24h": 24, "7d": 168, "30d": 720 };

const chartConfig = {
  avgWait: { label: "Avg wait", color: "var(--primary)" },
  maxWait: { label: "Peak wait", color: "var(--primary)" },
  price: { label: "Price", color: "var(--primary)" },
  availPct: { label: "Available", color: "var(--chart-2)" },
} satisfies ChartConfig;

export function ParkWaitChart({
  attractionId,
  attractionName,
  operatorSlug,
  className,
}: {
  attractionId: number | null;
  attractionName: string | null;
  operatorSlug?: string | null;
  className?: string;
}) {
  const trpc = useTRPC();
  const queueOptions = React.useMemo(() => getQueueOptions(operatorSlug), [operatorSlug]);
  const [queueType, setQueueType] = React.useState("1");
  const [range, setRange] = React.useState("7d");

  // When operator changes, reset to standby if current selection no longer exists
  React.useEffect(() => {
    const exists = queueOptions.some((q) => q.value === queueType);
    if (!exists) setQueueType("1");
  }, [queueOptions, queueType]);

  const selectedOption = queueOptions.find((q) => q.value === queueType) ?? queueOptions[0];
  const mode = selectedOption?.mode ?? "wait";
  const hours = RANGE_HOURS[range] ?? 168;

  const historyQ = useQuery({
    ...trpc.parks.history.queryOptions({
      attractionId: attractionId ?? 0,
      queueType: Number(queueType),
      hours,
    }),
    enabled: attractionId != null,
  });

  const data = React.useMemo(
    () =>
      (historyQ.data ?? []).map((p) => ({
        bucket: p.bucket,
        avgWait: p.avgWait,
        maxWait: p.maxWait,
        price: p.avgPrice != null ? p.avgPrice / 100 : null,
        availPct:
          p.samples > 0 ? Math.round(((p.samples - p.soldOutSamples) / p.samples) * 100) : null,
      })),
    [historyQ.data],
  );

  const formatTick = (value: string) => {
    const date = new Date(value);
    return hours <= 24
      ? date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
      : date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  };

  const hasData = data.some((d) =>
    mode === "price" ? d.price != null : d.avgWait != null || d.maxWait != null,
  );

  const labelFormatter = (value: unknown) =>
    new Date(value as string).toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: hours <= 72 ? "2-digit" : undefined,
    });

  const description =
    mode === "price"
      ? `${selectedOption?.label ?? "Lightning Lane"} price over time`
      : `${selectedOption?.label ?? "Wait"} over time`;

  const SpringTooltip = (props: React.ComponentProps<typeof ChartTooltipContent>) => (
    <motion.div
      initial={{ opacity: 0, scale: 0.95, y: 6 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      transition={{ type: "spring", stiffness: 460, damping: 26, mass: 0.6 }}
    >
      <ChartTooltipContent {...props} indicator="dot" labelFormatter={labelFormatter} />
    </motion.div>
  );

  return (
    <Card className={cn("@container/card", className)}>
      <CardHeader>
        <CardTitle>{attractionName ?? "Wait History"}</CardTitle>
        <CardDescription>{description}</CardDescription>
        <CardAction className="flex gap-2">
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
            onValueChange={(v) => setRange(v[0] ?? "7d")}
            variant="outline"
            className="hidden *:data-[slot=toggle-group-item]:px-3! @[640px]/card:flex"
          >
            <ToggleGroupItem value="24h">24h</ToggleGroupItem>
            <ToggleGroupItem value="7d">7d</ToggleGroupItem>
            <ToggleGroupItem value="30d">30d</ToggleGroupItem>
          </ToggleGroup>
        </CardAction>
      </CardHeader>
      <CardContent className="px-2 pt-4 sm:px-6 sm:pt-6">
        {attractionId == null ? (
          <Empty className="h-[380px]">
            <EmptyTitle>No ride selected</EmptyTitle>
            <EmptyDescription>Pick an attraction from the board.</EmptyDescription>
          </Empty>
        ) : historyQ.isLoading ? (
          <Skeleton className="h-[250px] w-full" />
        ) : !hasData ? (
          <ConstructionState
            className="h-[380px]"
            title="Charting in progress"
            description={
              <>
                We&rsquo;re still gathering {mode === "price" ? "pricing" : "wait"} history for{" "}
                {attractionName ?? "this attraction"}. Check back soon.
              </>
            }
          />
        ) : (
          <ChartContainer config={chartConfig} className="aspect-auto h-[380px] w-full">
            <AreaChart data={data}>
              <defs>
                <linearGradient id="fillPark" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="var(--primary)" stopOpacity={0.8} />
                  <stop offset="95%" stopColor="var(--primary)" stopOpacity={0.1} />
                </linearGradient>
                {mode === "price" && (
                  <linearGradient id="fillAvail" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="var(--chart-2)" stopOpacity={0.5} />
                    <stop offset="95%" stopColor="var(--chart-2)" stopOpacity={0.05} />
                  </linearGradient>
                )}
              </defs>
              <CartesianGrid vertical={false} />
              <XAxis
                dataKey="bucket"
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                minTickGap={32}
                tickFormatter={formatTick}
              />
              {mode === "price" ? (
                <>
                  <YAxis
                    yAxisId="price"
                    tickLine={false}
                    axisLine={false}
                    width={40}
                    tickFormatter={(v) => `$${v}`}
                  />
                  <YAxis
                    yAxisId="avail"
                    orientation="right"
                    tickLine={false}
                    axisLine={false}
                    width={40}
                    domain={[0, 100]}
                    tickFormatter={(v) => `${v}%`}
                  />
                </>
              ) : (
                <YAxis tickLine={false} axisLine={false} width={40} tickFormatter={(v) => `${v}`} />
              )}
              <ChartTooltip
                cursor={false}
                isAnimationActive={false}
                wrapperStyle={{ transition: "transform 90ms ease" }}
                content={<SpringTooltip />}
              />
              {mode === "price" ? (
                <>
                  <Area
                    yAxisId="price"
                    dataKey="price"
                    type="monotone"
                    animationDuration={500}
                    fill="url(#fillPark)"
                    stroke="var(--primary)"
                    connectNulls
                  />
                  <Area
                    yAxisId="avail"
                    dataKey="availPct"
                    name="Available"
                    type="monotone"
                    animationDuration={500}
                    fill="url(#fillAvail)"
                    stroke="var(--chart-2)"
                    fillOpacity={1}
                    connectNulls
                  />
                </>
              ) : (
                <>
                  <Area
                    dataKey="maxWait"
                    type="monotone"
                    animationDuration={500}
                    fill="url(#fillPark)"
                    stroke="var(--primary)"
                    fillOpacity={0.25}
                    connectNulls
                  />
                  <Area
                    dataKey="avgWait"
                    type="monotone"
                    animationDuration={500}
                    fill="url(#fillPark)"
                    stroke="var(--primary)"
                    connectNulls
                  />
                </>
              )}
            </AreaChart>
          </ChartContainer>
        )}
      </CardContent>
    </Card>
  );
}
