"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { bisector, max as d3max, min as d3min } from "d3-array";
import { AxisBottom, AxisLeft } from "@visx/axis";
import { curveMonotoneX } from "@visx/curve";
import { localPoint } from "@visx/event";
import { LinearGradient } from "@visx/gradient";
import { GridColumns, GridRows } from "@visx/grid";
import { Group } from "@visx/group";
import { hierarchy, Treemap, treemapSquarify } from "@visx/hierarchy";
import { PatternLines } from "@visx/pattern";
import { scaleBand, scaleLinear, scaleLog, scaleSqrt, scaleTime } from "@visx/scale";
import { Arc, AreaClosed, Bar, Circle, Line, LinePath } from "@visx/shape";
import { Text } from "@visx/text";

import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "#/components/ui/card.tsx";
import { Skeleton } from "#/components/ui/skeleton.tsx";
import { ToggleGroup, ToggleGroupItem } from "#/components/ui/toggle-group.tsx";
import { ChartErrorBoundary } from "#/components/chart-error-boundary.tsx";
import { useTRPC } from "#/integrations/trpc/react.ts";

import { isSingleRiderName } from "./lightning-lane.ts";
import { rideColor } from "./ride-colors.ts";
import {
  AXIS_INK,
  ChartEmpty,
  ChartFrame,
  ChartNoCharacters,
  clientXY,
  GRID_INK,
  PRIMARY,
  tickLabelProps,
  truncate,
  useChartTooltip,
} from "./visx/kit.tsx";

const CHART_H = 220;

// Short 12h label for an hour-of-day index (0–23): 0 -> "12a", 13 -> "1p".
function hourLabel(h: number): string {
  const period = h < 12 ? "a" : "p";
  const base = h % 12 === 0 ? 12 : h % 12;
  return `${base}${period}`;
}

// Shared "busy" ramp (green → amber → red), matching the crowd calendar so
// intensity reads the same way across every card. `t` is 0–1.
function intensityColor(t: number): string {
  const c = Math.max(0, Math.min(1, t));
  return `hsl(${Math.round(140 - 140 * c)} 72% ${Math.round(52 - 8 * c)}%)`;
}

function AnalyticsCard({
  title,
  description,
  action,
  children,
}: {
  title: string;
  description: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Card className="@container/analytics flex flex-col overflow-hidden">
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
        <CardDescription className="truncate">{description}</CardDescription>
        {action ? <CardAction className="self-center">{action}</CardAction> : null}
      </CardHeader>
      <CardContent className="flex min-h-0 flex-1 flex-col px-2 pb-4 sm:px-4">
        {/* Per-chart isolation: a crash in one chart can't take down the others,
            and the `[CHART-CRASH:<title>]` log names the culprit. */}
        <ChartErrorBoundary label={title} fallback={<ChartEmpty label="Chart unavailable." />}>
          {children}
        </ChartErrorBoundary>
      </CardContent>
    </Card>
  );
}

// ───────────────────────── 2. Average wait trend (area) ──────────────────────
type ActivityDatum = { bucket: string; rides: number; avgWait: number | null; closed: boolean };
const bisectBucket = bisector<ActivityDatum, Date>((d) => new Date(d.bucket)).left;

