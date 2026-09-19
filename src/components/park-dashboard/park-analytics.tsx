"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { max as d3max, min as d3min } from "d3-array";
import { Group } from "@visx/group";
import { hierarchy, Treemap, treemapSquarify } from "@visx/hierarchy";
import { scaleLinear, scaleLog, scaleSqrt } from "@visx/scale";
import { Arc, Circle, Line } from "@visx/shape";
import { Text } from "@visx/text";

import {
  ChartLegend,
  ChartSentence,
  HeatRampKey,
  LegendKey,
  RowBars,
  deltaClause,
  deltaTone,
  heatInkLight,
  heatStepOf,
  heatVar,
  hourLabel,
  mean,
  useParkClock,
} from "#/components/detail/chart-kit.tsx";
import { HourDayHeatmap } from "#/components/detail/hour-day-heatmap.tsx";
import { TrendChart, type TrendPoint } from "#/components/detail/trend-chart.tsx";
import { Skeleton } from "#/components/ui/skeleton.tsx";
import { ToggleGroup, ToggleGroupItem } from "#/components/ui/toggle-group.tsx";
import { useTRPC } from "#/integrations/trpc/react.ts";
import { cn } from "#/lib/utils.ts";

import { isSingleRiderName } from "./lightning-lane.ts";
import { ParkLlDropsHeatmap } from "./ll-drops.tsx";
import {
  AnalyticsCard,
  ChartEmpty,
  ChartFrame,
  ChartNoCharacters,
  CHART_H,
  truncate,
} from "./visx/kit.tsx";

const minutes = (v: number) => `${Math.round(v)} min`;
const WASH_INK = "var(--wash-bar-strong)";
const WASH_FG = "var(--wash-fg)";
const WASH_MUTED = "var(--wash-muted)";

// ───────────────────────── 2. Average wait trend (line) ──────────────────────
type ActivityDatum = { bucket: string; rides: number; avgWait: number | null; closed: boolean };

/** How near the last reading must be to the clock to be called "now". */
const NOW_SLACK_MS = 90 * 60_000;

function ActivityTrend({ data, timeZone }: { data: Array<ActivityDatum>; timeZone: string }) {
  const [sel, setSel] = React.useState<number | null>(null);
  const points = React.useMemo<Array<TrendPoint>>(
    () =>
      data.map((d) => ({
        t: new Date(d.bucket).getTime(),
        value: d.closed ? null : d.avgWait,
        closed: d.closed,
      })),
    [data],
  );
  // One label per day, on its noon.
  const ticks = React.useMemo(() => {
    const byDay = new Map<string, Array<TrendPoint>>();
    for (const p of points) {
      const key = new Date(p.t).toLocaleDateString("en-CA", { timeZone });
      const list = byDay.get(key);
      if (list) list.push(p);
      else byDay.set(key, [p]);
    }
    return [...byDay.values()].map((ps) => {
      const noon = ps.reduce((b, p) => {
        const h = Number(
          new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", hour: "2-digit" }).format(
            new Date(p.t),
          ),
        );
        const hb = Number(
          new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", hour: "2-digit" }).format(
            new Date(b.t),
          ),
        );
        return Math.abs(h - 12) < Math.abs(hb - 12) ? p : b;
      });
      return noon.t;
    });
  }, [points, timeZone]);

  const live = points.flatMap((p, i) => (p.value == null ? [] : [i]));
  if (live.length < 2) return <ChartEmpty label="No recent wait history yet." height={CHART_H} />;

  const lastLive = live[live.length - 1]!;
  const isNow = Date.now() - points[lastLive]!.t < NOW_SLACK_MS;
  const nowValue = isNow ? (points[lastLive]!.value as number) : null;
  const peakIdx = live.reduce((b, i) =>
    (points[i]!.value as number) > (points[b]!.value as number) ? i : b,
  );
  const avg = mean(live.map((i) => points[i]!.value as number)) ?? 0;
  const when = (t: number) =>
    new Date(t).toLocaleString("en-US", { weekday: "short", hour: "numeric", timeZone });

  const active = sel != null ? points[sel]! : null;
  let headline: string;
  let subline: string;
  let tone: "good" | "bad" | "neutral" = "neutral";
  if (active && sel !== (isNow ? lastLive : -1)) {
    const d = data[sel!]!;
    if (active.closed || active.value == null) {
      headline = `${when(active.t)} · ${active.closed ? "park closed" : "no reading"}`;
      subline = active.closed ? "No lines to average." : "We didn't get a poll back for this hour.";
    } else {
      headline = `${when(active.t)} averaged ${minutes(active.value)}`;
      subline = `Across ${d.rides} rides. ${deltaClause(
        active.value,
        nowValue ?? avg,
        minutes,
        nowValue != null ? "the park right now" : "the week's average",
        { more: "longer than", less: "shorter than" },
      )}`;
      tone = deltaTone(active.value, nowValue ?? avg);
    }
  } else if (nowValue != null) {
    headline = `Park-wide right now: ${minutes(nowValue)}`;
    subline = `Peaked ${when(points[peakIdx]!.t)} · ${minutes(points[peakIdx]!.value as number)}. Tap the line to compare.`;
  } else {
    headline = `Peaked ${when(points[peakIdx]!.t)} · ${minutes(points[peakIdx]!.value as number)}`;
    subline = `Averaged ${minutes(avg)} across the week. Tap the line for an hour.`;
  }

  return (
    <div className="flex flex-col gap-3">
      <ChartSentence headline={headline} subline={subline} tone={tone} size="sm" />
      <TrendChart
        points={points}
        selected={sel}
        onSelect={setSel}
        format={minutes}
        tickValues={ticks}
        tickFormat={(d) => d.toLocaleDateString("en-US", { weekday: "short", timeZone })}
        anchor={
          nowValue != null ? { index: lastLive, label: `Now · ${Math.round(nowValue)}` } : null
        }
        height={{ base: 140, md: 176 }}
      />
      <ChartLegend>
        <LegendKey swatch="measured">Park average</LegendKey>
        {nowValue != null && <LegendKey swatch="now">Now</LegendKey>}
        {data.some((d) => d.closed) && <LegendKey swatch="hatch">Park closed</LegendKey>}
      </ChartLegend>
    </div>
  );
}

