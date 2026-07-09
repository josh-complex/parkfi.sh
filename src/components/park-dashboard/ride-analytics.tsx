"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { bisector, max as d3max } from "d3-array";
import { AxisBottom, AxisLeft } from "@visx/axis";
import { curveMonotoneX } from "@visx/curve";
import { localPoint } from "@visx/event";
import { LinearGradient } from "@visx/gradient";
import { GridRows } from "@visx/grid";
import { Group } from "@visx/group";
import { PatternLines } from "@visx/pattern";
import { scaleBand, scaleLinear, scaleTime } from "@visx/scale";
import { Area, AreaClosed, Bar, Circle, Line, LinePath } from "@visx/shape";

import { ToggleGroup, ToggleGroupItem } from "#/components/ui/toggle-group.tsx";
import { useTRPC } from "#/integrations/trpc/react.ts";

import { indicativeSeries, strokeRuns } from "./visx/indicative.ts";
import {
  AnalyticsCard,
  AXIS_INK,
  ChartEmpty,
  ChartFrame,
  CHART_H,
  clientXY,
  GRID_INK,
  hourLabel,
  intensityColor,
  MOBILE_TICK,
  PRIMARY,
  tickLabelProps,
  useChartTooltip,
} from "./visx/kit.tsx";

// Analytics cards stack into one column on mobile, so a tall body makes the page
// very long — shrink the plot area below `md`, keeping the desktop height.
const CHART_H_RESPONSIVE = { base: 180, md: CHART_H };

const DOW_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

// ───────────────────────── 1. Wait trend (windowed area) ─────────────────────
type TrendWindow = 24 | 168 | 720;
const WINDOW_LABEL: Record<TrendWindow, string> = { 24: "24h", 168: "7d", 720: "30d" };

type HistoryBucket = {
  bucket: string;
  avgWait: number | null;
  minWait: number | null;
  maxWait: number | null;
  samples: number;
};
const bisectTrend = bisector<HistoryBucket, Date>((d) => new Date(d.bucket)).left;

// Native bucket width per window (mirrors the server's `time_bucket` choice in
// `parks.history`), used to fill entirely-missing buckets below.
const BUCKET_MS: Record<TrendWindow, number> = {
  24: 15 * 60_000,
  168: 60 * 60_000,
  720: 6 * 60 * 60_000,
};

/**
 * The `history` query only returns rows that actually exist — a stretch with
 * zero polls (collection outage, overnight downtime) is simply absent, not a
 * null-valued row. Fill the span between the first and last bucket at the
 * window's native cadence so a fully missing stretch becomes an explicit gap
 * the indicative-series treatment below can bridge, instead of a silent
 * straight line jumping across it.
 */
function fillGrid(data: Array<HistoryBucket>, bucketMs: number): Array<HistoryBucket> {
  if (data.length === 0) return [];
  const byTime = new Map(data.map((d) => [new Date(d.bucket).getTime(), d]));
  const start = new Date(data[0]!.bucket).getTime();
  const end = new Date(data[data.length - 1]!.bucket).getTime();
  const steps = Math.max(0, Math.round((end - start) / bucketMs));
  const grid: Array<HistoryBucket> = [];
  for (let i = 0; i <= steps; i++) {
    const t = start + i * bucketMs;
    grid.push(
      byTime.get(t) ?? {
        bucket: new Date(t).toISOString(),
        avgWait: null,
        minWait: null,
        maxWait: null,
        samples: 0,
      },
    );
  }
  return grid;
}

const dayKey = (d: Date, timeZone: string) => d.toLocaleDateString("en-CA", { timeZone });

/** Local hour-of-day (with fractional minutes), for picking the bucket
 * closest to noon within a calendar day. */
function hourOfDay(d: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(d);
  const hh = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  const mm = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
  return hh + mm / 60;
}

/** Pick the bucket closest to local noon — the middle of the open hours — so
 * a date/week tick sits over live data instead of the overnight-closed hatch. */
