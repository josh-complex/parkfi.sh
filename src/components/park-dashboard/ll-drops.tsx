"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { max as d3max } from "d3-array";
import { AxisLeft } from "@visx/axis";
import { GridRows } from "@visx/grid";
import { Group } from "@visx/group";
import { scaleBand, scaleLinear } from "@visx/scale";
import { Bar, Line } from "@visx/shape";

import { Skeleton } from "#/components/ui/skeleton.tsx";
import { useTRPC } from "#/integrations/trpc/react.ts";
import { cn } from "#/lib/utils.ts";

import {
  AnalyticsCard,
  AXIS_INK,
  ChartEmpty,
  ChartFrame,
  CHART_H,
  clientXY,
  GRID_INK,
  hourLabel,
  PRIMARY,
  tickLabelProps,
  truncate,
  useChartTooltip,
} from "./visx/kit.tsx";

const CHART_H_RESPONSIVE = { base: 180, md: CHART_H };

/**
 * Lightning Lane / Virtual Line **drop** charts.
 *
 * A drop is the operator returning inventory after the line sold out. The data
 * behind these charts is a `SOLD_OUT -> AVAILABLE` edge on `queue_obs`; see the
 * `parks.llDrops` procedure for the rollup and `research/lightning-lane-drop-alerts.md`
 * for why each form was chosen.
 *
 * Colour note: this file deliberately skips the ride charts' green->red
 * `intensityColor` ramp. Every measure here is plain magnitude — a count of
 * drops — so the bars take a single hue (`--primary`). A value ramp would
 * double-encode bar length as lightness, spending the only free channel on
 * information the bar already carries.
 */

type HourDatum = { hour: number; drops: number };

