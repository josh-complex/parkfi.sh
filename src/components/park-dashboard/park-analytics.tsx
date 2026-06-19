"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  PolarAngleAxis,
  PolarGrid,
  Radar,
  RadarChart,
  Scatter,
  ScatterChart,
  Tooltip,
  Treemap,
  XAxis,
  YAxis,
  ZAxis,
} from "recharts";

import {
  Card,
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
import { Skeleton } from "#/components/ui/skeleton.tsx";
import { useTRPC } from "#/integrations/trpc/react.ts";

import { isSingleRiderName } from "./lightning-lane.ts";
import { rideColor } from "./ride-colors.ts";

// Short 12h label for an hour-of-day index (0–23): 0 -> "12a", 13 -> "1p".
function hourLabel(h: number): string {
  const period = h < 12 ? "a" : "p";
  const base = h % 12 === 0 ? 12 : h % 12;
  return `${base}${period}`;
}

/** Shared empty / thin-data state sized to match a chart body. */
function ChartEmpty({ label }: { label: string }) {
  return (
    <div className="flex h-[220px] items-center justify-center px-6 text-center text-sm text-muted-foreground">
      {label}
    </div>
  );
}

function AnalyticsCard({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <Card className="@container/analytics flex flex-col overflow-hidden">
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
        <CardDescription className="truncate">{description}</CardDescription>
      </CardHeader>
      <CardContent className="flex min-h-0 flex-1 flex-col px-2 pb-4 sm:px-4">
        {children}
      </CardContent>
    </Card>
  );
}

// ───────────────────────── 2. Average wait trend (area) ──────────────────────
function ActivityChart({
  data,
  timeZone,
}: {
  data: Array<{ bucket: string; rides: number; avgWait: number | null }>;
  timeZone: string;
}) {
  const config: ChartConfig = {
    avgWait: { label: "Avg wait", color: "var(--primary)" },
  };
  // Pin to the park timezone — this axis renders during SSR, so a bare
  // `toLocaleDateString` would pick UTC on the server and the viewer's zone in
  // the browser and trip a hydration mismatch.
  const fmtTick = (v: string) =>
    new Date(v).toLocaleDateString("en-US", { weekday: "short", timeZone });
  const hasData = data.some((d) => d.avgWait != null);
  if (!hasData) return <ChartEmpty label="No recent wait history yet." />;
  return (
    <ChartContainer config={config} className="aspect-auto h-[220px] w-full">
      <AreaChart data={data} margin={{ left: 0, right: 6, top: 8 }}>
        <defs>
          <linearGradient id="fill-activity" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="var(--primary)" stopOpacity={0.5} />
            <stop offset="95%" stopColor="var(--primary)" stopOpacity={0.04} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} />
        <XAxis
          dataKey="bucket"
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          minTickGap={40}
          tickFormatter={fmtTick}
        />
        <YAxis
          orientation="right"
          mirror
          width={24}
          tickLine={false}
          axisLine={false}
          tick={{ fontSize: 11 }}
          allowDecimals={false}
        />
        <ChartTooltip
          isAnimationActive={false}
          content={
            <ChartTooltipContent
              indicator="dot"
              labelFormatter={(_, p) => {
                const v = p?.[0]?.payload?.bucket as string | undefined;
                return v
                  ? new Date(v).toLocaleString("en-US", {
                      month: "short",
                      day: "numeric",
                      hour: "numeric",
                      timeZone,
                    })
                  : "";
              }}
              formatter={(value, _name, item) => {
                const rides = (item?.payload as { rides?: number } | undefined)?.rides;
                return (
                  <div className="flex w-full flex-col gap-0.5">
                    <span className="text-foreground">
                      <span className="font-mono font-medium tabular-nums">{Number(value)}</span>{" "}
                      <span className="text-muted-foreground">min avg standby</span>
                    </span>
                    {rides != null && (
                      <span className="text-muted-foreground">across {rides} rides</span>
                    )}
                  </div>
                );
              }}
            />
          }
        />
        <Area
          dataKey="avgWait"
          type="monotone"
          stroke="var(--primary)"
          strokeWidth={1.75}
          fill="url(#fill-activity)"
          isAnimationActive={false}
          connectNulls
        />
      </AreaChart>
    </ChartContainer>
  );
}