// ───────────────────────── 4. Average wait by land (rows) ────────────────────
type LandDatum = { land: string; avgWait: number; peak: number; rides: number };

function LandRows({ data }: { data: Array<LandDatum> }) {
  const [sel, setSel] = React.useState<number | null>(null);
  if (data.length === 0)
    return <ChartEmpty label="No land-tagged rides for this park." height={CHART_H} />;

  const sorted = [...data].sort((a, b) => b.avgWait - a.avgWait);
  const quietest = sorted[sorted.length - 1]!;
  const busiest = sorted[0]!;
  const parkAvg = mean(sorted.map((d) => d.avgWait)) ?? 0;

  const active = sel != null ? sorted[sel]! : null;
  let headline: string;
  let subline: string;
  let tone: "good" | "bad" | "neutral" = "neutral";
  if (active) {
    headline = `${active.land} averages ${minutes(active.avgWait)}`;
    subline = `${active.rides} ${active.rides === 1 ? "ride" : "rides"}, peaking at ${minutes(active.peak)}. ${deltaClause(
      active.avgWait,
      parkAvg,
      minutes,
      "the park's lands on average",
      { more: "longer than", less: "shorter than" },
    )}`;
    tone = deltaTone(active.avgWait, parkAvg);
  } else {
    headline = `${busiest.land} runs the longest lines · ${minutes(busiest.avgWait)}`;
    subline =
      sorted.length > 1
        ? `${quietest.land} the shortest · ${minutes(quietest.avgWait)}. Tap a land to compare.`
        : "Tap a land for its figures.";
  }

  return (
    <div className="flex flex-col gap-3">
      <ChartSentence headline={headline} subline={subline} tone={tone} size="sm" />
      <RowBars
        rows={sorted.map((d) => ({
          key: d.land,
          label: d.land,
          value: d.avgWait,
          display: `${Math.round(d.avgWait)}m`,
          name: `${d.land}: ${minutes(d.avgWait)} average across ${d.rides} rides`,
          tone: sorted.length > 1 && d.land === quietest.land ? "best" : "measured",
        }))}
        selected={sel}
        onSelect={setSel}
      />
      <ChartLegend>
        <LegendKey swatch="measured">Average standby</LegendKey>
        {sorted.length > 1 && <LegendKey swatch="best">Shortest lines</LegendKey>}
      </ChartLegend>
    </div>
  );
}

