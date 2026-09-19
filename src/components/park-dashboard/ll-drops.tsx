"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";

import {
  ChartLegend,
  ChartSentence,
  ColumnChart,
  LegendKey,
  HeatRampKey,
  bestRun,
  clockLabel,
  heatBg,
  heatStepOf,
  hourLabel,
  useParkClock,
} from "#/components/detail/chart-kit.tsx";
import { Skeleton } from "#/components/ui/skeleton.tsx";
import { useTRPC } from "#/integrations/trpc/react.ts";
import { cn } from "#/lib/utils.ts";

import { AnalyticsCard, ChartEmpty, CHART_H, truncate } from "./visx/kit.tsx";

/**
 * Lightning Lane / Virtual Line **drop** charts.
 *
 * A drop is the operator returning inventory after the line sold out. The data
 * behind these charts is a `SOLD_OUT -> AVAILABLE` edge on `queue_obs`; see the
 * `parks.llDrops` procedure for the rollup and `research/lightning-lane-drop-alerts.md`
 * for why each form was chosen.
 *
 * Every measure here is a plain count of drops, so the bars take the one wash
 * hue and the good answer — the hour with the most drops — is mint. The hour
 * you're standing in wears the yellow "Now" pill; a median is a reference
 * rather than a place, so it takes the wash-ink pill instead.
 */

type HourDatum = { hour: number; drops: number };

const drops = (n: number) => `${n} ${n === 1 ? "drop" : "drops"}`;

/** Drops by hour of day — "what time should I be watching?" */
function DropsByHour({ data, nowHour }: { data: Array<HourDatum>; nowHour: number | null }) {
  const [sel, setSel] = React.useState<number | null>(null);
  if (data.length === 0) return <ChartEmpty label="No drops recorded yet." height={CHART_H} />;

  // A continuous clock spine so quiet hours read as real gaps, not as missing
  // categories. Trimmed to the range that actually saw activity.
  const lo = Math.min(...data.map((d) => d.hour));
  const hi = Math.max(...data.map((d) => d.hour));
  const byHour = new Map(data.map((d) => [d.hour, d.drops]));
  const hours = Array.from({ length: hi - lo + 1 }, (_, i) => lo + i);
  const values = hours.map((h) => byHour.get(h) ?? 0);
  const max = Math.max(...values);
  const total = values.reduce((a, b) => a + b, 0);
  // The hours worth watching: the busiest, widened to neighbours within a
  // fifth of it.
  const window = bestRun(values, "max", Math.max(1, Math.round(max * 0.2)));
  const peakIdx = values.indexOf(max);
  const nowIdx = nowHour != null && nowHour >= lo && nowHour <= hi ? nowHour - lo : -1;

  let headline: string;
  let subline: string;
  if (sel != null && sel !== nowIdx) {
    const v = values[sel]!;
    headline = `${hourLabel(hours[sel]!)} · ${drops(v)} in 30 days`;
    subline =
      v === 0
        ? "Nothing has come back at this hour."
        : sel === peakIdx
          ? "The busiest hour for drops."
          : `${Math.round((v / total) * 100)}% of the month's drops · ${max - v} fewer than ${hourLabel(hours[peakIdx]!)}, the best hour.`;
  } else if (nowIdx >= 0) {
    const v = values[nowIdx]!;
    headline =
      v === 0 ? "This hour rarely sees a drop" : `This hour has seen ${drops(v)} in 30 days`;
    subline = window
      ? `Best odds: ${hourLabel(hours[window.lo]!)} – ${clockLabel((hours[window.hi]! + 1) * 60)}. Tap an hour to compare.`
      : "Tap an hour to compare.";
  } else {
    headline = `Most drops land around ${hourLabel(hours[peakIdx]!)} · ${drops(max)}`;
    subline = window
      ? `Best odds: ${hourLabel(hours[window.lo]!)} – ${clockLabel((hours[window.hi]! + 1) * 60)}. Tap an hour for its count.`
      : "Tap an hour for its count.";
  }

  return (
    <div className="flex flex-col gap-3">
      <ChartSentence headline={headline} subline={subline} size="sm" />
      <ColumnChart
        columns={hours.map((h, i) => ({
          key: h,
          value: values[i]!,
          label: hourLabel(h),
          name: `${hourLabel(h)}: ${drops(values[i]!)} in 30 days`,
          tone:
            i === nowIdx ? "now" : window && i >= window.lo && i <= window.hi ? "best" : "measured",
        }))}
        max={Math.max(1, max)}
        selected={sel}
        onSelect={setSel}
        anchor={nowIdx >= 0 ? { index: nowIdx, label: `Now · ${values[nowIdx]}` } : null}
        bracket={window ? { lo: window.lo, hi: window.hi, label: "Best odds" } : null}
        labelKeep={(_c, i) => hours[i]! % 3 === 0 || i === 0 || i === hours.length - 1}
        heightClass="h-36 md:h-44"
      />
      <ChartLegend>
        <LegendKey swatch="measured">Drops</LegendKey>
        {window && <LegendKey swatch="best">Best odds</LegendKey>}
        {nowIdx >= 0 && <LegendKey swatch="now">This hour</LegendKey>}
      </ChartLegend>
    </div>
  );
}

