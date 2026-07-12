"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { motion } from "motion/react";
import { bisector, extent } from "d3-array";
import { AxisBottom, AxisRight } from "@visx/axis";
import { Brush } from "@visx/brush";
import { curveMonotoneX } from "@visx/curve";
import { localPoint } from "@visx/event";
import { GridRows } from "@visx/grid";
import { Group } from "@visx/group";
import { PatternLines } from "@visx/pattern";
import { scaleLinear, scaleTime } from "@visx/scale";
import { Bar, Circle, Line, LinePath } from "@visx/shape";
import { MinusIcon, TrendingDownIcon, TrendingUpIcon } from "lucide-react";

import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "#/components/ui/card.tsx";
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

import { isSingleRiderName, isUniversal, paidLineProduct } from "./lightning-lane.ts";
import { rideColor } from "./ride-colors.ts";
import { indicativeSeries, strokeRuns } from "./visx/indicative.ts";
import {
  AXIS_INK,
  chartMargin,
  GRID_INK,
  MOBILE_TICK,
  PRIMARY,
  TooltipCard,
  tickLabelProps,
} from "./visx/kit.tsx";

type Metric = "wait" | "price" | "count";

function getQueueOptions(operatorSlug?: string | null) {
  const paidLabel = paidLineProduct(operatorSlug);
  return [
    { value: "1", label: "Standby wait", mode: "wait" as Metric },
    isUniversal(operatorSlug)
      ? { value: "3", label: paidLabel, mode: "wait" as Metric }
      : // Disney Lightning Lane reads as the whole-park count of currently
        // available Lightning Lanes (across LL Multi + Single) — the raw number
        // behind availability, not the à-la-carte LL Single price.
        { value: "4", label: paidLabel, mode: "count" as Metric },
  ];
}

const RANGE_HOURS: Record<string, number> = { "24h": 24, "7d": 168, "30d": 720 };

// Reserved series key for the whole-park average line.
const AVG_KEY = "__avg";
// Cap how many ride rows the tooltip lists (busiest-first) before collapsing the
// rest into a single "+N more" line — otherwise enabling the whole roster makes
// the tooltip overflow the card and swamp the legend below it.
const MAX_TOOLTIP_RIDES = 7;

// Chart geometry. The card reserves a ~204px band: a line plot, a slim brush
// context strip beneath it, then the always-on legend below.
const PLOT_H = 152;
const BRUSH_H = 34;
const BRUSH_GAP = 14;
// left/right come from `chartMargin(width)`; top/bottom are fixed here.
const MARGIN = { top: 8, bottom: 20 };
// Below this width the brush is dropped — precise pinch-brushing is a desktop
// affordance, and the 24h/7d/30d presets cover ranging on a phone.
const BRUSH_MIN_W = 480;

type Row = Record<string, number | string | boolean | null> & {
  bucket: string;
  status?: "open" | "closed";
  t: number;
};

/**
 * The ride-series toggle list, rendered below the chart as wrapping chips
 * (`layout="wrap"`) so every ride stays visible at any card width.
 */