function closestToNoon(buckets: Array<HistoryBucket>, timeZone: string): Date {
  let best = buckets[0]!;
  let bestDist = Infinity;
  for (const b of buckets) {
    const dist = Math.abs(hourOfDay(new Date(b.bucket), timeZone) - 12);
    if (dist < bestDist) {
      bestDist = dist;
      best = b;
    }
  }
  return new Date(best.bucket);
}

const isSunday = (d: Date, timeZone: string) =>
  new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone }).format(d) === "Sun";

/**
 * One tick per calendar day — no intra-day ticks, so a multi-day window never
 * repeats the same date. Anchored to the bucket closest to local noon rather
 * than the day's first bucket (near midnight, inside the overnight closed
 * band), so the date label sits over live data instead of the hatch.
 */
function buildDateTicks(grid: Array<HistoryBucket>, timeZone: string): Array<Date> {
  const byDay = new Map<string, Array<HistoryBucket>>();
  for (const d of grid) {
    const key = dayKey(new Date(d.bucket), timeZone);
    const list = byDay.get(key);
    if (list) list.push(d);
    else byDay.set(key, [d]);
  }
  return [...byDay.values()].map((buckets) => closestToNoon(buckets, timeZone));
}

/**
 * One tick per week, anchored on Sundays — a daily tick over 30 days is too
 * dense to read, so this trades granularity for legibility.
 */
function buildWeekTicks(grid: Array<HistoryBucket>, timeZone: string): Array<Date> {
  const byWeek = new Map<string, Array<HistoryBucket>>();
  for (const d of grid) {
    const date = new Date(d.bucket);
    if (!isSunday(date, timeZone)) continue;
    const key = dayKey(date, timeZone);
    const list = byWeek.get(key);
    if (list) list.push(d);
    else byWeek.set(key, [d]);
  }
  return [...byWeek.values()].map((buckets) => closestToNoon(buckets, timeZone));
}