/**
 * Shared one-hue histogram for the two distribution cards. Both plot "how many
 * drops fell in this bucket" over an ordered numeric axis with a pooled tail
 * and the median pinned, so they share an implementation.
 */
function Distribution<T extends { drops: number }>({
  data,
  valueOf,
  cap,
  median,
  tickEvery,
  formatTick,
  formatMedian,
  describe,
  idle,
  emptyLabel,
}: {
  data: Array<T>;
  /** The bucket's position on the x axis. */
  valueOf: (d: T) => number;
  /** Buckets at or above this pool the tail; labelled with a trailing "+". */
  cap: number;
  /** Median in the same unit as `valueOf`, for the pinned mark. */
  median: number;
  /** Label every nth bucket, measured in `valueOf` units. */
  tickEvery: number;
  formatTick: (v: number, capped: boolean) => string;
  formatMedian: (v: number) => string;
  /** How one bucket is named in the sentence. */
  describe: (v: number, capped: boolean) => string;
  /** The sentence with nothing pointed at. */
  idle: { headline: string; subline: string };
  emptyLabel: string;
}) {
  const [sel, setSel] = React.useState<number | null>(null);
  if (data.length === 0) return <ChartEmpty label={emptyLabel} height={CHART_H} />;

  const total = data.reduce((s, d) => s + d.drops, 0);
  const max = Math.max(...data.map((d) => d.drops));
  const medianTarget = Math.min(median, cap);
  // The bucket the median falls in: the last one at or under it.
  let medianIdx = -1;
  data.forEach((d, i) => {
    if (valueOf(d) <= medianTarget) medianIdx = i;
  });

  let headline: string;
  let subline: string;
  if (sel != null) {
    const d = data[sel]!;
    const v = valueOf(d);
    headline = `${describe(v, v >= cap)} · ${drops(d.drops)}`;
    subline =
      d.drops === 0
        ? "None of the month's drops landed here."
        : `${Math.round((d.drops / total) * 100)}% of the month's drops.${sel === medianIdx ? " The median lands here." : ""}`;
  } else {
    headline = idle.headline;
    subline = idle.subline;
  }

  return (
    <div className="flex flex-col gap-3">
      <ChartSentence headline={headline} subline={subline} size="sm" />
      <ColumnChart
        columns={data.map((d) => {
          const v = valueOf(d);
          return {
            key: v,
            value: d.drops,
            label: formatTick(v, v >= cap),
            name: `${describe(v, v >= cap)}: ${drops(d.drops)}`,
            tone: "measured" as const,
          };
        })}
        max={Math.max(1, max)}
        selected={sel}
        onSelect={setSel}
        anchor={
          medianIdx >= 0 && median > 0
            ? { index: medianIdx, label: `Median · ${formatMedian(median)}`, tone: "mark" }
            : null
        }
        labelKeep={(c) => {
          const v = Number(c.key);
          return Math.abs(v % tickEvery) < 1e-9 || v >= cap;
        }}
        heightClass="h-36 md:h-44"
      />
      <ChartLegend>
        <LegendKey swatch="measured">Drops</LegendKey>
        {medianIdx >= 0 && median > 0 && <LegendKey swatch="mark">Median</LegendKey>}
      </ChartLegend>
    </div>
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
  timeZone,
}: {
  attractionId: number;
  queueType: number;
  /** Operator label for the paid line — "Lightning Lane" or "Virtual Line". */
  product: string;
  /** The park's timezone, to pin "Now" on the hour chart. */
  timeZone?: string | null;
}) {
  const trpc = useTRPC();
  const q = useQuery({
    ...trpc.parks.llDrops.queryOptions({
      attractionId,
      queueType: queueType as 3 | 4,
    }),
    enabled: attractionId > 0,
  });
  const clock = useParkClock(timeZone);

  // See the note in `ParkAnalytics` — `isLoading` is false on the first render.
  if (!q.data) {
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
          description="Drops by hour of day, park local · 30 days"
          meta={`${s.drops.toLocaleString()} ${s.drops === 1 ? "drop" : "drops"}`}
        >
          <DropsByHour data={q.data?.byHour ?? []} nowHour={clock?.hour ?? null} />
        </AnalyticsCard>
        <AnalyticsCard
          title="How long it stays bookable"
          description="Minutes open before selling out again · 30 days"
          meta={`Median ${s.medianOpenMins} min`}
        >
          <Distribution
            data={q.data?.openLen ?? []}
            valueOf={(d) => d.mins}
            cap={45}
            median={s.medianOpenMins}
            tickEvery={10}
            formatTick={(v, capped) => (capped ? "45+" : String(v))}
            formatMedian={(v) => `${v}m`}
            describe={(v, capped) => (capped ? "Open 45 min or longer" : `Open ${v} min`)}
            idle={{
              headline: `Typically bookable for ${s.medianOpenMins} min`,
              subline: "Half of drops sell out again sooner, half later. Tap a bar for its share.",
            }}
            emptyLabel="No drops recorded yet."
          />
        </AnalyticsCard>
        <div className="lg:col-span-2">
          <AnalyticsCard
            title="How soon you'd ride"
            description="Wait between catching a drop and the return time it offers · 30 days"
            meta={`Median ${s.medianLeadHours}h`}
          >
            <Distribution
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
                    : `Return ${v} ${v === 1 ? "hour" : "hours"} ahead`
              }
              idle={{
                headline:
                  s.medianLeadHours === 0
                    ? "Most drops let you ride straight away"
                    : `A caught drop typically returns ${s.medianLeadHours}h later`,
                subline:
                  "How far ahead the return window it hands you sits. Tap a bar for its share.",
              }}
              emptyLabel="No return windows recorded yet."
            />
          </AnalyticsCard>
        </div>
      </div>
    </section>
  );
}