function RideLegend({
  rides,
  enabled,
  colorOf,
  trendOf,
  toggle,
  layout = "list",
}: {
  rides: Array<{ id: number; name: string }>;
  enabled: Set<number>;
  colorOf: (id: number) => string;
  trendOf: (id: number) => "up" | "down" | "flat";
  toggle: (id: number) => void;
  layout?: "list" | "wrap";
}) {
  const wrap = layout === "wrap";
  return (
    <div className={cn(wrap ? "flex flex-wrap gap-1 p-1.5" : "flex flex-col gap-0.5 p-1")}>
      {rides.map((r) => {
        const on = enabled.has(r.id);
        const trend = trendOf(r.id);
        // Rising waits read as "worse" (rose), falling as "better" (emerald),
        // flat as muted. Colour only — the live value stays off the row to keep
        // the ride name room to breathe.
        const TrendIcon =
          trend === "up" ? TrendingUpIcon : trend === "down" ? TrendingDownIcon : MinusIcon;
        return (
          <button
            key={r.id}
            type="button"
            onClick={() => toggle(r.id)}
            aria-pressed={on}
            title={r.name}
            className={cn(
              "flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors hover:bg-muted/50",
              wrap ? "w-auto max-w-[14rem] border bg-background/40" : "w-full",
              on ? "text-foreground" : "text-muted-foreground",
            )}
          >
            <span
              className="size-2.5 shrink-0 rounded-[3px]"
              style={{ backgroundColor: colorOf(r.id), opacity: on ? 1 : 0.35 }}
            />
            <span className="min-w-0 flex-1 truncate">{r.name}</span>
            <TrendIcon
              className={cn(
                "size-3.5 shrink-0",
                trend === "up"
                  ? "text-rose-500 dark:text-rose-400"
                  : trend === "down"
                    ? "text-emerald-500 dark:text-emerald-400"
                    : "text-muted-foreground/50",
              )}
              aria-label={
                trend === "up" ? "Trending up" : trend === "down" ? "Trending down" : "Steady"
              }
            />
          </button>
        );
      })}
    </div>
  );
}

const bisectT = bisector<Row, number>((d) => d.t).left;

/**
 * One ride series, drawn so it never breaks: live readings stroke solid, and
 * stretches with no live reading — mid-day downtime gaps or park-closed buckets
 * (sunk to the 0 baseline) — bridge with a faded dashed stroke. Same visual
 * grammar as the row sparklines, so the board and the chart tell one story.
 */
function IndicativeLine({
  rows,
  seriesKey,
  x,
  y,
  color,
  strokeWidth,
  strokeOpacity = 1,
}: {
  rows: Array<Row>;
  seriesKey: string;
  x: (d: Date) => number;
  y: (v: number) => number;
  color: string;
  strokeWidth: number;
  strokeOpacity?: number;
}) {
  const runs = React.useMemo(() => {
    const { values, kinds } = indicativeSeries(
      rows.map((r) =>
        r.status === "closed"
          ? { value: null, closed: true }
          : { value: typeof r[seriesKey] === "number" ? (r[seriesKey] as number) : null },
      ),
      0,
    );
    return strokeRuns(kinds).map((run) => ({
      bridge: run.bridge,
      data: run.idx.map((i) => ({ t: rows[i].t, v: values[i] })),
    }));
  }, [rows, seriesKey]);

  return (
    <>
      {runs.map((run, i) => (
        <LinePath
          key={i}
          data={run.data}
          x={(d) => x(new Date(d.t))}
          y={(d) => y(d.v)}
          curve={curveMonotoneX}
          stroke={color}
          strokeWidth={strokeWidth}
          strokeOpacity={strokeOpacity * (run.bridge ? 0.5 : 1)}
          strokeDasharray={run.bridge ? "3 3" : undefined}
        />
      ))}
    </>
  );
}

/**
 * The SVG plot: park-average + enabled ride lines, closed-hours shading, a
 * hover cursor with a multi-series readout, and a brush strip below for zooming
 * the visible time window.
 */