function WaitTrendChart({
  data,
  timeZone,
  hours,
}: {
  data: Array<HistoryBucket>;
  timeZone: string;
  hours: TrendWindow;
}) {
  const tip = useChartTooltip<HistoryBucket>();
  // Fill entirely-missing buckets so a collection gap is an explicit hole the
  // indicative-series treatment can bridge, not a silent straight-line jump.
  const grid = React.useMemo(() => fillGrid(data, BUCKET_MS[hours]), [data, hours]);
  const { values, kinds, hasLive } = React.useMemo(
    () =>
      indicativeSeries(
        grid.map((d) => ({ value: d.avgWait })),
        0,
      ),
    [grid],
  );
  const runs = React.useMemo(() => strokeRuns(kinds), [kinds]);

  if (!hasLive || grid.length < 2)
    return <ChartEmpty label="Not enough wait history yet." height={CHART_H} />;

  const margin = { top: 10, right: 10, bottom: 22, left: 30 };
  const timeTickFmt = (v: Date) => v.toLocaleTimeString("en-US", { hour: "numeric", timeZone });
  const dateTickFmt = (v: Date) =>
    v.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone });
  const weekTickFmt = (v: Date) =>
    `Week of ${v.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone })}`;
  // 24h → clock-time ticks. 7d → one tick per date change. 30d → a daily tick
  // is too dense to read, so it steps up to one tick per week (on Sundays).
  const tickMode: "time" | "day" | "week" = hours === 24 ? "time" : hours === 720 ? "week" : "day";

  return (
    <ChartFrame height={CHART_H_RESPONSIVE}>
      {({ width, height }) => {
        const narrow = width < 480;
        const tick = narrow ? MOBILE_TICK : 11;
        const innerW = Math.max(0, width - margin.left - margin.right);
        const innerH = Math.max(0, height - margin.top - margin.bottom);
        const x = scaleTime({
          domain: [new Date(grid[0]!.bucket), new Date(grid[grid.length - 1]!.bucket)],
          range: [0, innerW],
        });
        const yMax = d3max(grid, (d) => d.maxWait ?? d.avgWait ?? 0) ?? 0;
        const y = scaleLinear({ domain: [0, yMax * 1.1 || 1], range: [innerH, 0], nice: true });

        const dateTicks =
          tickMode === "week"
            ? buildWeekTicks(grid, timeZone)
            : tickMode === "day"
              ? buildDateTicks(grid, timeZone)
              : null;

        const onMove = (e: React.MouseEvent | React.TouchEvent) => {
          const pt = localPoint(e);
          if (!pt) return;
          const date = x.invert(pt.x - margin.left);
          const idx = bisectTrend(grid, date, 1);
          const a = grid[idx - 1];
          const b = grid[idx];
          const d =
            !b ||
            (a &&
              date.getTime() - new Date(a.bucket).getTime() <
                new Date(b.bucket).getTime() - date.getTime())
              ? a
              : b;
          if (!d) return;
          tip.show(d, clientXY(e));
        };

        return (
          <div className="relative h-full w-full">
            <svg width={width} height={height}>
              <LinearGradient
                id="ride-trend-fill"
                from={PRIMARY}
                to={PRIMARY}
                fromOpacity={0.4}
                toOpacity={0.02}
              />
              <PatternLines
                id="ride-trend-hatch"
                height={6}
                width={6}
                stroke="color-mix(in srgb, var(--muted-foreground) 20%, transparent)"
                strokeWidth={1}
                orientation={["diagonal"]}
              />
              <Group left={margin.left} top={margin.top}>
                <GridRows
                  scale={y}
                  width={innerW}
                  stroke={GRID_INK}
                  strokeOpacity={0.5}
                  numTicks={4}
                />
                {/* hatch band behind every bridged (non-live) run */}
                {runs
                  .filter((run) => run.bridge)
                  .map((run) => {
                    const x0 = x(new Date(grid[run.idx[0]!]!.bucket));
                    const x1 = x(new Date(grid[run.idx[run.idx.length - 1]!]!.bucket));
                    return (
                      <rect
                        key={run.idx[0]}
                        x={Math.min(x0, x1)}
                        y={0}
                        width={Math.max(2, Math.abs(x1 - x0))}
                        height={innerH}
                        fill="url(#ride-trend-hatch)"
                      />
                    );
                  })}
                {/* min–max spread band + soft fill: live runs only, so a bridged
                    stretch never implies a real reading */}
                {runs
                  .filter((run) => !run.bridge)
                  .map((run) => {
                    const runData = run.idx.map((i) => grid[i]!);
                    return (
                      <React.Fragment key={run.idx[0]}>
                        <Area
                          data={runData}
                          x={(d) => x(new Date(d.bucket))}
                          y0={(d) => y(d.minWait ?? d.avgWait ?? 0)}
                          y1={(d) => y(d.maxWait ?? d.avgWait ?? 0)}
                          curve={curveMonotoneX}
                          fill={PRIMARY}
                          fillOpacity={0.12}
                        />
                        <AreaClosed
                          data={runData}
                          x={(d) => x(new Date(d.bucket))}
                          y={(d) => y(d.avgWait ?? 0)}
                          yScale={y}
                          curve={curveMonotoneX}
                          fill="url(#ride-trend-fill)"
                        />
                      </React.Fragment>
                    );
                  })}
                {/* average line: solid where live, dashed + faded across bridged gaps */}
                {runs.map((run, i) => (
                  <LinePath
                    key={i}
                    data={run.idx.map((idx) => ({ t: grid[idx]!.bucket, v: values[idx]! }))}
                    x={(d) => x(new Date(d.t))}
                    y={(d) => y(d.v)}
                    curve={curveMonotoneX}
                    stroke={PRIMARY}
                    strokeWidth={1.75}
                    strokeOpacity={run.bridge ? 0.55 : 1}
                    strokeDasharray={run.bridge ? "3 3" : undefined}
                  />
                ))}
                <AxisBottom
                  top={innerH}
                  scale={x}
                  {...(dateTicks
                    ? { tickValues: dateTicks }
                    : { numTicks: Math.max(2, Math.floor(innerW / 70)) })}
                  stroke={GRID_INK}
                  hideTicks
                  tickFormat={(v) =>
                    tickMode === "week"
                      ? weekTickFmt(v as Date)
                      : tickMode === "day"
                        ? dateTickFmt(v as Date)
                        : timeTickFmt(v as Date)
                  }
                  tickLabelProps={(_v, i, allTicks) => {
                    // Edge ticks anchor inward so a full date/week label never
                    // overflows past the card's clipped edge.
                    const anchor = i === 0 ? "start" : i === allTicks.length - 1 ? "end" : "middle";
                    return tickLabelProps({ textAnchor: anchor, dy: "0.25em" }, tick);
                  }}
                />
                <AxisLeft
                  scale={y}
                  numTicks={4}
                  hideTicks
                  hideAxisLine
                  tickLabelProps={() =>
                    tickLabelProps({ textAnchor: "end", dx: "-0.25em", dy: "0.3em" }, tick)
                  }
                />
                {tip.data && (
                  <g>
                    <Line
                      from={{ x: x(new Date(tip.data.bucket)), y: 0 }}
                      to={{ x: x(new Date(tip.data.bucket)), y: innerH }}
                      stroke={AXIS_INK}
                      strokeWidth={1}
                      strokeDasharray="3 3"
                      strokeOpacity={0.6}
                      pointerEvents="none"
                    />
                    {tip.data.avgWait != null && (
                      <Circle
                        cx={x(new Date(tip.data.bucket))}
                        cy={y(tip.data.avgWait)}
                        r={3.5}
                        fill={PRIMARY}
                        stroke="var(--background)"
                        strokeWidth={1.5}
                      />
                    )}
                  </g>
                )}
                <Bar
                  width={innerW}
                  height={innerH}
                  fill="transparent"
                  onMouseMove={onMove}
                  onTouchMove={onMove}
                  onMouseLeave={tip.hide}
                />
              </Group>
            </svg>
            <tip.Tooltip>
              {(d) => (
                <div className="flex w-full flex-col gap-0.5">
                  <span className="font-medium text-foreground">
                    {new Date(d.bucket).toLocaleString("en-US", {
                      month: "short",
                      day: "numeric",
                      hour: "numeric",
                      minute: hours <= 24 ? "2-digit" : undefined,
                      timeZone,
                    })}
                  </span>
                  {d.avgWait == null ? (
                    <span className="text-muted-foreground">No live reading</span>
                  ) : (
                    <>
                      <span className="text-foreground">
                        <span className="font-mono font-medium tabular-nums">{d.avgWait}</span>{" "}
                        <span className="text-muted-foreground">min avg standby</span>
                      </span>
                      {d.minWait != null && d.maxWait != null && d.maxWait > d.minWait && (
                        <span className="text-muted-foreground">
                          ranged {d.minWait}–{d.maxWait} min
                        </span>
                      )}
                    </>
                  )}
                </div>
              )}
            </tip.Tooltip>
          </div>
        );
      }}
    </ChartFrame>
  );
}