// ───────────────────────── 5. Daily rhythm (radial clock) ────────────────────
type RhythmKind = "attraction" | "character";
type RhythmDatum = { hour: number; avgWait: number; kind: RhythmKind };

// Rides and character meet-and-greets peak at very different times, so the card
// toggles between the two rather than averaging them into one misleading dial.
function RhythmCard({ data, nowHour }: { data: Array<RhythmDatum>; nowHour: number | null }) {
  const [kind, setKind] = React.useState<RhythmKind>("attraction");
  const series = React.useMemo(() => data.filter((d) => d.kind === kind), [data, kind]);
  return (
    <AnalyticsCard
      title="Daily rhythm"
      description="Usual standby around a 24-hour clock · 14 days"
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
        <RhythmChart data={series} nowHour={nowHour} />
      )}
    </AnalyticsCard>
  );
}

/**
 * The day as a clock face: one wedge per hour, its length the usual wait,
 * its colour the heat step, midnight at the top. The hour you're standing in
 * is ringed in yellow and the wedge you point at is spoken above.
 */
function RhythmChart({ data, nowHour }: { data: Array<RhythmDatum>; nowHour: number | null }) {
  const [sel, setSel] = React.useState<number | null>(null);
  if (data.length < 4) return <ChartEmpty label="Not enough hours sampled yet." height={CHART_H} />;

  const maxV = d3max(data, (d) => d.avgWait) ?? 0;
  const minV = d3min(data, (d) => d.avgWait) ?? 0;
  const peak = data.reduce((m, d) => (d.avgWait > m.avgWait ? d : m), data[0]!);
  const trough = data.reduce((m, d) => (d.avgWait < m.avgWait ? d : m), data[0]!);
  const nowIdx = nowHour != null ? data.findIndex((d) => d.hour === nowHour) : -1;
  const nowValue = nowIdx >= 0 ? data[nowIdx]!.avgWait : null;

  const active = sel != null ? data[sel]! : null;
  let headline: string;
  let subline: string;
  let tone: "good" | "bad" | "neutral" = "neutral";
  if (active && sel !== nowIdx) {
    headline = `${hourLabel(active.hour)} usually runs about ${minutes(active.avgWait)}`;
    subline = deltaClause(
      active.avgWait,
      nowValue ?? trough.avgWait,
      minutes,
      nowValue != null ? "this hour" : `${hourLabel(trough.hour)}, the quietest hour`,
      { more: "longer than", less: "shorter than" },
    );
    tone = deltaTone(active.avgWait, nowValue ?? trough.avgWait);
  } else if (nowValue != null) {
    headline = `This hour usually runs about ${minutes(nowValue)}`;
    subline = `Busiest at ${hourLabel(peak.hour)} · ${minutes(peak.avgWait)}, quietest at ${hourLabel(trough.hour)}. Tap a wedge to compare.`;
  } else {
    headline = `Busiest at ${hourLabel(peak.hour)} · ${minutes(peak.avgWait)}`;
    subline = `Quietest at ${hourLabel(trough.hour)} · ${minutes(trough.avgWait)}. Tap a wedge for its hour.`;
  }

  return (
    <div className="flex flex-col gap-3">
      <ChartSentence headline={headline} subline={subline} tone={tone} size="sm" />
      <ChartFrame height={{ base: 200, md: 224 }}>
        {({ width, height }) => {
          const cx = width / 2;
          const cy = height / 2;
          const R = Math.max(0, Math.min(width, height) / 2 - 22);
          const r0 = R * 0.34; // open center reads as a clock face
          const n = data.length;
          const rScale = scaleLinear({ domain: [0, maxV || 1], range: [r0, R] });
          // d3 arc angles: 0 = 12 o'clock, increasing clockwise — so midnight sits
          // at the top and the day sweeps around like a real clock.
          const a0 = (i: number) => (i / n) * 2 * Math.PI;
          const a1 = (i: number) => ((i + 1) / n) * 2 * Math.PI;
          const centre = active ?? (nowIdx >= 0 ? data[nowIdx]! : peak);

          return (
            <svg width={width} height={height} onMouseLeave={() => setSel(null)}>
              <Group left={cx} top={cy}>
                <circle r={R} fill="none" stroke="var(--wash-edge)" strokeOpacity={0.9} />
                <circle r={r0} fill="none" stroke="var(--wash-edge)" strokeOpacity={0.9} />
                {data.map((d, i) => {
                  const hot = sel === i;
                  const isNow = i === nowIdx;
                  return (
                    <Arc
                      key={d.hour}
                      innerRadius={r0}
                      outerRadius={Math.max(r0 + 1, rScale(d.avgWait))}
                      startAngle={a0(i)}
                      endAngle={a1(i)}
                      padAngle={0.02}
                      cornerRadius={3}
                      fill={
                        isNow ? "var(--brand-yellow)" : heatVar(heatStepOf(d.avgWait, minV, maxV))
                      }
                      stroke={hot ? WASH_FG : "var(--card)"}
                      strokeWidth={hot ? 2.5 : 1}
                      style={{ cursor: "pointer" }}
                      role="button"
                      aria-label={`${hourLabel(d.hour)}: usually about ${minutes(d.avgWait)}`}
                      tabIndex={0}
                      onMouseEnter={() => setSel(i)}
                      onFocus={() => setSel(i)}
                      onBlur={() => setSel(null)}
                      onClick={() => setSel(i)}
                    />
                  );
                })}
                {/* hour ticks every 3h around the dial */}
                {data.map((d, i) => {
                  if (d.hour % 3 !== 0) return null;
                  const a = (a0(i) + a1(i)) / 2;
                  const lr = R + 12;
                  return (
                    <Text
                      key={d.hour}
                      x={lr * Math.sin(a)}
                      y={-lr * Math.cos(a)}
                      textAnchor="middle"
                      verticalAnchor="middle"
                      fontSize={10}
                      fontWeight={700}
                      fill={d.hour === nowHour ? WASH_FG : WASH_MUTED}
                    >
                      {hourLabel(d.hour)}
                    </Text>
                  );
                })}
                {/* the pointed-at (or current, or peak) hour in the open centre */}
                <Text
                  textAnchor="middle"
                  verticalAnchor="middle"
                  y={-8}
                  fontSize={10}
                  fontWeight={700}
                  fill={WASH_MUTED}
                >
                  {active ? hourLabel(centre.hour) : nowIdx >= 0 ? "now" : "busiest"}
                </Text>
                <Text
                  textAnchor="middle"
                  verticalAnchor="middle"
                  y={9}
                  fontSize={15}
                  fontWeight={800}
                  fill="var(--foreground)"
                >
                  {active ? minutes(centre.avgWait) : hourLabel(centre.hour)}
                </Text>
              </Group>
            </svg>
          );
        }}
      </ChartFrame>
      <ChartLegend>
        <HeatRampKey from={minutes(minV)} to={minutes(maxV)} />
        {nowIdx >= 0 && <LegendKey swatch="now">This hour</LegendKey>}
      </ChartLegend>
    </div>
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

// Rides and character meet-and-greets behave very differently, so the card
// toggles between the two rather than mixing them on one plot.
function ScatterCard({ data }: { data: Array<ScatterDatum> }) {
  const [kind, setKind] = React.useState<RhythmKind>("attraction");
  const series = React.useMemo(() => data.filter((d) => d.kind === kind), [data, kind]);
  return (
    <AnalyticsCard
      title="Busy vs. volatile"
      description="Usual wait across, swing up, sized by peak · 7 days"
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
      ) : series.length === 0 ? (
        <ChartEmpty label="No samples yet." height={CHART_H} />
      ) : (
        <ScatterAnalysis data={series} showZone={kind === "attraction"} />
      )}
    </AnalyticsCard>
  );
}