/**
 * Park-wide ride x hour drop grid for the park analytics tab: the busiest
 * droppers first, each hour shaded on the house heat ramp, the cell you point
 * at spoken above.
 */
export function ParkLlDropsHeatmap({
  data,
  nowHour,
}: {
  data: Array<{ name: string; hour: number; drops: number }>;
  nowHour?: number | null;
}) {
  const [sel, setSel] = React.useState<string | null>(null);

  const { rides, totals, hours, byKey, max } = React.useMemo(() => {
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
    return { rides: ordered.slice(0, 12), totals, hours: hs, byKey: map, max: mx };
  }, [data]);

  if (rides.length === 0 || hours.length === 0)
    return (
      <ChartEmpty label="No Lightning Lane drops recorded in this park yet." height={CHART_H} />
    );

  const top = rides[0]!;
  let headline: string;
  let subline: string;
  if (sel) {
    const [name, h] = sel.split("|") as [string, string];
    const v = byKey.get(sel) ?? 0;
    headline = `${name} at ${hourLabel(Number(h))} · ${drops(v)}`;
    subline = `${drops(totals.get(name) ?? 0)} across the month for this ride.`;
  } else {
    headline = `${top} drops most · ${drops(totals.get(top) ?? 0)} in 30 days`;
    subline = "Busiest droppers first. Tap a cell for a ride's hour.";
  }

  const grid = { gridTemplateColumns: `minmax(0, 7rem) repeat(${hours.length}, minmax(0, 1fr))` };

  return (
    <div className="flex flex-col gap-3">
      <ChartSentence headline={headline} subline={subline} size="sm" />
      <div className="flex flex-col gap-[3px]" onMouseLeave={() => setSel(null)}>
        {rides.map((name) => (
          <div key={name} className="grid items-center gap-[3px]" style={grid}>
            <span
              className="truncate pr-1.5 text-right text-[10.5px] leading-none font-bold text-wash-muted"
              title={name}
            >
              {truncate(name, 20)}
            </span>
            {hours.map((h) => {
              const key = `${name}|${h}`;
              const v = byKey.get(key) ?? 0;
              const hot = sel === key;
              return (
                <button
                  key={h}
                  type="button"
                  aria-label={`${name} at ${hourLabel(h)}: ${drops(v)}`}
                  aria-pressed={hot}
                  onMouseEnter={() => setSel(key)}
                  onFocus={() => setSel(key)}
                  onBlur={() => setSel(null)}
                  onClick={() => setSel(key)}
                  className={cn(
                    "h-4 min-w-0 cursor-pointer rounded-[3px] outline-none transition-[box-shadow] md:h-5",
                    v === 0 ? "bg-wash-bar/35" : heatBg(heatStepOf(v, 1, max)),
                    h === nowHour && "ring-2 ring-brand-yellow ring-inset",
                    hot && "ring-[3px] ring-wash-fg/50 ring-inset",
                  )}
                />
              );
            })}
          </div>
        ))}
        <div className="grid gap-[3px]" style={grid} aria-hidden>
          <span />
          {hours.map((h) => (
            <span
              key={h}
              className={cn(
                "min-w-0 text-center text-[10px] leading-[14px] font-bold whitespace-nowrap",
                h === nowHour ? "text-wash-fg" : "text-wash-muted",
              )}
            >
              {h % 3 === 0 ? hourLabel(h).replace(" ", " ") : ""}
            </span>
          ))}
        </div>
      </div>
      <ChartLegend>
        <HeatRampKey from="1" to={drops(max)} />
        {nowHour != null && <LegendKey swatch="now">This hour</LegendKey>}
      </ChartLegend>
    </div>
  );
}