function WaitTrendCard({ attractionId, timeZone }: { attractionId: number; timeZone: string }) {
  const trpc = useTRPC();
  const [hours, setHours] = React.useState<TrendWindow>(24);
  const q = useQuery({
    ...trpc.parks.history.queryOptions({ attractionId, queueType: 1, hours }),
    enabled: attractionId > 0,
  });
  return (
    <AnalyticsCard
      title="Wait trend"
      description={`Standby over the last ${WINDOW_LABEL[hours]} · band shows the in-bucket range`}
      action={
        <ToggleGroup
          multiple={false}
          value={[String(hours)]}
          onValueChange={(v) => setHours((Number(v[0]) || 24) as TrendWindow)}
          variant="outline"
          size="sm"
        >
          <ToggleGroupItem value="24">24h</ToggleGroupItem>
          <ToggleGroupItem value="168">7d</ToggleGroupItem>
          <ToggleGroupItem value="720">30d</ToggleGroupItem>
        </ToggleGroup>
      }
    >
      {q.isLoading ? (
        <ChartEmpty label="Loading…" height={CHART_H} />
      ) : (
        <WaitTrendChart data={q.data ?? []} timeZone={timeZone} hours={hours} />
      )}
    </AnalyticsCard>
  );
}

// ───────────────────────── 2 & 3. Hour-of-day / weekday bars ──────────────────
type BarDatum = { key: string; label: string; avgWait: number; peak: number; samples: number };