function WaitPlot({
  width,
  rows,
  enabledRides,
  colorOf,
  chartLabels,
  focusedId,
  mode,
  tz,
  hours,
}: {
  width: number;
  rows: Array<Row>;
  enabledRides: Array<{ id: number; name: string }>;
  colorOf: (id: number) => string;
  chartLabels: Record<string, string>;
  focusedId: number | null;
  mode: Metric;
  tz: string;
  hours: number;
}) {
  // Brush selection in timestamp space; null = full range.
  const [sel, setSel] = React.useState<{ x0: number; x1: number } | null>(null);
  // A new park / range / metric resets any zoom.
  const resetKey = `${rows.length}:${mode}:${hours}`;
  React.useEffect(() => setSel(null), [resetKey]);

  const [hover, setHover] = React.useState<{ row: Row; left: number } | null>(null);

  const narrow = width < BRUSH_MIN_W;
  const tick = narrow ? MOBILE_TICK : 11;
  const margin = { ...MARGIN, ...chartMargin(width) };
  const showBrush = !narrow;
  // Vertical chrome below the plot: the brush strip + its gap, dropped on mobile.
  const chromeH = showBrush ? BRUSH_GAP + BRUSH_H : 0;
  const svgH = PLOT_H + chromeH + 20;

  const innerW = Math.max(0, width - margin.left - margin.right);
  const fullExtent = extent(rows, (d) => d.t) as [number, number];

  const visibleRows = React.useMemo(() => {
    if (!sel) return rows;
    const out = rows.filter((r) => r.t >= sel.x0 && r.t <= sel.x1);
    return out.length >= 2 ? out : rows;
  }, [rows, sel]);

  // Y domain spans the average + every enabled ride across the visible window.
  // In count mode there are no per-ride series (enabledRides is empty), so this
  // maxes over just the whole-park available-count line.
  const yMax = React.useMemo(() => {
    let m = 0;
    const keys = [AVG_KEY, ...enabledRides.map((r) => String(r.id))];
    for (const row of visibleRows) {
      for (const k of keys) {
        const v = row[k];
        if (typeof v === "number" && v > m) m = v;
      }
    }
    return m;
  }, [visibleRows, enabledRides, mode]);

  const x = scaleTime({
    domain: (extent(visibleRows, (d) => d.t) as [number, number]).map((t) => new Date(t)) as [
      Date,
      Date,
    ],
    range: [0, innerW],
  });
  const y = scaleLinear({
    domain: [0, yMax * 1.1 || 1],
    range: [PLOT_H, 0],
    nice: true,
  });

  // Contiguous runs of closed buckets in view → shaded bands behind the lines.
  const closedBands = React.useMemo(() => {
    const bands: Array<{ x0: number; x1: number }> = [];
    let start: number | null = null;
    let prev: number | null = null;
    for (const r of visibleRows) {
      if (r.status === "closed") {
        if (start == null) start = r.t;
        prev = r.t;
      } else if (start != null) {
        bands.push({ x0: start, x1: prev! });
        start = null;
      }
    }
    if (start != null) bands.push({ x0: start, x1: prev! });
    return bands;
  }, [visibleRows]);

  // Per-ride point lists, nulls dropped so the line bridges collection gaps
  // (recharts `connectNulls`); calendar-closed buckets are zeroed numbers and so
  // stay in, dropping the line to the 0 baseline.
  const linePts = React.useCallback(
    (key: string) =>
      visibleRows.flatMap((r) =>
        typeof r[key] === "number" ? [{ t: r.t, v: r[key] as number }] : [],
      ),
    [visibleRows],
  );

  const valueFormatter = (v: number) =>
    mode === "price"
      ? `$${v.toFixed(2)}`
      : mode === "count"
        ? `${Math.round(v)} available`
        : `${v} min`;

  // Brush context: a slim overview across the FULL range. It mirrors the main
  // plot — the park average plus whatever ride series are enabled — so the strip
  // reflects the current view, not just the average.
  const brushX = scaleTime({
    domain: fullExtent.map((t) => new Date(t)) as [Date, Date],
    range: [0, innerW],
  });
  const brushKeys = [AVG_KEY, ...enabledRides.map((r) => String(r.id))];
  const brushYMax = React.useMemo(() => {
    let m = 0;
    for (const r of rows) {
      for (const k of brushKeys) {
        const v = r[k];
        if (typeof v === "number" && v > m) m = v;
      }
    }
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, mode, brushKeys.join(",")]);
  const brushY = scaleLinear({
    domain: [0, brushYMax || 1],
    range: [BRUSH_H, 0],
  });
  const brushPts = React.useCallback(
    (key: string) =>
      rows.flatMap((r) => (typeof r[key] === "number" ? [{ t: r.t, v: r[key] as number }] : [])),
    [rows],
  );

  const onHover = (e: React.MouseEvent | React.TouchEvent) => {
    const pt = localPoint(e);
    if (!pt) return;
    const date = x.invert(pt.x - margin.left);
    const idx = bisectT(visibleRows, date.getTime(), 1);
    const a = visibleRows[idx - 1];
    const b = visibleRows[idx];
    const row = !b || (a && date.getTime() - a.t < b.t - date.getTime()) ? a : b;
    if (!row) return;
    setHover({ row, left: x(new Date(row.t)) });
  };

  // Build the tooltip rows: park average first, then enabled rides busiest-first,
  // capped, with an overflow count.
  const tipRows = React.useMemo(() => {
    if (!hover) return null;
    const row = hover.row;
    if (row.status === "closed") return { closed: true as const, items: [], more: 0 };
    const items = enabledRides
      .map((r) => ({ id: r.id, value: row[String(r.id)] }))
      .filter((i): i is { id: number; value: number } => typeof i.value === "number")
      .sort((p, q) => q.value - p.value);
    const shown = items.slice(0, MAX_TOOLTIP_RIDES);
    return { closed: false as const, items: shown, more: items.length - shown.length };
  }, [hover, enabledRides]);

  const labelFor = (value: number) =>
    new Date(value).toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: hours <= 72 ? "2-digit" : undefined,
      timeZone: tz,
    });

  const avgVal = hover ? hover.row[AVG_KEY] : null;

  return (
    <div className="relative w-full" style={{ height: svgH }}>
      <svg width={width} height={svgH} className="overflow-visible">
        <PatternLines
          id="wait-closed-hatch"
          height={6}
          width={6}
          stroke="color-mix(in srgb, var(--muted-foreground) 20%, transparent)"
          strokeWidth={1}
          orientation={["diagonal"]}
        />
        <PatternLines
          id="wait-brush-pattern"
          height={8}
          width={8}
          stroke="color-mix(in srgb, var(--primary) 45%, transparent)"
          strokeWidth={1}
          orientation={["diagonal"]}
        />
        {/* ── main plot ── */}
        <Group left={margin.left} top={margin.top}>
          <GridRows scale={y} width={innerW} stroke={GRID_INK} strokeOpacity={0.5} numTicks={4} />
          {closedBands.map((b) => {
            const x0 = x(new Date(b.x0));
            const x1 = x(new Date(b.x1));
            return (
              <rect
                key={b.x0}
                x={Math.min(x0, x1)}
                y={0}
                width={Math.max(2, Math.abs(x1 - x0))}
                height={PLOT_H}
                fill="url(#wait-closed-hatch)"
              />
            );
          })}
          {/* enabled ride series — solid where live, dashed across bridged gaps */}
          {enabledRides.map((r) => {
            const isFocused = r.id === focusedId;
            const dim = focusedId != null && !isFocused;
            return (
              <IndicativeLine
                key={r.id}
                rows={visibleRows}
                seriesKey={String(r.id)}
                x={x}
                y={y}
                color={colorOf(r.id)}
                strokeWidth={isFocused ? 2.75 : 1.75}
                strokeOpacity={dim ? 0.35 : 1}
              />
            );
          })}
          {/* whole-park line always on top — dashed for an average, solid for the
              count metric (it's a running total, not an average of the series) */}
          <LinePath
            data={linePts(AVG_KEY)}
            x={(d) => x(new Date(d.t))}
            y={(d) => y(d.v)}
            curve={curveMonotoneX}
            stroke={PRIMARY}
            strokeWidth={2.75}
            strokeDasharray={mode === "count" ? undefined : "5 4"}
          />
          {/* hover cursor + dots */}
          {hover && (
            <g pointerEvents="none">
              <Line
                from={{ x: hover.left, y: 0 }}
                to={{ x: hover.left, y: PLOT_H }}
                stroke={AXIS_INK}
                strokeWidth={1}
                strokeDasharray="3 3"
                strokeOpacity={0.6}
              />
              {typeof avgVal === "number" && hover.row.status !== "closed" && (
                <Circle
                  cx={hover.left}
                  cy={y(avgVal)}
                  r={4}
                  fill={PRIMARY}
                  stroke="var(--background)"
                  strokeWidth={1.5}
                />
              )}
              {hover.row.status !== "closed" &&
                enabledRides.map((r) => {
                  const v = hover.row[String(r.id)];
                  if (typeof v !== "number") return null;
                  return (
                    <Circle
                      key={r.id}
                      cx={hover.left}
                      cy={y(v)}
                      r={3}
                      fill={colorOf(r.id)}
                      stroke="var(--background)"
                      strokeWidth={1.25}
                    />
                  );
                })}
            </g>
          )}
          <AxisRight
            left={innerW}
            scale={y}
            numTicks={4}
            hideTicks
            hideAxisLine
            tickFormat={(v) =>
              mode === "price" ? `$${v}` : mode === "count" ? `${Math.round(Number(v))}` : `${v}`
            }
            tickLabelProps={() =>
              tickLabelProps({ textAnchor: "end", dx: "2.2em", dy: "0.3em" }, tick)
            }
          />
          <AxisBottom
            top={PLOT_H}
            scale={x}
            numTicks={narrow ? 4 : Math.max(2, Math.floor(innerW / 80))}
            stroke={GRID_INK}
            hideTicks
            tickFormat={(v) =>
              hours <= 24
                ? (v as Date).toLocaleTimeString("en-US", {
                    hour: "numeric",
                    minute: "2-digit",
                    timeZone: tz,
                  })
                : (v as Date).toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                    timeZone: tz,
                  })
            }
            tickLabelProps={() => tickLabelProps({ textAnchor: "middle", dy: "0.25em" }, tick)}
          />
          <Bar
            width={innerW}
            height={PLOT_H}
            fill="transparent"
            onMouseMove={onHover}
            onTouchMove={onHover}
            onMouseLeave={() => setHover(null)}
          />
        </Group>

        {/* ── brush context strip (desktop only) ── */}
        {showBrush && (
          <Group left={margin.left} top={margin.top + PLOT_H + BRUSH_GAP}>
            <rect width={innerW} height={BRUSH_H} rx={6} fill="var(--muted)" fillOpacity={0.4} />
            {enabledRides.map((r) => (
              <LinePath
                key={r.id}
                data={brushPts(String(r.id))}
                x={(d) => brushX(new Date(d.t))}
                y={(d) => brushY(d.v)}
                curve={curveMonotoneX}
                stroke={colorOf(r.id)}
                strokeWidth={1}
                strokeOpacity={0.6}
              />
            ))}
            <LinePath
              data={brushPts(AVG_KEY)}
              x={(d) => brushX(new Date(d.t))}
              y={(d) => brushY(d.v)}
              curve={curveMonotoneX}
              stroke={PRIMARY}
              strokeWidth={1.5}
              strokeOpacity={0.85}
            />
            <Brush
              xScale={brushX}
              yScale={brushY}
              width={innerW}
              height={BRUSH_H}
              margin={{
                top: margin.top + PLOT_H + BRUSH_GAP,
                left: margin.left,
                right: margin.right,
                bottom: 0,
              }}
              handleSize={8}
              resizeTriggerAreas={["left", "right"]}
              brushDirection="horizontal"
              selectedBoxStyle={{
                fill: "url(#wait-brush-pattern)",
                stroke: PRIMARY,
                strokeWidth: 1,
              }}
              useWindowMoveEvents
              onChange={(domain) => {
                if (!domain) {
                  setSel(null);
                  return;
                }
                setSel({ x0: domain.x0, x1: domain.x1 });
              }}
              onClick={() => setSel(null)}
            />
          </Group>
        )}
      </svg>

      {/* tooltip */}
      {hover && tipRows && (
        <div
          className="pointer-events-none absolute top-0"
          style={{
            left: margin.left + hover.left,
            // Size to content (capped), not to the space left of the container edge.
            // Without this, an `absolute` box with only `left` set shrink-to-fits the
            // remaining width, so the card narrows the further right the pointer is.
            width: "max-content",
            maxWidth: "16rem",
            transform: `translateX(${hover.left > innerW / 2 ? "calc(-100% - 10px)" : "10px"})`,
          }}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 6 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            transition={{ type: "spring", stiffness: 460, damping: 26, mass: 0.6 }}
          >
            <TooltipCard className="min-w-36">
              <div className="mb-1 font-medium text-foreground">{labelFor(hover.row.t)}</div>
              {tipRows.closed ? (
                <span className="flex items-center gap-1.5 text-muted-foreground">
                  <span className="size-2 shrink-0 rounded-[2px] bg-muted-foreground/40" />
                  Park closed
                </span>
              ) : (
                <div className="grid gap-1">
                  {typeof avgVal === "number" && (
                    <div className="flex items-center justify-between gap-3">
                      <span className="flex items-center gap-1.5 text-muted-foreground">
                        <span
                          className="size-2 shrink-0 rounded-[2px]"
                          style={{ backgroundColor: PRIMARY }}
                        />
                        {mode === "count" ? "Lightning Lanes" : "Park average"}
                      </span>
                      <span className="font-mono font-medium tabular-nums text-foreground">
                        {valueFormatter(avgVal)}
                      </span>
                    </div>
                  )}
                  {tipRows.items.map((i) => (
                    <div key={i.id} className="flex items-center justify-between gap-3">
                      <span className="flex items-center gap-1.5 text-muted-foreground">
                        <span
                          className="size-2 shrink-0 rounded-[2px]"
                          style={{ backgroundColor: colorOf(i.id) }}
                        />
                        {chartLabels[String(i.id)] ?? i.id}
                      </span>
                      <span className="font-mono font-medium tabular-nums text-foreground">
                        {valueFormatter(i.value)}
                      </span>
                    </div>
                  ))}
                  {tipRows.more > 0 && (
                    <span className="text-muted-foreground">+{tipRows.more} more rides</span>
                  )}
                </div>
              )}
            </TooltipCard>
          </motion.div>
        </div>
      )}
    </div>
  );
}