// ───────────────────────── 3. Crowd calendar (heatmap) ───────────────────────
function HeatmapChart({ data }: { data: Array<{ date: string; hour: number; avgWait: number }> }) {
  const { dates, hours, cells, max } = React.useMemo(() => {
    const dateSet = new Set<string>();
    let lo = 23;
    let hi = 0;
    let mx = 0;
    const map = new Map<string, number>();
    for (const d of data) {
      dateSet.add(d.date);
      lo = Math.min(lo, d.hour);
      hi = Math.max(hi, d.hour);
      mx = Math.max(mx, d.avgWait);
      map.set(`${d.date}|${d.hour}`, d.avgWait);
    }
    const ds = [...dateSet].sort();
    const hs: Array<number> = [];
    for (let h = lo; h <= hi; h++) hs.push(h);
    return { dates: ds, hours: hs, cells: map, max: mx };
  }, [data]);

  if (data.length === 0) return <ChartEmpty label="Not enough history for a calendar yet." />;

  // Green → amber → red ramp by intensity; empty cells stay muted.
  const cellColor = (v: number | undefined) => {
    if (v == null) return "var(--muted)";
    const t = max > 0 ? v / max : 0;
    return `hsl(${Math.round(140 - 140 * t)} 72% ${Math.round(52 - 8 * t)}%)`;
  };
  const dayLabel = (d: string) =>
    new Date(`${d}T12:00:00`).toLocaleDateString("en-US", { weekday: "short", day: "numeric" });

  return (
    <div className="flex h-[220px] flex-col gap-1.5 px-2 pt-1">
      <div className="flex min-h-0 flex-1 flex-col">
        {/* hour header */}
        <div
          className="grid items-center gap-px pl-12 text-[10px] text-muted-foreground"
          style={{ gridTemplateColumns: `repeat(${hours.length}, minmax(0, 1fr))` }}
        >
          {hours.map((h) => (
            <div key={h} className="text-center">
              {h % 3 === 0 ? hourLabel(h) : ""}
            </div>
          ))}
        </div>
        {dates.map((d) => (
          <div key={d} className="flex min-h-0 flex-1 items-center gap-1">
            <div className="w-11 shrink-0 text-right text-[10px] leading-none text-muted-foreground">
              {dayLabel(d)}
            </div>
            <div
              className="grid h-full flex-1 gap-px py-px"
              style={{ gridTemplateColumns: `repeat(${hours.length}, minmax(0, 1fr))` }}
            >
              {hours.map((h) => {
                const v = cells.get(`${d}|${h}`);
                return (
                  <div
                    key={h}
                    className="h-full min-h-[6px] rounded-[2px]"
                    style={{ backgroundColor: cellColor(v) }}
                    title={v != null ? `${dayLabel(d)} ${hourLabel(h)} · ${v} min` : undefined}
                  />
                );
              })}
            </div>
          </div>
        ))}
      </div>
      <div className="flex items-center gap-2 pl-12 text-[10px] text-muted-foreground">
        <span>quiet</span>
        <div className="h-2 flex-1 rounded-full bg-[linear-gradient(to_right,hsl(140_72%_52%),hsl(70_72%_48%),hsl(0_72%_44%))]" />
        <span>{max} min</span>
      </div>
    </div>
  );
}

// ───────────────────────── 4. Average wait by land (bar) ─────────────────────
function LandChart({
  data,
}: {
  data: Array<{ land: string; avgWait: number; peak: number; rides: number }>;
}) {
  const config: ChartConfig = {
    avgWait: { label: "Avg wait", color: "var(--primary)" },
  };
  if (data.length === 0) return <ChartEmpty label="No land-tagged rides for this park." />;
  return (
    <ChartContainer config={config} className="aspect-auto h-[220px] w-full">
      <BarChart data={data} layout="vertical" margin={{ left: 4, right: 28, top: 4, bottom: 4 }}>
        <CartesianGrid horizontal={false} />
        <XAxis type="number" tickLine={false} axisLine={false} tick={{ fontSize: 11 }} />
        <YAxis
          type="category"
          dataKey="land"
          width={96}
          tickLine={false}
          axisLine={false}
          tick={{ fontSize: 11 }}
          tickFormatter={(v: string) => (v.length > 16 ? `${v.slice(0, 15)}…` : v)}
        />
        <ChartTooltip
          isAnimationActive={false}
          cursor={{ fill: "var(--muted)", opacity: 0.4 }}
          content={
            <ChartTooltipContent
              indicator="dot"
              formatter={(value, _name, item) => {
                const p = item?.payload as
                  | { peak?: number; rides?: number; land?: string }
                  | undefined;
                return (
                  <div className="flex w-full flex-col gap-0.5">
                    <span className="font-medium text-foreground">{p?.land}</span>
                    <span className="text-muted-foreground">
                      avg <span className="text-foreground">{Number(value)} min</span> · peak{" "}
                      {p?.peak} min · {p?.rides} rides
                    </span>
                  </div>
                );
              }}
            />
          }
        />
        <Bar dataKey="avgWait" radius={[0, 4, 4, 0]} isAnimationActive={false}>
          {data.map((d, i) => (
            <Cell key={d.land} fill={rideColor(i)} />
          ))}
        </Bar>
      </BarChart>
    </ChartContainer>
  );
}