function VerticalBars({ data, unit }: { data: Array<BarDatum>; unit: string }) {
  const tip = useChartTooltip<BarDatum>();
  if (data.length === 0) return <ChartEmpty label="Not enough history yet." height={CHART_H} />;

  const margin = { top: 10, right: 8, bottom: 22, left: 30 };
  const max = d3max(data, (d) => d.avgWait) ?? 0;

  return (
    <ChartFrame height={CHART_H_RESPONSIVE}>
      {({ width, height }) => {
        const narrow = width < 480;
        const tick = narrow ? MOBILE_TICK : 11;
        const innerW = Math.max(0, width - margin.left - margin.right);
        const innerH = Math.max(0, height - margin.top - margin.bottom);
        const x = scaleBand({ domain: data.map((d) => d.key), range: [0, innerW], padding: 0.22 });
        const y = scaleLinear({ domain: [0, max * 1.1 || 1], range: [innerH, 0], nice: true });
        const bw = x.bandwidth();
        // Thin the x labels if they'd collide (24 hour buckets on a narrow card).
        const everyNth = Math.max(1, Math.ceil((data.length * 26) / Math.max(1, innerW)));

        return (
          <div className="relative h-full w-full">
            <svg width={width} height={height}>
              <Group left={margin.left} top={margin.top}>
                <GridRows
                  scale={y}
                  width={innerW}
                  stroke={GRID_INK}
                  strokeOpacity={0.5}
                  numTicks={4}
                />
                {data.map((d, i) => {
                  const bx = x(d.key) ?? 0;
                  const by = y(d.avgWait);
                  return (
                    <Group key={d.key}>
                      {/* Full-height hit target so the whole column is hoverable. */}
                      <Bar
                        x={bx}
                        y={0}
                        width={bw}
                        height={innerH}
                        fill="transparent"
                        onMouseMove={(e) => tip.show(d, clientXY(e))}
                        onTouchStart={(e) => tip.show(d, clientXY(e))}
                        onMouseLeave={tip.hide}
                      />
                      <Bar
                        x={bx}
                        y={by}
                        width={bw}
                        height={Math.max(0, innerH - by)}
                        rx={3}
                        fill={intensityColor(max > 0 ? d.avgWait / max : 0)}
                        onMouseMove={(e) => tip.show(d, clientXY(e))}
                        onTouchStart={(e) => tip.show(d, clientXY(e))}
                        onMouseLeave={tip.hide}
                      />
                      {i % everyNth === 0 && (
                        <text
                          x={bx + bw / 2}
                          y={innerH + 14}
                          textAnchor="middle"
                          fontSize={narrow ? 11 : 10}
                          fill={AXIS_INK}
                        >
                          {d.label}
                        </text>
                      )}
                    </Group>
                  );
                })}
                <AxisLeft
                  scale={y}
                  numTicks={4}
                  hideTicks
                  hideAxisLine
                  tickLabelProps={() =>
                    tickLabelProps({ textAnchor: "end", dx: "-0.25em", dy: "0.3em" }, tick)
                  }
                />
              </Group>
            </svg>
            <tip.Tooltip>
              {(d) => (
                <div className="flex w-full flex-col gap-0.5">
                  <span className="font-medium text-foreground">{d.label}</span>
                  <span className="text-foreground">
                    <span className="font-mono font-medium tabular-nums">{d.avgWait} min</span>{" "}
                    <span className="text-muted-foreground">avg standby</span>
                  </span>
                  <span className="text-muted-foreground">
                    peak {d.peak} min · {d.samples.toLocaleString()} {unit}
                  </span>
                </div>
              )}
            </tip.Tooltip>
          </div>
        );
      }}
    </ChartFrame>
  );
}