/** Drops by hour of day — "what time should I be watching?" */
function DropsByHourChart({ data }: { data: Array<HourDatum> }) {
  const tip = useChartTooltip<HourDatum>();
  if (data.length === 0) return <ChartEmpty label="No drops recorded yet." height={CHART_H} />;

  // Show a continuous clock spine so quiet hours read as real gaps, not as
  // missing categories. Trim to the range that actually saw activity.
  const lo = Math.min(...data.map((d) => d.hour));
  const hi = Math.max(...data.map((d) => d.hour));
  const byHour = new Map(data.map((d) => [d.hour, d.drops]));
  const spine: Array<HourDatum> = Array.from({ length: hi - lo + 1 }, (_, i) => ({
    hour: lo + i,
    drops: byHour.get(lo + i) ?? 0,
  }));
  const margin = { top: 10, right: 8, bottom: 22, left: 30 };
  const max = d3max(spine, (d) => d.drops) ?? 0;

  return (
    <ChartFrame height={CHART_H_RESPONSIVE}>
      {({ width, height }) => {
        const narrow = width < 480;
        const innerW = Math.max(0, width - margin.left - margin.right);
        const innerH = Math.max(0, height - margin.top - margin.bottom);
        const x = scaleBand({
          domain: spine.map((d) => d.hour),
          range: [0, innerW],
          padding: 0.22,
        });
        const y = scaleLinear({ domain: [0, max * 1.1 || 1], range: [innerH, 0], nice: true });
        const bw = x.bandwidth();
        const everyNth = Math.max(1, Math.ceil((spine.length * 26) / Math.max(1, innerW)));

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
                {spine.map((d, i) => {
                  const bx = x(d.hour) ?? 0;
                  const by = y(d.drops);
                  return (
                    <Group key={d.hour}>
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
                        fill={PRIMARY}
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
                          {hourLabel(d.hour)}
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
                    tickLabelProps(
                      { textAnchor: "end", dx: "-0.25em", dy: "0.3em" },
                      narrow ? 12 : 11,
                    )
                  }
                />
              </Group>
            </svg>
            <tip.Tooltip>
              {(d) => (
                <div className="flex w-full flex-col gap-0.5">
                  <span className="font-medium text-foreground">{hourLabel(d.hour)}</span>
                  <span className="text-foreground">
                    <span className="font-mono font-medium tabular-nums">{d.drops}</span>{" "}
                    <span className="text-muted-foreground">
                      {d.drops === 1 ? "drop" : "drops"} in 30 days
                    </span>
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

/**
 * Shared one-hue histogram for the two distribution cards. Both plot "how many
 * drops fell in this bucket" over an ordered numeric axis with a pooled tail and
 * a dashed median rule, so they share an implementation rather than two
 * near-identical copies.
 *
 * Magnitude only — a single hue, never a value ramp, since bar length already
 * carries the count.
 */
function DistributionChart<T extends { drops: number }>({
  data,
  valueOf,
  cap,
  median,
  tickEvery,
  formatTick,
  formatMedian,
  describe,
  emptyLabel,
}: {
  data: Array<T>;
  /** The bucket's position on the x axis. */
  valueOf: (d: T) => number;
  /** Buckets at or above this pool the tail; labelled with a trailing "+". */
  cap: number;
  /** Median in the same unit as `valueOf`, for the annotation rule. */
  median: number;
  /** Label every nth bucket, measured in `valueOf` units. */
  tickEvery: number;
  formatTick: (v: number, capped: boolean) => string;
  formatMedian: (v: number) => string;
  /** Tooltip headline for one bucket. */
  describe: (v: number, capped: boolean) => string;
  emptyLabel: string;
}) {
  const tip = useChartTooltip<T>();
  if (data.length === 0) return <ChartEmpty label={emptyLabel} height={CHART_H} />;

  const margin = { top: 18, right: 8, bottom: 22, left: 30 };
  const max = d3max(data, (d) => d.drops) ?? 0;

  return (
    <ChartFrame height={CHART_H_RESPONSIVE}>
      {({ width, height }) => {
        const narrow = width < 480;
        const innerW = Math.max(0, width - margin.left - margin.right);
        const innerH = Math.max(0, height - margin.top - margin.bottom);
        const x = scaleBand({
          domain: data.map((d) => valueOf(d)),
          range: [0, innerW],
          padding: 0.18,
        });
        const y = scaleLinear({ domain: [0, max * 1.1 || 1], range: [innerH, 0], nice: true });
        const bw = x.bandwidth();
        const medX = x(Math.min(median, cap));

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
                {data.map((d) => {
                  const v = valueOf(d);
                  const bx = x(v) ?? 0;
                  const by = y(d.drops);
                  return (
                    <Group key={v}>
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
                        rx={2}
                        fill={PRIMARY}
                        onMouseMove={(e) => tip.show(d, clientXY(e))}
                        onTouchStart={(e) => tip.show(d, clientXY(e))}
                        onMouseLeave={tip.hide}
                      />
                      {(Math.abs(v % tickEvery) < 1e-9 || v >= cap) && (
                        <text
                          x={bx + bw / 2}
                          y={innerH + 14}
                          textAnchor="middle"
                          fontSize={narrow ? 11 : 10}
                          fill={AXIS_INK}
                        >
                          {formatTick(v, v >= cap)}
                        </text>
                      )}
                    </Group>
                  );
                })}
                {medX != null && median > 0 && (
                  <Group>
                    <Line
                      from={{ x: medX + bw / 2, y: -6 }}
                      to={{ x: medX + bw / 2, y: innerH }}
                      stroke={AXIS_INK}
                      strokeWidth={1}
                      strokeDasharray="3 2"
                    />
                    <text
                      x={medX + bw / 2 + 4}
                      y={-9}
                      fontSize={10}
                      fill={AXIS_INK}
                      className="tabular-nums"
                    >
                      median {formatMedian(median)}
                    </text>
                  </Group>
                )}
                <AxisLeft
                  scale={y}
                  numTicks={4}
                  hideTicks
                  hideAxisLine
                  tickLabelProps={() =>
                    tickLabelProps(
                      { textAnchor: "end", dx: "-0.25em", dy: "0.3em" },
                      narrow ? 12 : 11,
                    )
                  }
                />
              </Group>
            </svg>
            <tip.Tooltip>
              {(d) => {
                const v = valueOf(d);
                return (
                  <div className="flex w-full flex-col gap-0.5">
                    <span className="font-medium text-foreground">{describe(v, v >= cap)}</span>
                    <span className="text-foreground">
                      <span className="font-mono font-medium tabular-nums">{d.drops}</span>{" "}
                      <span className="text-muted-foreground">
                        {d.drops === 1 ? "drop" : "drops"}
                      </span>
                    </span>
                  </div>
                );
              }}
            </tip.Tooltip>
          </div>
        );
      }}
    </ChartFrame>
  );
}
/**
 * Per-ride drop analysis for the attraction detail page. Rendered only for rides
 * that actually offer the paid/virtual line — the caller gates on
 * `paidLineInfo(...).has`, same as the availability timeline.
 */
export function LightningLaneDrops({
  attractionId,
  queueType,
  product,
}: {
  attractionId: number;
  queueType: number;
  /** Operator label for the paid line — "Lightning Lane" or "Virtual Line". */
  product: string;
}) {
  const trpc = useTRPC();
  const q = useQuery({
    ...trpc.parks.llDrops.queryOptions({
      attractionId,
      queueType: queueType as 3 | 4,
    }),
    enabled: attractionId > 0,
  });

  if (q.isLoading) {
    return (
      <div className="grid gap-4 lg:grid-cols-2">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton
            key={i}
            className={cn("h-[296px] w-full rounded-2xl", i === 2 && "lg:col-span-2")}
          />
        ))}
      </div>
    );
  }

  const s = q.data?.summary;
  // Nothing ever sold out and came back, so there is no drop behaviour to chart.
  if (!s || s.drops === 0) return null;

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold tracking-tight">{product} drops</h2>
        <p className="text-sm text-muted-foreground">
          When this ride&rsquo;s {product} comes back after selling out —{" "}
          <span className="font-medium text-foreground">
            {s.drops.toLocaleString()} {s.drops === 1 ? "drop" : "drops"}
          </span>{" "}
          in the last 30 days, typically bookable for{" "}
          <span className="font-medium text-foreground">{s.medianOpenMins} min</span> before it
          sells out again.
        </p>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <AnalyticsCard
          title="When drops happen"
          description="Drops by hour of day (park local) · 30 days"
        >
          <DropsByHourChart data={q.data?.byHour ?? []} />
        </AnalyticsCard>
        <AnalyticsCard
          title="How long it stays bookable"
          description="Minutes open before selling out again · 30 days"
        >
          <DistributionChart
            data={q.data?.openLen ?? []}
            valueOf={(d) => d.mins}
            cap={45}
            median={s.medianOpenMins}
            tickEvery={10}
            formatTick={(v, capped) => (capped ? "45+" : String(v))}
            formatMedian={(v) => `${v}m`}
            describe={(v, capped) => (capped ? "45 min or longer" : `${v} min`)}
            emptyLabel="No drops recorded yet."
          />
        </AnalyticsCard>
        <div className="lg:col-span-2">
          <AnalyticsCard
            title="How soon you'd ride"
            description="Wait between catching a drop and the return time it offers · 30 days"
          >
            <DistributionChart
              data={q.data?.leadTime ?? []}
              valueOf={(d) => d.hours}
              cap={12}
              median={s.medianLeadHours}
              tickEvery={2}
              formatTick={(v, capped) => (capped ? "12h+" : v === 0 ? "now" : `${v}h`)}
              formatMedian={(v) => `${v}h`}
              describe={(v, capped) =>
                capped
                  ? "12 hours or more ahead"
                  : v === 0
                    ? "Return straight away"
                    : `${v} ${v === 1 ? "hour" : "hours"} ahead`
              }
              emptyLabel="No return windows recorded yet."
            />
          </AnalyticsCard>
        </div>
      </div>
    </section>
  );
}

/**
 * Park-wide ride x hour drop grid for the park analytics tab. Uses a single-hue
 * sequential ramp (magnitude, not identity) built from `--primary` at varying
 * alpha, so it tracks the theme and needs no second palette.
 */
export function ParkLlDropsHeatmap({
  data,
}: {
  data: Array<{ name: string; hour: number; drops: number }>;
}) {
  const tip = useChartTooltip<{ name: string; hour: number; drops: number }>();

  const { rides, hours, byKey, max } = React.useMemo(() => {
    const totals = new Map<string, number>();
    let lo = 23;
    let hi = 0;
    let mx = 0;
    const map = new Map<string, number>();
    for (const c of data) {
      totals.set(c.name, (totals.get(c.name) ?? 0) + c.drops);
      if (c.hour < lo) lo = c.hour;
      if (c.hour > hi) hi = c.hour;
      if (c.drops > mx) mx = c.drops;
      map.set(`${c.name}|${c.hour}`, c.drops);
    }
    // Busiest droppers first — that's the ordering a guest scans for.
    const ordered = [...totals.entries()].sort((a, b) => b[1] - a[1]).map(([n]) => n);
    const hs = hi >= lo ? Array.from({ length: hi - lo + 1 }, (_, i) => lo + i) : [];
    return { rides: ordered.slice(0, 12), hours: hs, byKey: map, max: mx };
  }, [data]);

  if (rides.length === 0 || hours.length === 0)
    return (
      <ChartEmpty label="No Lightning Lane drops recorded in this park yet." height={CHART_H} />
    );

  return (
    <div className="relative w-full overflow-x-auto">
      <div className="min-w-[520px]">
        <div className="flex flex-col gap-[2px]">
          {rides.map((name) => (
            <div key={name} className="flex items-center gap-[2px]">
              <span className="w-[104px] shrink-0 truncate pr-1 text-right text-[11px] text-muted-foreground">
                {truncate(name, 18)}
              </span>
              {hours.map((h) => {
                const drops = byKey.get(`${name}|${h}`) ?? 0;
                const t = max > 0 ? drops / max : 0;
                return (
                  <div
                    key={h}
                    className="h-5 flex-1 rounded-[3px]"
                    style={{
                      background:
                        drops === 0
                          ? "color-mix(in oklab, var(--muted) 70%, transparent)"
                          : `color-mix(in oklab, ${PRIMARY} ${Math.round(18 + t * 82)}%, transparent)`,
                    }}
                    onMouseMove={(e) => tip.show({ name, hour: h, drops }, clientXY(e))}
                    onTouchStart={(e) => tip.show({ name, hour: h, drops }, clientXY(e))}
                    onMouseLeave={tip.hide}
                  />
                );
              })}
            </div>
          ))}
          <div className="flex items-center gap-[2px]">
            <span className="w-[104px] shrink-0" />
            {hours.map((h) => (
              <span
                key={h}
                className="flex-1 text-center text-[10px] tabular-nums text-muted-foreground"
              >
                {h % 3 === 0 ? hourLabel(h) : ""}
              </span>
            ))}
          </div>
        </div>
      </div>
      <tip.Tooltip>
        {(c) => (
          <div className="flex w-full flex-col gap-0.5">
            <span className="font-medium text-foreground">{c.name}</span>
            <span className="text-muted-foreground">
              {hourLabel(c.hour)} ·{" "}
              <span className="font-mono tabular-nums text-foreground">{c.drops}</span>{" "}
              {c.drops === 1 ? "drop" : "drops"}
            </span>
          </div>
        )}
      </tip.Tooltip>
    </div>
  );
}