// ───────────────────────── 5. Daily rhythm (radar) ───────────────────────────
function RhythmChart({ data }: { data: Array<{ hour: number; avgWait: number }> }) {
  const config: ChartConfig = {
    avgWait: { label: "Avg wait", color: "var(--primary)" },
  };
  const shaped = React.useMemo(() => data.map((d) => ({ ...d, label: hourLabel(d.hour) })), [data]);
  if (data.length < 4) return <ChartEmpty label="Not enough hours sampled yet." />;
  return (
    <ChartContainer config={config} className="mx-auto aspect-square h-[220px]">
      <RadarChart data={shaped} margin={{ top: 8, bottom: 8 }}>
        <PolarGrid />
        <PolarAngleAxis dataKey="label" tick={{ fontSize: 10 }} />
        <ChartTooltip
          isAnimationActive={false}
          content={
            <ChartTooltipContent
              indicator="dot"
              labelFormatter={(_, p) => {
                const h = (p?.[0]?.payload as { hour?: number } | undefined)?.hour;
                return h == null ? "" : `${hourLabel(h)} (park local)`;
              }}
              formatter={(value) => (
                <span className="text-foreground">
                  <span className="font-mono font-medium tabular-nums">{Number(value)} min</span>{" "}
                  <span className="text-muted-foreground">avg standby</span>
                </span>
              )}
            />
          }
        />
        <Radar
          dataKey="avgWait"
          stroke="var(--primary)"
          fill="var(--primary)"
          fillOpacity={0.25}
          isAnimationActive={false}
        />
      </RadarChart>
    </ChartContainer>
  );
}

// ───────────────────────── 6. Busy vs. volatile (scatter) ────────────────────
function ScatterAnalysis({
  data,
}: {
  data: Array<{ id: number; name: string; avgWait: number; volatility: number; peak: number }>;
}) {
  const config: ChartConfig = {
    avgWait: { label: "Avg wait", color: "var(--primary)" },
  };
  if (data.length === 0) return <ChartEmpty label="No ride samples yet." />;
  return (
    <ChartContainer config={config} className="aspect-auto h-[220px] w-full">
      <ScatterChart margin={{ left: 0, right: 12, top: 8, bottom: 16 }}>
        <CartesianGrid />
        <XAxis
          type="number"
          dataKey="avgWait"
          name="Avg wait"
          unit="m"
          tickLine={false}
          axisLine={false}
          tick={{ fontSize: 11 }}
          label={{ value: "Avg wait →", position: "insideBottom", offset: -8, fontSize: 10 }}
        />
        <YAxis
          type="number"
          dataKey="volatility"
          name="Volatility"
          orientation="right"
          mirror
          width={24}
          tickLine={false}
          axisLine={false}
          tick={{ fontSize: 11 }}
        />
        <ZAxis type="number" dataKey="peak" range={[40, 360]} name="Peak" />
        <ChartTooltip
          isAnimationActive={false}
          cursor={{ strokeDasharray: "3 3" }}
          content={
            <ChartTooltipContent
              indicator="dot"
              hideLabel
              formatter={(_value, _name, item) => {
                const p = item?.payload as
                  | { name?: string; avgWait?: number; volatility?: number; peak?: number }
                  | undefined;
                if (!p) return null;
                return (
                  <div className="flex w-full flex-col gap-0.5">
                    <span className="font-medium text-foreground">{p.name}</span>
                    <span className="text-muted-foreground">
                      avg <span className="text-foreground">{p.avgWait} min</span> · swing ±
                      {p.volatility} · peak {p.peak} min
                    </span>
                  </div>
                );
              }}
            />
          }
        />
        <Scatter data={data} isAnimationActive={false}>
          {data.map((d, i) => (
            <Cell key={d.id} fill={rideColor(i)} fillOpacity={0.7} />
          ))}
        </Scatter>
      </ScatterChart>
    </ChartContainer>
  );
}