// ───────────────────────── 4. Crowd calendar (heatmap) ────────────────────────
function RideHeatmap({ data }: { data: Array<{ date: string; hour: number; avgWait: number }> }) {
  const tip = useChartTooltip<{ day: string; hour: number; avgWait: number }>();
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

  if (data.length === 0)
    return <ChartEmpty label="Not enough history for a calendar yet." height={CHART_H} />;

  const cellColor = (v: number | undefined) =>
    v == null ? "var(--muted)" : intensityColor(max > 0 ? v / max : 0);
  const dayLabel = (d: string) =>
    new Date(`${d}T12:00:00`).toLocaleDateString("en-US", { weekday: "short", day: "numeric" });

  return (
    <div className="flex h-[220px] flex-col gap-1.5 px-2 pt-1">
      <div className="flex min-h-0 flex-1 flex-col">
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
                    onMouseMove={
                      v != null
                        ? (e) => tip.show({ day: dayLabel(d), hour: h, avgWait: v }, clientXY(e))
                        : undefined
                    }
                    onTouchStart={
                      v != null
                        ? (e) => tip.show({ day: dayLabel(d), hour: h, avgWait: v }, clientXY(e))
                        : undefined
                    }
                    onMouseLeave={tip.hide}
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
      <tip.Tooltip>
        {(c) => (
          <div className="flex w-full flex-col gap-0.5">
            <span className="font-medium text-foreground">
              {c.day} · {hourLabel(c.hour)}
            </span>
            <span className="text-foreground">
              <span className="font-mono font-medium tabular-nums">{c.avgWait} min</span>{" "}
              <span className="text-muted-foreground">avg standby</span>
            </span>
          </div>
        )}
      </tip.Tooltip>
    </div>
  );
}

// ───────────────────────── Section ───────────────────────────────────────────
/**
 * Per-ride analysis charts for the attraction detail page: a windowed wait
 * trend (off `parks.history`) plus hour-of-day, day-of-week, and crowd-calendar
 * rollups from `parks.rideAnalytics`. Each chart is error-isolated by its
 * `AnalyticsCard`, mirroring the park-level analytics grid.
 */
export function RideAnalytics({
  attractionId,
  timezone,
}: {
  attractionId: number;
  timezone: string;
}) {
  const trpc = useTRPC();
  const q = useQuery({
    ...trpc.parks.rideAnalytics.queryOptions({ attractionId }),
    enabled: attractionId > 0,
  });

  const hourly: Array<BarDatum> = React.useMemo(
    () =>
      (q.data?.hourly ?? []).map((h) => ({
        key: String(h.hour),
        label: hourLabel(h.hour),
        avgWait: h.avgWait,
        peak: h.peak,
        samples: h.samples,
      })),
    [q.data],
  );
  const weekday: Array<BarDatum> = React.useMemo(
    () =>
      (q.data?.weekday ?? []).map((w) => ({
        key: String(w.dow),
        label: DOW_LABELS[w.dow] ?? String(w.dow),
        avgWait: w.avgWait,
        peak: w.peak,
        samples: w.samples,
      })),
    [q.data],
  );

  const tz = q.data?.timezone ?? timezone;

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold tracking-tight">Wait analysis</h2>
        <p className="text-sm text-muted-foreground">
          How this ride&rsquo;s standby wait has moved across its recent history.
        </p>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="lg:col-span-2">
          <WaitTrendCard attractionId={attractionId} timeZone={tz} />
        </div>
        <AnalyticsCard title="Best time to ride" description="Avg standby by hour of day · 30 days">
          <VerticalBars data={hourly} unit="readings" />
        </AnalyticsCard>
        <AnalyticsCard title="By day of week" description="Avg standby by weekday · 30 days">
          <VerticalBars data={weekday} unit="readings" />
        </AnalyticsCard>
        <div className="lg:col-span-2">
          <AnalyticsCard
            title="Crowd calendar"
            description="Avg standby by day & hour (park local) · 14 days"
          >
            <RideHeatmap data={q.data?.heatmap ?? []} />
          </AnalyticsCard>
        </div>
      </div>
    </section>
  );
}