function ScatterAnalysis({ data, showZone }: { data: Array<ScatterDatum>; showZone: boolean }) {
  const [sel, setSel] = React.useState<number | null>(null);
  const active = sel != null ? (data.find((d) => d.id === sel) ?? null) : null;
  const inZone = (d: ScatterDatum) => d.avgWait >= WAIT_HOT && d.volatility >= SWING_HOT;
  const zoned = showZone ? data.filter(inZone) : [];
  const busiest = data.reduce((b, d) => (d.avgWait > b.avgWait ? d : b), data[0]!);

  let headline: string;
  let subline: string;
  let tone: "good" | "bad" | "neutral" = "neutral";
  if (active) {
    headline = `${active.name} · ${minutes(active.avgWait)}, swinging ±${Math.round(active.volatility)}`;
    subline = `Peaked at ${minutes(active.peak)}. ${
      showZone && inZone(active)
        ? "Busy and swingy — worth planning around."
        : active.avgWait >= WAIT_HOT
          ? "Long but steady: what you see is what you'll wait."
          : active.volatility >= SWING_HOT
            ? "Short on average but jumpy — check the board before you walk over."
            : "Short and steady."
    }`;
    tone = showZone && inZone(active) ? "bad" : active.avgWait < WAIT_HOT ? "good" : "neutral";
  } else if (zoned.length > 0) {
    headline = `${zoned.length} ${zoned.length === 1 ? "ride is" : "rides are"} busy and swingy`;
    subline = `${zoned
      .slice(0, 3)
      .map((d) => d.name)
      .join(
        ", ",
      )}${zoned.length > 3 ? " and more" : ""} — plan around them. Tap a bubble for its ride.`;
  } else {
    headline = `${busiest.name} runs the longest line · ${minutes(busiest.avgWait)}`;
    subline = "Further right is longer, higher up is jumpier. Tap a bubble for its ride.";
  }

  return (
    <div className="flex flex-col gap-3">
      <ChartSentence headline={headline} subline={subline} tone={tone} size="sm" />
      <ChartFrame height={{ base: 200, md: 224 }}>
        {({ width, height }) => (
          <ScatterPlot
            width={width}
            height={height}
            data={data}
            showZone={showZone}
            selected={sel}
            onSelect={setSel}
          />
        )}
      </ChartFrame>
      <ChartLegend>
        <LegendKey swatch="measured">One ride · size is its peak</LegendKey>
        {showZone && <LegendKey swatch="bg-peach-fg/25">Busy and swingy</LegendKey>}
      </ChartLegend>
    </div>
  );
}