export function ParkWaitChart({
  parkSlug,
  operatorSlug,
  focusedId,
  onClearFocus,
  className,
}: {
  parkSlug: string | null;
  operatorSlug?: string | null;
  focusedId: number | null;
  onClearFocus?: () => void;
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
      metric: mode,
      hours,
    }),
    enabled: !!parkSlug,
  });

  // Drop "<Ride> Single Rider" series — they're a separate upstream attraction
  // that duplicates the parent ride's line; the parent already carries it.
  const rides = React.useMemo(
    () => (historyQ.data?.rides ?? []).filter((r) => !isSingleRiderName(r.name)),
    [historyQ.data],
  );
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

  // Recent direction per ride for the legend's trend marker. Compares the latest
  // reading to one a few buckets back (smoothing out single-bucket jitter) over
  // the readings that actually landed — gaps are dropped, same as the sparkline.
  const ridesKey = rides.map((r) => r.id).join(",");
  const trendOf = React.useMemo(() => {
    const m = new Map<number, "up" | "down" | "flat">();
    for (const r of rides) {
      const series = points
        .map((p) => p[String(r.id)])
        .filter((v): v is number => typeof v === "number");
      if (series.length < 2) {
        m.set(r.id, "flat");
        continue;
      }
      const last = series[series.length - 1]!;
      const prev = series[Math.max(0, series.length - 4)]!;
      m.set(r.id, last > prev ? "up" : last < prev ? "down" : "flat");
    }
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [points, ridesKey]);

  // Augment each bucket with the whole-park average across rides so the chart
  // always carries a park-wide summary line over the individual ride series.
  const chartData = React.useMemo<Array<Row>>(() => {
    const ids = rides.map((r) => r.id);
    // How many consecutive buckets a ride's last reading stays "live" for the
    // park average before we drop it. Bounds carry-forward so a closed/down ride
    // doesn't keep inflating the average indefinitely.
    const STALE_BUCKETS = 2;
    const lastVal = new Map<number, number>();
    const lastSeen = new Map<number, number>();
    const rows = points.map((p, i) => {
      let reporting = false;
      for (const id of ids) {
        const v = p[String(id)];
        if (typeof v === "number") {
          lastVal.set(id, v);
          lastSeen.set(id, i);
          reporting = true;
        }
      }
      const open = !p.closed && reporting;
      const vals: Array<number> = [];
      if (open) {
        for (const id of ids) {
          const seen = lastSeen.get(id);
          if (seen != null && i - seen <= STALE_BUCKETS) vals.push(lastVal.get(id)!);
        }
      }
      const avg =
        open && vals.length > 0
          ? mode === "count"
            ? // A total, not an average: sum the per-ride 1/0 "available" flags
              // into the whole-park count of currently available Lightning Lanes.
              vals.reduce((a, b) => a + b, 0)
            : mode === "price"
              ? Number((vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(2))
              : Math.round(vals.reduce((a, b) => a + b, 0) / vals.length)
          : null;
      return { p, open, avg };
    });

    return rows.map((r) => {
      const t = new Date(r.p.bucket).getTime();
      // Open bucket: keep raw per-ride values. A missing reading mid-day is ride
      // downtime — left null so the line bridges it, not a break.
      if (r.open) return { ...r.p, t, status: "open" as const, [AVG_KEY]: r.avg };
      // Calendar says closed: floor every series to 0 so the lines sit on the
      // baseline and the tooltip reads "Park closed".
      if (r.p.closed) {
        const zeroed: Record<string, number> = { [AVG_KEY]: 0 };
        for (const id of ids) zeroed[String(id)] = 0;
        return { ...r.p, ...zeroed, t, status: "closed" as const };
      }
      // No data *and* no closure signal: a collection gap. Leave null so the line
      // bridges where it can and we never paint a phantom 0.
      return { ...r.p, t, status: "open" as const, [AVG_KEY]: null };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [points, ridesKey, mode]);

  const chartLabels = React.useMemo<Record<string, string>>(() => {
    const m: Record<string, string> = { [AVG_KEY]: "Park average" };
    rides.forEach((r) => {
      m[String(r.id)] = r.name;
    });
    return m;
  }, [rides]);

  // The viewer's comparison set — the rides explicitly toggled on from the
  // legend. Starts empty so the chart opens on just the park-average line, and
  // resets when the roster changes.
  const [enabled, setEnabled] = React.useState<Set<number>>(() => new Set());
  React.useEffect(() => {
    setEnabled(new Set());
  }, [ridesKey]);

  // Picking a ride on the map/board "solos" it: the chart shows only that ride,
  // overriding the comparison set without mutating it. Clicking away clears the
  // pick (focusedId → null) and the chart swaps back to the comparison set.
  const displayedIds = focusedId != null ? new Set<number>([focusedId]) : enabled;

  // Toggling from the legend builds a comparison: it releases any solo pick and
  // bases the new set on what's currently drawn, so the checkbox the viewer
  // clicks acts on the series they actually see.
  const toggle = (id: number) => {
    setEnabled(() => {
      const next = new Set(displayedIds);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    onClearFocus?.();
  };

  const allEnabled = rides.length > 0 && rides.every((r) => displayedIds.has(r.id));
  const toggleAll = () => {
    onClearFocus?.();
    setEnabled(allEnabled ? new Set() : new Set(rides.map((r) => r.id)));
  };

  // Pin axis/tooltip formatting to the park's timezone. This chart can render
  // during SSR, so a bare `toLocaleTimeString` would read UTC on the server and
  // the viewer's zone in the browser — the two disagree and trip a hydration
  // mismatch (#418). `tz` comes from the same query payload on both sides.
  const tz = historyQ.data?.timezone || "America/New_York";

  const metricNoun = mode === "price" ? "price" : "standby wait";
  const description =
    mode === "count" ? "Lightning Lanes available park-wide" : `Whole-park average ${metricNoun}`;

  // The whole-park line always leads (count total, or the average for wait); the
  // legend below lets the viewer toggle individual ride series on for comparison,
  // in every metric including count (each ride's line then reads as its own
  // availability over time).
  const enabledRides = rides.filter((r) => displayedIds.has(r.id));
  const hasData = chartData.length > 0 && rides.length > 0;

  return (
    <Card className={cn("@container/card flex flex-col", className)}>
      <CardHeader>
        <div className="min-w-0">
          <CardTitle className="truncate">
            {parkSlug ? "Park wait history" : "Wait History"}
          </CardTitle>
          <CardDescription className="truncate">{description}</CardDescription>
        </div>
        <CardAction className="flex flex-wrap items-center justify-end gap-2">
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
            className="flex *:data-[slot=toggle-group-item]:px-3!"
          >
            <ToggleGroupItem value="24h">24h</ToggleGroupItem>
            <ToggleGroupItem value="7d">7d</ToggleGroupItem>
            <ToggleGroupItem value="30d">30d</ToggleGroupItem>
          </ToggleGroup>
        </CardAction>
      </CardHeader>
      <CardContent className="flex min-h-0 flex-1 flex-col px-2 pt-4 sm:px-6 sm:pt-6">
        {!parkSlug ? (
          <Empty className="h-[394px]">
            <EmptyTitle>No park selected</EmptyTitle>
            <EmptyDescription>Pick a park to see its wait history.</EmptyDescription>
          </Empty>
        ) : historyQ.isLoading ? (
          // Mirror the loaded layout (chart + legend below) so the card keeps a
          // fixed height across the loading → loaded transition.
          <div className="flex min-h-0 min-w-0 flex-col gap-3">
            <Skeleton className="h-[200px] w-full" />
            <Skeleton className="h-[180px] w-full rounded-lg" />
          </div>
        ) : !hasData ? (
          <ConstructionState
            className="h-[394px]"
            title="Charting in progress"
            description={
              <>
                We&rsquo;re still gathering{" "}
                {mode === "price" ? "pricing" : mode === "count" ? "Lightning Lane" : "wait"}{" "}
                history for this park. Check back soon.
              </>
            }
          />
        ) : (
          <div className="flex min-h-0 min-w-0 flex-col gap-3">
            <ParentSizeWidth>
              {(width) =>
                width < 8 ? null : (
                  <WaitPlot
                    width={width}
                    rows={chartData}
                    enabledRides={enabledRides}
                    colorOf={colorOf}
                    chartLabels={chartLabels}
                    focusedId={focusedId}
                    mode={mode}
                    tz={tz}
                    hours={hours}
                  />
                )
              }
            </ParentSizeWidth>

            {/* Ride legend — wrapping chips below the chart at every size (and on
                mobile), so the viewer can filter which ride series are drawn in
                every metric, count included. */}
            <div
              className="flex h-[180px] flex-col overflow-hidden rounded-lg border bg-muted/20"
              role="group"
              aria-label="Toggle ride series"
            >
              {/* Header lives outside the scroll area so it's clipped by the
                  parent's rounded border and never reveals on overscroll. */}
              <div className="text-muted-foreground flex items-center justify-between gap-2 px-3 py-2 text-xs font-medium">
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
              <div
                className="flex min-h-0 flex-1 flex-col overflow-x-hidden overflow-y-auto overscroll-x-none"
                style={{
                  maskImage:
                    "linear-gradient(to bottom, transparent, #000 20px), linear-gradient(#000, #000)",
                  maskSize: "calc(100% - 12px) 100%, 12px 100%",
                  maskPosition: "left top, right top",
                  maskRepeat: "no-repeat",
                  WebkitMaskImage:
                    "linear-gradient(to bottom, transparent, #000 20px), linear-gradient(#000, #000)",
                  WebkitMaskSize: "calc(100% - 12px) 100%, 12px 100%",
                  WebkitMaskPosition: "left top, right top",
                  WebkitMaskRepeat: "no-repeat",
                }}
              >
                <RideLegend
                  rides={rides}
                  enabled={displayedIds}
                  colorOf={colorOf}
                  trendOf={(id) => trendOf.get(id) ?? "flat"}
                  toggle={toggle}
                  layout="wrap"
                />
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/** Width-only measuring wrapper (the plot fixes its own height). */
function ParentSizeWidth({ children }: { children: (width: number) => React.ReactNode }) {
  const ref = React.useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = React.useState(0);
  React.useEffect(() => {
    if (!ref.current) return;
    const el = ref.current;
    const ro = new ResizeObserver(([entry]) => {
      if (entry) setWidth(entry.contentRect.width);
    });
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  return (
    <div ref={ref} className="w-full">
      {children(width)}
    </div>
  );
}