// ───────────────────────── 7. Queue burden by ride (treemap) ─────────────────
function TreemapNode(props: {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  index?: number;
  name?: string;
}) {
  const { x = 0, y = 0, width = 0, height = 0, index = 0, name = "" } = props;
  if (width <= 0 || height <= 0) return null;
  const showLabel = width > 56 && height > 26;
  const max = Math.max(1, Math.floor(width / 7));
  const label = name.length > max ? `${name.slice(0, max - 1)}…` : name;
  return (
    <g>
      <rect
        x={x}
        y={y}
        width={width}
        height={height}
        rx={3}
        style={{
          fill: rideColor(index),
          fillOpacity: 0.85,
          stroke: "var(--background)",
          strokeWidth: 2,
        }}
      />
      {showLabel && (
        <text x={x + 6} y={y + 16} fontSize={11} fontWeight={500} fill="#fff">
          {label}
        </text>
      )}
    </g>
  );
}

function TreemapChart({
  data,
}: {
  data: Array<{ id: number; name: string; total: number; avgWait: number }>;
}) {
  if (data.length === 0) return <ChartEmpty label="No queue data yet." />;
  return (
    <ChartContainer config={{}} className="aspect-auto h-[220px] w-full">
      <Treemap
        data={data}
        dataKey="total"
        nameKey="name"
        isAnimationActive={false}
        content={<TreemapNode />}
      >
        <Tooltip
          isAnimationActive={false}
          content={({ active, payload }) => {
            if (!active || !payload?.length) return null;
            const p = payload[0]?.payload as
              | { name?: string; total?: number; avgWait?: number }
              | undefined;
            if (!p) return null;
            return (
              <div className="rounded-xl bg-popover px-2.5 py-1.5 text-xs text-popover-foreground shadow-lg ring-1 ring-foreground/5 dark:ring-foreground/10">
                <div className="font-medium text-foreground">{p.name}</div>
                <div className="text-muted-foreground">
                  avg <span className="text-foreground">{p.avgWait} min</span> ·{" "}
                  {Number(p.total).toLocaleString()} queue-min
                </div>
              </div>
            );
          }}
        />
      </Treemap>
    </ChartContainer>
  );
}

/** A deliberately empty grid slot, reserved for a future metric. */
function PlaceholderCell() {
  return (
    <div className="flex min-h-[120px] items-center justify-center rounded-2xl border border-dashed bg-muted/10 p-6 text-center text-sm text-muted-foreground lg:col-span-2">
      More metrics coming soon
    </div>
  );
}

export function ParkAnalytics({ parkSlug }: { parkSlug: string | null }) {
  const trpc = useTRPC();
  const q = useQuery({
    ...trpc.parks.analytics.queryOptions({ parkSlug: parkSlug ?? "" }),
    enabled: !!parkSlug,
  });

  const scatter = React.useMemo(
    () => (q.data?.scatter ?? []).filter((r) => !isSingleRiderName(r.name)),
    [q.data],
  );
  const treemap = React.useMemo(
    () => (q.data?.treemap ?? []).filter((r) => !isSingleRiderName(r.name)),
    [q.data],
  );

  if (q.isLoading || !parkSlug) {
    return (
      <div className="grid gap-4 lg:grid-cols-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-[296px] w-full rounded-2xl" />
        ))}
      </div>
    );
  }

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h3 className="text-lg font-semibold tracking-tight">Park analytics</h3>
        <p className="text-sm text-muted-foreground">
          Rolling rollups of standby waits across this park&rsquo;s recent history.
        </p>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <AnalyticsCard
          title="Average wait trend"
          description="Whole-park hourly average standby · 7 days"
        >
          <ActivityChart
            data={q.data?.activity ?? []}
            timeZone={q.data?.timezone ?? "America/New_York"}
          />
        </AnalyticsCard>
        <AnalyticsCard title="Average wait by land" description="Mean standby per area · 7 days">
          <LandChart data={q.data?.byLand ?? []} />
        </AnalyticsCard>
        <AnalyticsCard
          title="Crowd calendar"
          description="Avg standby by day & hour (park local) · 14 days"
        >
          <HeatmapChart data={q.data?.heatmap ?? []} />
        </AnalyticsCard>
        <AnalyticsCard title="Daily rhythm" description="Avg standby by hour of day · 14 days">
          <RhythmChart data={q.data?.rhythm ?? []} />
        </AnalyticsCard>
        <AnalyticsCard
          title="Busy vs. volatile"
          description="Per ride: avg wait × swing, sized by peak · 7 days"
        >
          <ScatterAnalysis data={scatter} />
        </AnalyticsCard>
        <AnalyticsCard
          title="Queue burden by ride"
          description="Share of total standby minutes per ride · 7 days"
        >
          <TreemapChart data={treemap} />
        </AnalyticsCard>
        <PlaceholderCell />
      </div>
    </section>
  );
}