function ScatterPlot({
  width,
  height,
  data,
  showZone,
  selected,
  onSelect,
}: {
  width: number;
  height: number;
  data: Array<ScatterDatum>;
  showZone: boolean;
  selected: number | null;
  onSelect: (id: number | null) => void;
}) {
  const margin = { top: 16, right: 12, bottom: 26, left: 8 };
  const innerW = Math.max(0, width - margin.left - margin.right);
  const innerH = Math.max(0, height - margin.top - margin.bottom);

  // Relax once per size/data change — NOT on every hover (selection lives in
  // the parent, so memoizing keeps the O(n²) solve off the mousemove path).
  const { bubbles, x, mx, my, xTicks, labeled } = React.useMemo(() => {
    const xMax = d3max(data, (d) => d.avgWait) ?? 0;
    const xMin = d3min(data, (d) => d.avgWait) ?? 0;
    const yMax = d3max(data, (d) => d.volatility) ?? 0;
    const pMax = d3max(data, (d) => d.peak) ?? 0;
    // Log x spreads the dense low-wait cluster; long-wait rides compress mildly.
    const lo = Math.max(1, Math.floor(xMin || 1));
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
            data.map((d) => {
              const ax = x(clampWait(d.avgWait));
              const ay = y(d.volatility);
              return { d, r: rad(d.peak), ax, ay, x: ax, y: ay };
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
    return { bubbles, x, mx: x(WAIT_HOT), my: y(SWING_HOT), xTicks, labeled };
  }, [data, innerW, innerH, showZone]);

  // Draw biggest-first so the small dots sit on top and stay hoverable.
  const drawOrder = [...bubbles].sort((a, b) => b.r - a.r);
  const hot = selected != null ? bubbles.find((b) => b.d.id === selected) : null;

  return (
    <svg width={width} height={height} onMouseLeave={() => onSelect(null)}>
      <Group left={margin.left} top={margin.top}>
        {/* "busy & swingy" zone: avg > 30 min AND swing > ±10 min. Ride-scale
            thresholds, so it's only drawn for rides — not characters. */}
        {showZone && (
          <>
            <rect
              x={mx}
              y={0}
              width={Math.max(0, innerW - mx)}
              height={my}
              rx={6}
              fill="var(--peach-fg)"
              fillOpacity={0.08}
            />
            <Line
              from={{ x: mx, y: 0 }}
              to={{ x: mx, y: innerH }}
              stroke={WASH_MUTED}
              strokeOpacity={0.5}
              strokeDasharray="1 4"
              strokeLinecap="round"
            />
            <Line
              from={{ x: 0, y: my }}
              to={{ x: innerW, y: my }}
              stroke={WASH_MUTED}
              strokeOpacity={0.5}
              strokeDasharray="1 4"
              strokeLinecap="round"
            />
            <Text
              x={innerW - 4}
              y={6}
              textAnchor="end"
              verticalAnchor="start"
              fontSize={10}
              fontWeight={800}
              fill="var(--peach-fg)"
              style={{ letterSpacing: "0.06em", textTransform: "uppercase" }}
            >
              Busy + swingy
            </Text>
          </>
        )}
        {drawOrder.map((b) => {
          const isHot = b.d.id === selected;
          const dim = selected != null && !isHot;
          return (
            <Circle
              key={b.d.id}
              cx={b.x}
              cy={b.y}
              r={b.r}
              fill={WASH_INK}
              fillOpacity={dim ? 0.35 : 0.85}
              stroke={isHot ? WASH_FG : "var(--card)"}
              strokeWidth={isHot ? 2.5 : 1.5}
              style={{ cursor: "pointer" }}
              role="button"
              tabIndex={0}
              aria-label={`${b.d.name}: ${minutes(b.d.avgWait)} average, swinging ±${Math.round(b.d.volatility)}, peak ${minutes(b.d.peak)}`}
              onMouseEnter={() => onSelect(b.d.id)}
              onFocus={() => onSelect(b.d.id)}
              onBlur={() => onSelect(null)}
              onClick={() => onSelect(b.d.id)}
            />
          );
        })}
        {bubbles
          .filter((b) => labeled.has(b.d.id) || b.d.id === selected)
          .map((b) => (
            <Text
              key={b.d.id}
              x={b.x}
              y={Math.max(8, b.y - b.r - 3)}
              textAnchor="middle"
              verticalAnchor="end"
              fontSize={10}
              fontWeight={700}
              fill="var(--foreground)"
              stroke="var(--card)"
              strokeWidth={3}
              paintOrder="stroke"
              pointerEvents="none"
            >
              {truncate(b.d.name, 18)}
            </Text>
          ))}
        {/* The value pill, at the foot under the bubble. */}
        {hot && (
          <Group left={hot.x} top={innerH - 10}>
            <rect
              x={-22}
              y={-9}
              width={44}
              height={18}
              rx={9}
              fill="var(--card)"
              stroke="var(--wash-edge)"
              pointerEvents="none"
            />
            <Text
              textAnchor="middle"
              verticalAnchor="middle"
              fontSize={11}
              fontWeight={800}
              fill="var(--foreground)"
              pointerEvents="none"
            >
              {minutes(hot.d.avgWait)}
            </Text>
          </Group>
        )}
        {xTicks.map((v) => (
          <Text
            key={v}
            x={x(v)}
            y={innerH + 14}
            textAnchor="middle"
            fontSize={10}
            fontWeight={700}
            fill={WASH_MUTED}
          >
            {`${v}m`}
          </Text>
        ))}
        <Text x={0} y={-6} fontSize={10} fontWeight={700} fill={WASH_MUTED} verticalAnchor="end">
          ↑ swing
        </Text>
        <Text
          x={innerW}
          y={innerH + 14}
          textAnchor="end"
          fontSize={10}
          fontWeight={700}
          fill={WASH_MUTED}
          dx={-2}
          dy={12}
        >
          usual wait →
        </Text>
      </Group>
    </svg>
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
  const [sel, setSel] = React.useState<number | null>(null);
  const { rows, minAvg, maxAvg } = React.useMemo(() => {
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
    // Colour ramp ignores the muted "others" cell so it doesn't skew the scale.
    const real = out.filter((r) => r.id !== -1);
    const maxAvg = d3max(real, (r) => r.avgWait) ?? 0;
    const minAvg = d3min(real, (r) => r.avgWait) ?? 0;
    return { rows: out, minAvg, maxAvg };
  }, [data, noun]);

  const root = React.useMemo(
    () =>
      hierarchy<TreemapTree>({ name: "root", children: rows })
        .sum((d) => ("total" in d ? (d.total ?? 0) : 0))
        .sort((a, b) => (b.value ?? 0) - (a.value ?? 0)),
    [rows],
  );

  if (data.length === 0) return <ChartEmpty label="No queue data yet." height={CHART_H} />;

  const top = rows[0]!;
  const active = sel != null ? (rows.find((r) => r.id === sel) ?? null) : null;
  let headline: string;
  let subline: string;
  if (active) {
    headline = `${active.name} · ${pctLabel(active.share)} of the park's standby`;
    subline =
      active.rest != null
        ? `${Number(active.total).toLocaleString()} queue-minutes between them.`
        : `${Number(active.total).toLocaleString()} queue-minutes over the week, averaging ${minutes(active.avgWait)} a reading.`;
  } else {
    headline = `${top.name} soaks up ${pctLabel(top.share)} of the waiting`;
    subline =
      "Bigger box, more of the park's standby minutes; darker, a longer usual wait. Tap a box.";
  }

  return (
    <div className="flex flex-col gap-3">
      <ChartSentence headline={headline} subline={subline} size="sm" />
      <ChartFrame height={{ base: 200, md: 224 }}>
        {({ width, height }) => (
          <svg width={width} height={height} onMouseLeave={() => setSel(null)}>
            <Treemap<TreemapTree>
              root={root}
              size={[width, height]}
              tile={treemapSquarify}
              round
              paddingInner={3}
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
                      const hot = datum.id === sel;
                      const dim = sel != null && !hot;
                      const showName = nodeW > 54 && nodeH > 24;
                      const showPct = nodeW > 38 && nodeH > 38;
                      const maxChars = Math.max(1, Math.floor(nodeW / 7));
                      const step = heatStepOf(datum.avgWait, minAvg, maxAvg);
                      const fill = isOthers ? "var(--heat-none)" : heatVar(step);
                      const ink = isOthers || !heatInkLight(step) ? "var(--wash-fg)" : "#fff";
                      return (
                        <Group key={datum.id} left={node.x0} top={node.y0}>
                          <rect
                            width={nodeW}
                            height={nodeH}
                            rx={6}
                            fill={fill}
                            fillOpacity={dim ? 0.45 : 1}
                            stroke={hot ? WASH_FG : "transparent"}
                            strokeWidth={2.5}
                            style={{ cursor: "pointer" }}
                            role="button"
                            tabIndex={0}
                            aria-label={`${datum.name}: ${pctLabel(datum.share)} of the park's standby minutes`}
                            onMouseEnter={() => setSel(datum.id)}
                            onFocus={() => setSel(datum.id)}
                            onBlur={() => setSel(null)}
                            onClick={() => setSel(datum.id)}
                          />
                          {showName && (
                            <Text
                              x={7}
                              y={16}
                              fontSize={11}
                              fontWeight={800}
                              fill={ink}
                              fillOpacity={dim ? 0.6 : 1}
                              pointerEvents="none"
                            >
                              {truncate(datum.name, maxChars)}
                            </Text>
                          )}
                          {showPct && (
                            <Text
                              x={7}
                              y={31}
                              fontSize={10}
                              fontWeight={700}
                              fill={ink}
                              fillOpacity={dim ? 0.5 : 0.85}
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
        )}
      </ChartFrame>
      <ChartLegend>
        <HeatRampKey from={minutes(minAvg)} to={minutes(maxAvg)} />
        {rows.some((r) => r.id === -1) && <LegendKey swatch="zero">The rest</LegendKey>}
      </ChartLegend>
    </div>
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
      description="Box is share of standby minutes; shade is the usual wait · 7 days"
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

/** The park page's Know band grid: every rollup of this park's own history. */
export function ParkAnalytics({ parkSlug }: { parkSlug: string | null }) {
  const trpc = useTRPC();
  const q = useQuery({
    ...trpc.parks.analytics.queryOptions({ parkSlug: parkSlug ?? "" }),
    enabled: !!parkSlug,
  });
  const tz = q.data?.timezone ?? "America/New_York";
  const clock = useParkClock(tz);

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

  // `!q.data`, not `isLoading`: TanStack's `isLoading` is `isPending &&
  // isFetching`, which is false on the client's very first render — before the
  // fetch starts — so an `isLoading` guard renders *nothing* at exactly the
  // moment the space needs reserving, and the whole grid pops in later. Eight
  // cards at the real heights (the wide pair run taller), so the page settles
  // at close to its final length.
  if (!parkSlug || !q.data) {
    return (
      <div className="grid gap-4 lg:grid-cols-2">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton
            key={i}
            className={cn("w-full rounded-[22px]", i >= 6 ? "h-[500px]" : "h-[340px]")}
          />
        ))}
      </div>
    );
  }

  const heat = q.data?.heatmap ?? [];

  return (
    // No heading of its own: the page's "Know" band already says what these
    // are, and a second title inside it read as a nested page.
    <section className="flex flex-col gap-4">
      <div className="grid gap-4 lg:grid-cols-2">
        <LlDropsCard parkSlug={parkSlug} nowHour={clock?.hour ?? null} />
        <AnalyticsCard
          title="Average wait trend"
          description="Whole-park hourly average standby · 7 days"
        >
          <ActivityTrend data={q.data?.activity ?? []} timeZone={tz} />
        </AnalyticsCard>
        <AnalyticsCard title="Average wait by land" description="Usual standby per area · 7 days">
          <LandRows data={q.data?.byLand ?? []} />
        </AnalyticsCard>
        <AnalyticsCard
          title="Crowd calendar"
          description="Usual standby by day and hour, park local · 14 days"
        >
          {heat.length === 0 ? (
            <ChartEmpty label="Not enough history for a calendar yet." height={CHART_H} />
          ) : (
            <HourDayHeatmap
              cells={heat.map((c) => ({ date: c.date, hour: c.hour, value: c.avgWait }))}
              today={clock?.date ?? null}
              nowHour={clock?.hour ?? null}
              unit={minutes}
              subject="the park"
            />
          )}
        </AnalyticsCard>
        <RhythmCard data={q.data?.rhythm ?? []} nowHour={clock?.hour ?? null} />
        <ScatterCard data={scatter} />
        <TreemapCard data={treemap} />
      </div>
    </section>
  );
}

/**
 * Park-wide Lightning Lane drop grid. Its own query (not part of `analytics`)
 * because the SOLD_OUT -> AVAILABLE scan is a different shape and cost from the
 * standby rollups, and a park with no paid line shouldn't pay for it.
 *
 * Leads the analytics grid as a full-width row: it's the most actionable card
 * here (it answers "when can I get on this ride"), where everything below it is
 * historical standby context. Renders nothing at all for parks with no paid line
 * — an empty placeholder in the lead slot would read as a broken page.
 */
function LlDropsCard({ parkSlug, nowHour }: { parkSlug: string; nowHour: number | null }) {
  const trpc = useTRPC();
  const q = useQuery({
    ...trpc.parks.parkLlDrops.queryOptions({ parkSlug }),
    enabled: !!parkSlug,
  });

  if (q.isLoading) {
    return <Skeleton className="h-[296px] w-full rounded-2xl lg:col-span-2" />;
  }
  if ((q.data?.cells ?? []).length === 0) return null;

  const total = (q.data?.rides ?? []).reduce((s, r) => s + r.drops, 0);
  return (
    <div className="lg:col-span-2">
      <AnalyticsCard
        title="Lightning Lane drops"
        description="When each ride's line comes back after selling out, park local · 30 days"
        meta={`${total.toLocaleString()} ${total === 1 ? "drop" : "drops"}`}
      >
        <ParkLlDropsHeatmap data={q.data?.cells ?? []} nowHour={nowHour} />
      </AnalyticsCard>
    </div>
  );
}