function ActivityChart({ data, timeZone }: { data: Array<ActivityDatum>; timeZone: string }) {
  // Sink calendar-closed buckets to the 0 baseline (same as the main wait chart)
  // so overnight closures drop the area to the floor instead of bridging across
  // them. Buckets with no reading that aren't closed are collection gaps — drop
  // those so the line bridges where it can rather than painting a phantom 0.
  const series = React.useMemo(
    () => data.map((d) => (d.closed ? { ...d, avgWait: 0 } : d)).filter((d) => d.avgWait != null),
    [data],
  );
  const tip = useChartTooltip<ActivityDatum>();

  if (series.length < 2) return <ChartEmpty label="No recent wait history yet." height={CHART_H} />;

  const margin = { top: 10, right: 8, bottom: 22, left: 28 };

  return (
    <ChartFrame height={CHART_H}>
      {({ width, height }) => {
        const innerW = Math.max(0, width - margin.left - margin.right);
        const innerH = Math.max(0, height - margin.top - margin.bottom);
        const x = scaleTime({
          domain: [new Date(series[0]!.bucket), new Date(series[series.length - 1]!.bucket)],
          range: [0, innerW],
        });
        const yMax = d3max(series, (d) => d.avgWait ?? 0) ?? 0;
        const y = scaleLinear({ domain: [0, yMax * 1.1 || 1], range: [innerH, 0], nice: true });

        const onMove = (e: React.MouseEvent | React.TouchEvent) => {
          const pt = localPoint(e);
          if (!pt) return;
          const date = x.invert(pt.x - margin.left);
          const idx = bisectBucket(series, date, 1);
          const a = series[idx - 1];
          const b = series[idx];
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
                id="area-trend-fill"
                from={PRIMARY}
                to={PRIMARY}
                fromOpacity={0.45}
                toOpacity={0.03}
              />
              <PatternLines
                id="area-trend-hatch"
                height={6}
                width={6}
                stroke="color-mix(in srgb, var(--primary) 14%, transparent)"
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
                <AreaClosed
                  data={series}
                  x={(d) => x(new Date(d.bucket))}
                  y={(d) => y(d.avgWait ?? 0)}
                  yScale={y}
                  curve={curveMonotoneX}
                  fill="url(#area-trend-fill)"
                />
                <AreaClosed
                  data={series}
                  x={(d) => x(new Date(d.bucket))}
                  y={(d) => y(d.avgWait ?? 0)}
                  yScale={y}
                  curve={curveMonotoneX}
                  fill="url(#area-trend-hatch)"
                />
                <LinePath
                  data={series}
                  x={(d) => x(new Date(d.bucket))}
                  y={(d) => y(d.avgWait ?? 0)}
                  curve={curveMonotoneX}
                  stroke={PRIMARY}
                  strokeWidth={1.75}
                />
                <AxisBottom
                  top={innerH}
                  scale={x}
                  numTicks={Math.max(2, Math.floor(innerW / 70))}
                  stroke={GRID_INK}
                  hideTicks
                  tickFormat={(v) =>
                    (v as Date).toLocaleDateString("en-US", { weekday: "short", timeZone })
                  }
                  tickLabelProps={() => tickLabelProps({ textAnchor: "middle", dy: "0.25em" })}
                />
                <AxisLeft
                  scale={y}
                  numTicks={4}
                  hideTicks
                  hideAxisLine
                  tickLabelProps={() =>
                    tickLabelProps({ textAnchor: "end", dx: "-0.25em", dy: "0.3em" })
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
                    <Circle
                      cx={x(new Date(tip.data.bucket))}
                      cy={y(tip.data.avgWait ?? 0)}
                      r={3.5}
                      fill={PRIMARY}
                      stroke="var(--background)"
                      strokeWidth={1.5}
                    />
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
                      timeZone,
                    })}
                  </span>
                  {d.closed ? (
                    <span className="flex items-center gap-1.5 text-muted-foreground">
                      <span className="size-2 shrink-0 rounded-[2px] bg-muted-foreground/40" />
                      Park closed
                    </span>
                  ) : (
                    <>
                      <span className="text-foreground">
                        <span className="font-mono font-medium tabular-nums">{d.avgWait}</span>{" "}
                        <span className="text-muted-foreground">min avg standby</span>
                      </span>
                      <span className="text-muted-foreground">across {d.rides} rides</span>
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

// ───────────────────────── 3. Crowd calendar (heatmap) ───────────────────────
function HeatmapChart({ data }: { data: Array<{ date: string; hour: number; avgWait: number }> }) {
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
                    onMouseMove={
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

// ───────────────────────── 4. Average wait by land (bar) ─────────────────────
type LandDatum = { land: string; avgWait: number; peak: number; rides: number };

function LandChart({ data }: { data: Array<LandDatum> }) {
  const tip = useChartTooltip<LandDatum>();
  if (data.length === 0)
    return <ChartEmpty label="No land-tagged rides for this park." height={CHART_H} />;

  const margin = { top: 6, right: 16, bottom: 22, left: 100 };

  return (
    <ChartFrame height={CHART_H}>
      {({ width, height }) => {
        const innerW = Math.max(0, width - margin.left - margin.right);
        const innerH = Math.max(0, height - margin.top - margin.bottom);
        const xMax = d3max(data, (d) => d.avgWait) ?? 0;
        const x = scaleLinear({ domain: [0, xMax * 1.05 || 1], range: [0, innerW], nice: true });
        const y = scaleBand({
          domain: data.map((d) => d.land),
          range: [0, innerH],
          padding: 0.28,
        });

        return (
          <div className="relative h-full w-full">
            <svg width={width} height={height}>
              <Group left={margin.left} top={margin.top}>
                <GridColumns
                  scale={x}
                  height={innerH}
                  stroke={GRID_INK}
                  strokeOpacity={0.5}
                  numTicks={4}
                />
                {data.map((d, i) => {
                  const barH = y.bandwidth();
                  const barW = x(d.avgWait);
                  const barY = y(d.land) ?? 0;
                  const color = rideColor(i);
                  return (
                    <Group key={d.land}>
                      {/* Full-width transparent hit target so the whole row is
                          hoverable, not just the (sometimes short) bar. */}
                      <Bar
                        x={0}
                        y={barY}
                        width={innerW}
                        height={barH}
                        fill="transparent"
                        onMouseMove={(e) => tip.show(d, clientXY(e))}
                        onMouseLeave={tip.hide}
                      />
                      <Bar
                        x={0}
                        y={barY}
                        width={barW}
                        height={barH}
                        fill={color}
                        rx={4}
                        onMouseMove={(e) => tip.show(d, clientXY(e))}
                        onMouseLeave={tip.hide}
                      />
                      <Text
                        x={barW + 6}
                        y={barY + barH / 2}
                        verticalAnchor="middle"
                        fontSize={11}
                        fill={AXIS_INK}
                        className="font-mono tabular-nums"
                      >
                        {`${d.avgWait}m`}
                      </Text>
                    </Group>
                  );
                })}
                <AxisLeft
                  scale={y}
                  hideTicks
                  hideAxisLine
                  tickFormat={(v) => truncate(String(v), 16)}
                  tickLabelProps={() =>
                    tickLabelProps({ textAnchor: "end", dx: "-0.4em", dy: "0.3em" })
                  }
                />
                <AxisBottom
                  top={innerH}
                  scale={x}
                  numTicks={4}
                  hideTicks
                  stroke={GRID_INK}
                  tickLabelProps={() => tickLabelProps({ textAnchor: "middle", dy: "0.25em" })}
                />
              </Group>
            </svg>
            <tip.Tooltip>
              {(d) => (
                <div className="flex w-full flex-col gap-0.5">
                  <span className="font-medium text-foreground">{d.land}</span>
                  <span className="text-muted-foreground">
                    avg <span className="text-foreground">{d.avgWait} min</span> · peak {d.peak} min
                    · {d.rides} rides
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

// ───────────────────────── 5. Daily rhythm (radial clock) ────────────────────
type RhythmKind = "attraction" | "character";
type RhythmDatum = { hour: number; avgWait: number; kind: RhythmKind };

// Rides and character meet-and-greets peak at very different times, so the card
// toggles between the two rather than averaging them into one misleading dial.
function RhythmCard({ data }: { data: Array<RhythmDatum> }) {
  const [kind, setKind] = React.useState<RhythmKind>("attraction");
  const series = React.useMemo(() => data.filter((d) => d.kind === kind), [data, kind]);
  return (
    <AnalyticsCard
      title="Daily rhythm"
      description="Avg standby around a 24-hour clock · 14 days"
      action={
        <ToggleGroup
          multiple={false}
          value={[kind]}
          onValueChange={(v) => setKind((v[0] as RhythmKind | undefined) ?? "attraction")}
          variant="outline"
          size="sm"
        >
          <ToggleGroupItem value="attraction">Rides</ToggleGroupItem>
          <ToggleGroupItem value="character">Characters</ToggleGroupItem>
        </ToggleGroup>
      }
    >
      {kind === "character" && series.length === 0 ? (
        <ChartNoCharacters height={CHART_H} />
      ) : (
        <RhythmChart data={series} />
      )}
    </AnalyticsCard>
  );
}

function RhythmChart({ data }: { data: Array<RhythmDatum> }) {
  const tip = useChartTooltip<RhythmDatum>();
  if (data.length < 4) return <ChartEmpty label="Not enough hours sampled yet." height={CHART_H} />;

  return (
    <ChartFrame height={CHART_H}>
      {({ width, height }) => {
        const cx = width / 2;
        const cy = height / 2;
        const R = Math.max(0, Math.min(width, height) / 2 - 22);
        const r0 = R * 0.34; // open center reads as a clock face
        const n = data.length;
        const maxV = d3max(data, (d) => d.avgWait) ?? 0;
        const rScale = scaleLinear({ domain: [0, maxV || 1], range: [r0, R] });
        const peak = data.reduce((m, d) => (d.avgWait > m.avgWait ? d : m), data[0]!);
        // d3 arc angles: 0 = 12 o'clock, increasing clockwise — so midnight sits
        // at the top and the day sweeps around like a real clock.
        const a0 = (i: number) => (i / n) * 2 * Math.PI;
        const a1 = (i: number) => ((i + 1) / n) * 2 * Math.PI;
        const rings = [0.34, 0.56, 0.78, 1];

        return (
          <div className="relative h-full w-full">
            <svg width={width} height={height}>
              <Group left={cx} top={cy}>
                {/* guide rings */}
                {rings.map((t) => (
                  <circle key={t} r={R * t} fill="none" stroke={GRID_INK} strokeOpacity={0.5} />
                ))}
                {/* one wedge per hour, length = avg wait, hue = intensity */}
                {data.map((d, i) => (
                  <Arc
                    key={d.hour}
                    innerRadius={r0}
                    outerRadius={Math.max(r0 + 0.5, rScale(d.avgWait))}
                    startAngle={a0(i)}
                    endAngle={a1(i)}
                    padAngle={0.018}
                    cornerRadius={2}
                    fill={intensityColor(maxV > 0 ? d.avgWait / maxV : 0)}
                    stroke="var(--background)"
                    strokeWidth={0.75}
                    onMouseMove={(e) => tip.show(d, clientXY(e))}
                    onMouseLeave={tip.hide}
                  />
                ))}
                {/* hour ticks every 3h around the dial */}
                {data.map((d, i) => {
                  if (d.hour % 3 !== 0) return null;
                  const a = (a0(i) + a1(i)) / 2;
                  const lr = R + 11;
                  return (
                    <Text
                      key={d.hour}
                      x={lr * Math.sin(a)}
                      y={-lr * Math.cos(a)}
                      textAnchor="middle"
                      verticalAnchor="middle"
                      fontSize={10}
                      fill={AXIS_INK}
                    >
                      {hourLabel(d.hour)}
                    </Text>
                  );
                })}
                {/* peak hour called out in the open center */}
                <Text
                  textAnchor="middle"
                  verticalAnchor="middle"
                  y={-6}
                  fontSize={10}
                  fill={AXIS_INK}
                >
                  busiest
                </Text>
                <Text
                  textAnchor="middle"
                  verticalAnchor="middle"
                  y={9}
                  fontSize={13}
                  fontWeight={600}
                  fill="var(--foreground)"
                >
                  {hourLabel(peak.hour)}
                </Text>
              </Group>
            </svg>
            <tip.Tooltip>
              {(d) => (
                <div className="flex w-full flex-col gap-0.5">
                  <span className="font-medium text-foreground">
                    {hourLabel(d.hour)} (park local)
                  </span>
                  <span className="text-foreground">
                    <span className="font-mono font-medium tabular-nums">{d.avgWait} min</span>{" "}
                    <span className="text-muted-foreground">avg standby</span>
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

// ───────────────────────── 6. Busy vs. volatile (scatter) ────────────────────
type ScatterDatum = {
  id: number;
  name: string;
  kind: RhythmKind;
  avgWait: number;
  volatility: number;
  peak: number;
};

// Fixed, human thresholds for the "plan around it" zone — busy *and* swingy.
const WAIT_HOT = 30;
const SWING_HOT = 10;

type Bubble = {
  d: ScatterDatum;
  color: string;
  r: number;
  ax: number; // anchor (true data) position
  ay: number;
  x: number; // relaxed position
  y: number;
};

/**
 * Beeswarm-style de-overlap. Busy rides also swing more, so they pile onto a
 * diagonal and overlap no matter the scale. We pull each bubble toward its true
 * (x, y) but push any overlapping pair apart, so every ride stays visible and
 * close to where its data puts it. Dependency-free; the roster is small (≈40).
 */
function relaxBubbles(bubbles: Array<Bubble>, w: number, h: number): Array<Bubble> {
  const PAD = 1.5;
  for (let it = 0; it < 180; it++) {
    for (const b of bubbles) {
      b.x += (b.ax - b.x) * 0.16;
      b.y += (b.ay - b.y) * 0.16;
    }
    for (let i = 0; i < bubbles.length; i++) {
      for (let j = i + 1; j < bubbles.length; j++) {
        const a = bubbles[i]!;
        const c = bubbles[j]!;
        let dx = c.x - a.x;
        let dy = c.y - a.y;
        let dist = Math.hypot(dx, dy);
        const min = a.r + c.r + PAD;
        if (dist < min) {
          // Coincident points (identical data) get a deterministic nudge so they
          // separate instead of dividing by zero.
          if (dist < 0.001) {
            dx = (i % 2 === 0 ? 1 : -1) * 0.5;
            dy = (j % 2 === 0 ? 1 : -1) * 0.5;
            dist = Math.hypot(dx, dy);
          }
          const shift = (min - dist) / dist / 2;
          a.x -= dx * shift;
          a.y -= dy * shift;
          c.x += dx * shift;
          c.y += dy * shift;
        }
      }
    }
    for (const b of bubbles) {
      b.x = Math.max(b.r, Math.min(w - b.r, b.x));
      b.y = Math.max(b.r, Math.min(h - b.r, b.y));
    }
  }
  return bubbles;
}

function ScatterAnalysis({ data, showZone }: { data: Array<ScatterDatum>; showZone: boolean }) {
  if (data.length === 0) return <ChartEmpty label="No samples yet." height={CHART_H} />;
  return (
    <ChartFrame height={CHART_H}>
      {({ width, height }) => (
        <ScatterPlot width={width} height={height} data={data} showZone={showZone} />
      )}
    </ChartFrame>
  );
}

// Rides and character meet-and-greets behave very differently, so the card
// toggles between the two rather than mixing them on one plot.
function ScatterCard({ data }: { data: Array<ScatterDatum> }) {
  const [kind, setKind] = React.useState<RhythmKind>("attraction");
  const series = React.useMemo(() => data.filter((d) => d.kind === kind), [data, kind]);
  return (
    <AnalyticsCard
      title="Busy vs. volatile"
      description="Avg wait (log) × swing, sized by peak · 7 days"
      action={
        <ToggleGroup
          multiple={false}
          value={[kind]}
          onValueChange={(v) => setKind((v[0] as RhythmKind | undefined) ?? "attraction")}
          variant="outline"
          size="sm"
        >
          <ToggleGroupItem value="attraction">Rides</ToggleGroupItem>
          <ToggleGroupItem value="character">Characters</ToggleGroupItem>
        </ToggleGroup>
      }
    >
      {/* The "busy + swingy" zone is keyed to ride-scale thresholds (30m / ±10m);
          it's meaningless for character meet-and-greets, so hide it there. */}
      {kind === "character" && series.length === 0 ? (
        <ChartNoCharacters height={CHART_H} />
      ) : (
        <ScatterAnalysis data={series} showZone={kind === "attraction"} />
      )}
    </AnalyticsCard>
  );
}

function ScatterPlot({
  width,
  height,
  data,
  showZone,
}: {
  width: number;
  height: number;
  data: Array<ScatterDatum>;
  showZone: boolean;
}) {
  const tip = useChartTooltip<ScatterDatum>();
  const margin = { top: 22, right: 18, bottom: 36, left: 40 };
  const innerW = Math.max(0, width - margin.left - margin.right);
  const innerH = Math.max(0, height - margin.top - margin.bottom);

  // Relax once per size/data change — NOT on every hover (tooltip state lives in
  // this component, so memoizing keeps the O(n²) solve off the mousemove path).
  const { bubbles, x, y, mx, my, xTicks, labeled } = React.useMemo(() => {
    const xMax = d3max(data, (d) => d.avgWait) ?? 0;
    const xMin = d3min(data, (d) => d.avgWait) ?? 0;
    const yMax = d3max(data, (d) => d.volatility) ?? 0;
    const pMax = d3max(data, (d) => d.peak) ?? 0;
    // Log x spreads the dense low-wait cluster; long-wait rides compress mildly.
    const lo = Math.max(1, Math.floor(xMin || 1));
    // With the zone shown, force the domain to include the thresholds so the
    // crosshair always has room; without it, just fit the data.
    const hi = showZone ? Math.max(xMax * 1.12, WAIT_HOT + 8) : Math.max(lo + 1, xMax * 1.12);
    const x = scaleLog({ domain: [lo, hi], range: [0, innerW] });
    const y = scaleLinear({
      domain: [0, showZone ? Math.max(yMax * 1.1, SWING_HOT + 2) : yMax * 1.1 || 1],
      range: [innerH, 0],
      nice: true,
    });
    const rad = scaleSqrt({ domain: [0, pMax || 1], range: [5, 15] });
    const xTicks = [2, 4, 6, 10, 15, 20, 30, 45, 60, 90].filter((v) => v >= lo && v <= hi);
    // Clamp into the log domain: a 0-wait ride (shows / meet-and-greets) would map
    // to log(0) = -Infinity → a NaN anchor that the collision step then smears
    // across every neighbour. Pin those to the left edge instead.
    const clampWait = (v: number) => Math.max(lo, Math.min(hi, v));
    const bubbles =
      innerW > 0 && innerH > 0
        ? relaxBubbles(
            data.map((d, i) => {
              const ax = x(clampWait(d.avgWait));
              const ay = y(d.volatility);
              return { d, color: rideColor(i), r: rad(d.peak), ax, ay, x: ax, y: ay };
            }),
            innerW,
            innerH,
          )
        : [];
    const labeled = new Set(
      [...data]
        .sort((a, b) => b.avgWait - a.avgWait)
        .slice(0, 3)
        .map((d) => d.id),
    );
    return { bubbles, x, y, mx: x(WAIT_HOT), my: y(SWING_HOT), xTicks, labeled };
  }, [data, innerW, innerH, showZone]);

  // Draw biggest-first so the small dots sit on top and stay hoverable.
  const drawOrder = [...bubbles].sort((a, b) => b.r - a.r);

  return (
    <div className="relative h-full w-full">
      <svg width={width} height={height}>
        {/* Caption above the y-axis, clear of the tick labels. */}
        <Text x={4} y={margin.top - 8} fontSize={10} fill={AXIS_INK}>
          swing (± min)
        </Text>
        <Group left={margin.left} top={margin.top}>
          {/* "busy & swingy" zone: avg > 30 min AND swing > ±10 min. Ride-scale
              thresholds, so it's only drawn for rides — not characters. */}
          {showZone ? (
            <rect
              x={mx}
              y={0}
              width={Math.max(0, innerW - mx)}
              height={my}
              fill={intensityColor(0.95)}
              fillOpacity={0.08}
            />
          ) : null}
          <GridRows scale={y} width={innerW} stroke={GRID_INK} strokeOpacity={0.4} numTicks={4} />
          <GridColumns
            scale={x}
            height={innerH}
            stroke={GRID_INK}
            strokeOpacity={0.4}
            tickValues={xTicks}
          />
          {/* threshold crosshair + labels */}
          {showZone ? (
            <>
              <Line
                from={{ x: mx, y: 0 }}
                to={{ x: mx, y: innerH }}
                stroke={AXIS_INK}
                strokeOpacity={0.4}
                strokeDasharray="3 3"
              />
              <Line
                from={{ x: 0, y: my }}
                to={{ x: innerW, y: my }}
                stroke={AXIS_INK}
                strokeOpacity={0.4}
                strokeDasharray="3 3"
              />
              <Text x={mx + 4} y={innerH - 3} fontSize={9} fill={AXIS_INK} fillOpacity={0.8}>
                30m avg
              </Text>
              <Text x={3} y={my - 4} fontSize={9} fill={AXIS_INK} fillOpacity={0.8}>
                ±10m swing
              </Text>
              <Text
                x={innerW - 3}
                y={3}
                textAnchor="end"
                verticalAnchor="start"
                fontSize={9}
                fontWeight={600}
                fill={AXIS_INK}
              >
                busy + swingy
              </Text>
            </>
          ) : null}
          {drawOrder.map((b) => (
            <Circle
              key={b.d.id}
              cx={b.x}
              cy={b.y}
              r={b.r}
              fill={b.color}
              fillOpacity={0.78}
              stroke="var(--background)"
              strokeWidth={1.25}
              onMouseMove={(e) => tip.show(b.d, clientXY(e))}
              onMouseLeave={tip.hide}
            />
          ))}
          {bubbles
            .filter((b) => labeled.has(b.d.id))
            .map((b) => (
              <Text
                key={b.d.id}
                x={b.x}
                y={Math.max(8, b.y - b.r - 3)}
                textAnchor="middle"
                verticalAnchor="end"
                fontSize={9}
                fontWeight={600}
                fill="var(--foreground)"
                stroke="var(--background)"
                strokeWidth={2.5}
                paintOrder="stroke"
                pointerEvents="none"
              >
                {truncate(b.d.name, 16)}
              </Text>
            ))}
          <AxisBottom
            top={innerH}
            scale={x}
            tickValues={xTicks}
            hideTicks
            stroke={GRID_INK}
            tickFormat={(v) => String(v)}
            tickLabelProps={() => tickLabelProps({ textAnchor: "middle", dy: "0.25em" })}
          />
          <AxisLeft
            scale={y}
            numTicks={4}
            hideTicks
            hideAxisLine
            tickLabelProps={() => tickLabelProps({ textAnchor: "end", dx: "-0.25em", dy: "0.3em" })}
          />
          <Text x={innerW} y={innerH + 28} textAnchor="end" fontSize={10} fill={AXIS_INK}>
            avg wait (min) →
          </Text>
        </Group>
      </svg>
      <tip.Tooltip>
        {(d) => (
          <div className="flex w-full flex-col gap-0.5">
            <span className="font-medium text-foreground">{d.name}</span>
            <span className="text-muted-foreground">
              avg <span className="text-foreground">{d.avgWait} min</span> · swing ±{d.volatility} ·
              peak {d.peak} min
            </span>
          </div>
        )}
      </tip.Tooltip>
    </div>
  );
}

// ───────────────────────── 7. Queue burden (treemap) ─────────────────────────
type TreemapDatum = { id: number; name: string; kind: RhythmKind; total: number; avgWait: number };
type TreemapRow = TreemapDatum & { share: number; rest?: number };
type TreemapTree = { name: "root"; children: Array<TreemapRow>; total?: never } | TreemapRow;

// Cap the cell count so the busiest rides stay legible; the long tail folds into
// a single muted "+N more" cell rather than a fringe of unreadable slivers. Set
// high enough that big parks (e.g. Magic Kingdom) don't collapse a huge share of
// rides into one oversized "others" cell — the smaller cells drop their name label
// and surface it on hover instead.
const TREEMAP_TOP_N = 27;

function pctLabel(share: number): string {
  return `${(share * 100).toFixed(share < 0.095 ? 1 : 0)}%`;
}

function TreemapChart({ data, noun }: { data: Array<TreemapDatum>; noun: string }) {
  const tip = useChartTooltip<TreemapRow>();
  const { rows, maxAvg } = React.useMemo(() => {
    const grand = data.reduce((s, d) => s + d.total, 0) || 1;
    const sorted = [...data].sort((a, b) => b.total - a.total);
    const top = sorted.slice(0, TREEMAP_TOP_N);
    const tail = sorted.slice(TREEMAP_TOP_N);
    const out: Array<TreemapRow> = top.map((d) => ({ ...d, share: d.total / grand }));
    if (tail.length > 0) {
      const total = tail.reduce((s, d) => s + d.total, 0);
      const wAvg = Math.round(tail.reduce((s, d) => s + d.avgWait * d.total, 0) / (total || 1));
      out.push({
        id: -1,
        name: `+${tail.length} more ${noun}`,
        kind: tail[0]?.kind ?? "attraction",
        total,
        avgWait: wAvg,
        share: total / grand,
        rest: tail.length,
      });
    }
    // Color ramp ignores the muted "others" cell so it doesn't skew the scale.
    const maxAvg = d3max(out, (r) => (r.id === -1 ? 0 : r.avgWait)) ?? 0;
    return { rows: out, maxAvg };
  }, [data, noun]);

  const root = React.useMemo(
    () =>
      hierarchy<TreemapTree>({ name: "root", children: rows })
        .sum((d) => ("total" in d ? (d.total ?? 0) : 0))
        .sort((a, b) => (b.value ?? 0) - (a.value ?? 0)),
    [rows],
  );

  if (data.length === 0) return <ChartEmpty label="No queue data yet." height={CHART_H} />;

  return (
    <ChartFrame height={CHART_H}>
      {({ width, height }) => (
        <div className="relative h-full w-full">
          <svg width={width} height={height}>
            <Treemap<TreemapTree>
              root={root}
              size={[width, height]}
              tile={treemapSquarify}
              round
              paddingInner={2}
            >
              {(treemap) => (
                <Group>
                  {treemap
                    .descendants()
                    .filter((node) => node.depth === 1)
                    .map((node) => {
                      const nodeW = node.x1 - node.x0;
                      const nodeH = node.y1 - node.y0;
                      if (nodeW <= 0 || nodeH <= 0) return null;
                      const datum = node.data as TreemapRow;
                      const isOthers = datum.id === -1;
                      const showName = nodeW > 54 && nodeH > 24;
                      const showPct = nodeW > 38 && nodeH > 38;
                      const maxChars = Math.max(1, Math.floor(nodeW / 7));
                      const fill = isOthers
                        ? "var(--muted-foreground)"
                        : intensityColor(maxAvg > 0 ? datum.avgWait / maxAvg : 0);
                      return (
                        <Group key={datum.id} left={node.x0} top={node.y0}>
                          <rect
                            width={nodeW}
                            height={nodeH}
                            rx={3}
                            fill={fill}
                            fillOpacity={isOthers ? 0.35 : 0.92}
                            stroke="var(--background)"
                            strokeWidth={2}
                            onMouseMove={(e) => tip.show(datum, clientXY(e))}
                            onMouseLeave={tip.hide}
                          />
                          {showName && (
                            <Text
                              x={6}
                              y={15}
                              fontSize={11}
                              fontWeight={600}
                              fill={isOthers ? "var(--foreground)" : "#fff"}
                              stroke={isOthers ? "var(--background)" : "rgba(0,0,0,0.35)"}
                              strokeWidth={2.5}
                              paintOrder="stroke"
                              pointerEvents="none"
                            >
                              {truncate(datum.name, maxChars)}
                            </Text>
                          )}
                          {showPct && (
                            <Text
                              x={6}
                              y={30}
                              fontSize={10}
                              fill={isOthers ? "var(--muted-foreground)" : "#fff"}
                              fillOpacity={0.9}
                              stroke={isOthers ? "var(--background)" : "rgba(0,0,0,0.3)"}
                              strokeWidth={2}
                              paintOrder="stroke"
                              pointerEvents="none"
                            >
                              {pctLabel(datum.share)}
                            </Text>
                          )}
                        </Group>
                      );
                    })}
                </Group>
              )}
            </Treemap>
          </svg>
          <tip.Tooltip>
            {(d) => (
              <div className="flex w-full flex-col gap-0.5">
                <span className="font-medium text-foreground">{d.name}</span>
                <span className="text-muted-foreground">
                  <span className="text-foreground">{pctLabel(d.share)}</span> of park standby ·{" "}
                  {Number(d.total).toLocaleString()} queue-min
                </span>
                {d.rest == null && (
                  <span className="text-muted-foreground">
                    avg <span className="text-foreground">{d.avgWait} min</span> standby
                  </span>
                )}
              </div>
            )}
          </tip.Tooltip>
        </div>
      )}
    </ChartFrame>
  );
}

// Rides and character meet-and-greets soak up waiting time in very different
// ways, so the card toggles between them rather than mixing both into one ramp.
function TreemapCard({ data }: { data: Array<TreemapDatum> }) {
  const [kind, setKind] = React.useState<RhythmKind>("attraction");
  const series = React.useMemo(() => data.filter((d) => d.kind === kind), [data, kind]);
  return (
    <AnalyticsCard
      title={kind === "character" ? "Where the meet-and-greet wait goes" : "Where the wait goes"}
      description="Box = share of standby minutes; color = typical wait · 7 days"
      action={
        <ToggleGroup
          multiple={false}
          value={[kind]}
          onValueChange={(v) => setKind((v[0] as RhythmKind | undefined) ?? "attraction")}
          variant="outline"
          size="sm"
        >
          <ToggleGroupItem value="attraction">Rides</ToggleGroupItem>
          <ToggleGroupItem value="character">Characters</ToggleGroupItem>
        </ToggleGroup>
      }
    >
      {kind === "character" && series.length === 0 ? (
        <ChartNoCharacters height={CHART_H} />
      ) : (
        <TreemapChart data={series} noun={kind === "character" ? "characters" : "rides"} />
      )}
    </AnalyticsCard>
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
    // Drop attractions that never post a wait (avg/peak all 0) — they pile up
    // as meaningless dots at the origin.
    () => (q.data?.scatter ?? []).filter((r) => !isSingleRiderName(r.name) && r.peak > 0),
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
        <RhythmCard data={q.data?.rhythm ?? []} />
        <ScatterCard data={scatter} />
        <TreemapCard data={treemap} />
        <PlaceholderCell />
      </div>
    </section>
  );
}
