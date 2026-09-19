"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";

import {
  ChartLegend,
  ChartSentence,
  ColumnChart,
  LegendKey,
  bestRun,
  clockLabel,
  deltaClause,
  deltaTone,
  hourLabel,
  mean,
  useParkClock,
} from "#/components/detail/chart-kit.tsx";
import { WeekdayColumns } from "#/components/detail/day-series.tsx";
import { HourDayHeatmap } from "#/components/detail/hour-day-heatmap.tsx";
import { TrendChart, type TrendPoint } from "#/components/detail/trend-chart.tsx";
import { ToggleGroup, ToggleGroupItem } from "#/components/ui/toggle-group.tsx";
import { useTRPC } from "#/integrations/trpc/react.ts";

import { WAIT_WORDS } from "./park-crowd-calendar.tsx";
import { AnalyticsCard, ChartEmpty, CHART_H } from "./visx/kit.tsx";

const minutes = (v: number) => `${Math.round(v)} min`;

// ───────────────────────── 1. Wait trend (windowed line) ─────────────────────
type TrendWindow = 24 | 168 | 720;
const WINDOW_LABEL: Record<TrendWindow, string> = { 24: "24h", 168: "7d", 720: "30d" };
const WINDOW_WORDS: Record<TrendWindow, string> = { 24: "day", 168: "week", 720: "month" };

type HistoryBucket = {
  bucket: string;
  avgWait: number | null;
  minWait: number | null;
  maxWait: number | null;
  samples: number;
  /** The park calendar says shut for this bucket — see `parks.history`. */
  closed?: boolean;
};

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
 * the line can bridge with a dash, instead of a silent straight line across it.
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

/** Local hour-of-day (with fractional minutes). */
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

/** The bucket closest to local noon — so a date label sits over the open day,
 *  not over the overnight hatch. */
function closestToNoon(buckets: Array<HistoryBucket>, timeZone: string): number {
  let best = buckets[0]!;
  let bestDist = Infinity;
  for (const b of buckets) {
    const dist = Math.abs(hourOfDay(new Date(b.bucket), timeZone) - 12);
    if (dist < bestDist) {
      bestDist = dist;
      best = b;
    }
  }
  return new Date(best.bucket).getTime();
}

const isSunday = (d: Date, timeZone: string) =>
  new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone }).format(d) === "Sun";

/** Where the labels go: every third hour for a day, each day's noon for a
 *  week, each Sunday's noon for a month. */
function tickValues(
  grid: Array<HistoryBucket>,
  hours: TrendWindow,
  timeZone: string,
): Array<number> {
  if (hours === 24) {
    return grid.flatMap((b) => {
      const h = hourOfDay(new Date(b.bucket), timeZone);
      return h % 3 === 0 ? [new Date(b.bucket).getTime()] : [];
    });
  }
  const byDay = new Map<string, Array<HistoryBucket>>();
  for (const b of grid) {
    const d = new Date(b.bucket);
    if (hours === 720 && !isSunday(d, timeZone)) continue;
    const key = dayKey(d, timeZone);
    const list = byDay.get(key);
    if (list) list.push(b);
    else byDay.set(key, [b]);
  }
  return [...byDay.values()].map((bs) => closestToNoon(bs, timeZone));
}

/** How near the last reading must be to the clock to be called "now". */
const NOW_SLACK_MS = 25 * 60_000;

function WaitTrend({
  data,
  timeZone,
  hours,
}: {
  data: Array<HistoryBucket>;
  timeZone: string;
  hours: TrendWindow;
}) {
  const [sel, setSel] = React.useState<number | null>(null);
  const grid = React.useMemo(() => fillGrid(data, BUCKET_MS[hours]), [data, hours]);
  const points = React.useMemo<Array<TrendPoint>>(
    () =>
      grid.map((b) => ({
        t: new Date(b.bucket).getTime(),
        value: b.closed ? null : b.avgWait,
        lo: b.minWait,
        hi: b.maxWait,
        closed: b.closed,
      })),
    [grid],
  );
  const ticks = React.useMemo(() => tickValues(grid, hours, timeZone), [grid, hours, timeZone]);

  const live = points.flatMap((p, i) => (p.value == null ? [] : [i]));
  if (live.length < 2) return <ChartEmpty label="Not enough wait history yet." height={CHART_H} />;

  const lastLive = live[live.length - 1]!;
  const isNow = Date.now() - points[lastLive]!.t < NOW_SLACK_MS + BUCKET_MS[hours];
  const nowValue = isNow ? (points[lastLive]!.value as number) : null;
  const peakIdx = live.reduce((b, i) =>
    (points[i]!.value as number) > (points[b]!.value as number) ? i : b,
  );
  const peak = points[peakIdx]!;
  const avg = mean(live.map((i) => points[i]!.value as number)) ?? 0;

  const when = (t: number, long = false) =>
    new Date(t).toLocaleString("en-US", {
      ...(hours > 24 || long ? { month: "short", day: "numeric" } : {}),
      hour: "numeric",
      minute: hours === 24 ? "2-digit" : undefined,
      timeZone,
    });

  const active = sel != null ? points[sel]! : null;
  let headline: string;
  let subline: string;
  let tone: "good" | "bad" | "neutral" = "neutral";
  if (active && sel !== (isNow ? lastLive : -1)) {
    const b = grid[sel!]!;
    if (active.closed) {
      headline = `${when(active.t)} · park closed`;
      subline = "No line to measure.";
    } else if (active.value == null) {
      headline = `${when(active.t)} · no reading`;
      subline = "We didn't get a poll back for this stretch; the dash bridges it.";
    } else {
      headline = `${when(active.t)} was ${minutes(active.value)}`;
      const range =
        b.minWait != null && b.maxWait != null && b.maxWait > b.minWait
          ? `Ranged ${b.minWait}–${b.maxWait} min. `
          : "";
      subline =
        range +
        (nowValue != null
          ? deltaClause(active.value, nowValue, minutes, "the line right now", {
              more: "longer than",
              less: "shorter than",
            })
          : deltaClause(active.value, avg, minutes, `the ${WINDOW_WORDS[hours]}'s average`, {
              more: "longer than",
              less: "shorter than",
            }));
      tone = deltaTone(active.value, nowValue ?? avg);
    }
  } else if (nowValue != null) {
    headline = `Right now: ${minutes(nowValue)}`;
    subline = `Peaked at ${when(peak.t)} · ${minutes(peak.value as number)}. Tap the line to compare.`;
  } else {
    headline = `Peaked ${when(peak.t, true)} · ${minutes(peak.value as number)}`;
    subline = `Averaged ${minutes(avg)} over the ${WINDOW_WORDS[hours]}. Tap the line for a time.`;
  }

  const hasBand = grid.some((b) => b.minWait != null && b.maxWait != null && b.maxWait > b.minWait);
  const hasClosed = grid.some((b) => b.closed);

  return (
    <div className="flex flex-col gap-3">
      <ChartSentence headline={headline} subline={subline} tone={tone} />
      <TrendChart
        points={points}
        selected={sel}
        onSelect={setSel}
        format={minutes}
        tickValues={ticks}
        tickFormat={(d) =>
          hours === 24
            ? d.toLocaleTimeString("en-US", { hour: "numeric", timeZone })
            : hours === 720
              ? d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone })
              : d.toLocaleDateString("en-US", { weekday: "short", timeZone })
        }
        anchor={
          nowValue != null ? { index: lastLive, label: `Now · ${Math.round(nowValue)}` } : null
        }
        height={{ base: 150, md: 200 }}
      />
      <ChartLegend>
        <LegendKey swatch="measured">Standby</LegendKey>
        {hasBand && <LegendKey swatch="band">Range within the bucket</LegendKey>}
        {nowValue != null && <LegendKey swatch="now">Now</LegendKey>}
        {hasClosed && <LegendKey swatch="hatch">Park closed</LegendKey>}
      </ChartLegend>
    </div>
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
      description={`Standby over the last ${WINDOW_LABEL[hours]}`}
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
        <WaitTrend data={q.data ?? []} timeZone={timeZone} hours={hours} />
      )}
    </AnalyticsCard>
  );
}

// ───────────────────────── 2. Best time to ride (hour columns) ───────────────
type HourDatum = { hour: number; avgWait: number; peak: number; samples: number };

/**
 * The ride's day in thirty days of averages — the "When to ride" bars again,
 * over history instead of today. The quietest stretch gets the sweet-spot
 * bracket, the hour you're standing in gets the yellow pill, and pointing at
 * an hour compares it with right now (or with the quietest hour, after
 * close).
 */
function HourColumns({ data, nowHour }: { data: Array<HourDatum>; nowHour: number | null }) {
  const [sel, setSel] = React.useState<number | null>(null);
  if (data.length === 0) return <ChartEmpty label="Not enough history yet." height={CHART_H} />;

  const lo = Math.min(...data.map((d) => d.hour));
  const hi = Math.max(...data.map((d) => d.hour));
  const byHour = new Map(data.map((d) => [d.hour, d]));
  const hours = Array.from({ length: hi - lo + 1 }, (_, i) => lo + i);
  const values = hours.map((h) => byHour.get(h)?.avgWait ?? null);
  const window = bestRun(values, "min", 4);
  const peak = data.reduce((b, d) => (d.avgWait > b.avgWait ? d : b));
  const nowIdx = nowHour != null && nowHour >= lo && nowHour <= hi ? nowHour - lo : -1;
  const nowValue = nowIdx >= 0 ? values[nowIdx] : null;
  const quietest = window ? { hour: hours[window.lo]!, value: window.value } : null;
  const reference =
    nowValue != null
      ? { value: nowValue, name: "this hour" }
      : quietest
        ? { value: quietest.value, name: `${hourLabel(quietest.hour)}, the quietest hour` }
        : null;

  const active = sel != null ? values[sel] : null;
  let headline: string;
  let subline: string;
  let tone: "good" | "bad" | "neutral" = "neutral";
  if (sel != null && active != null && sel !== nowIdx) {
    headline = `${hourLabel(hours[sel]!)} usually runs about ${minutes(active)}`;
    subline = reference
      ? deltaClause(active, reference.value, minutes, reference.name, {
          more: "longer than",
          less: "shorter than",
        })
      : `Peaked at ${byHour.get(hours[sel]!)?.peak ?? active} min.`;
    tone = reference ? deltaTone(active, reference.value) : "neutral";
  } else if (sel != null && active == null) {
    headline = `${hourLabel(hours[sel]!)} · no readings`;
    subline = "The ride hasn't posted a wait at this hour in the last month.";
  } else if (nowValue != null) {
    headline = `This hour usually runs about ${minutes(nowValue)}`;
    subline = window
      ? `Quietest stretch: ${hourLabel(hours[window.lo]!)} – ${clockLabel((hours[window.hi]! + 1) * 60)}. Tap a bar to compare.`
      : "Tap a bar to compare.";
  } else if (quietest) {
    headline = `Quietest around ${hourLabel(quietest.hour)} · ${minutes(quietest.value)}`;
    subline = `Busiest at ${hourLabel(peak.hour)} · ${minutes(peak.avgWait)}. Tap a bar for the hour.`;
  } else {
    headline = `Busiest at ${hourLabel(peak.hour)} · ${minutes(peak.avgWait)}`;
    subline = "Tap a bar for the hour.";
  }

  return (
    <div className="flex flex-col gap-3">
      <ChartSentence headline={headline} subline={subline} tone={tone} size="sm" />
      <ColumnChart
        columns={hours.map((h, i) => ({
          key: h,
          value: values[i]!,
          label: hourLabel(h),
          name: `${hourLabel(h)}: ${values[i] == null ? "no readings" : `usually about ${minutes(values[i]!)}`}`,
          tone:
            i === nowIdx ? "now" : window && i >= window.lo && i <= window.hi ? "best" : "measured",
        }))}
        max={Math.max(20, peak.avgWait)}
        selected={sel}
        onSelect={setSel}
        anchor={
          nowIdx >= 0 && nowValue != null
            ? { index: nowIdx, label: `Now · ${Math.round(nowValue)}` }
            : null
        }
        bracket={window ? { lo: window.lo, hi: window.hi, label: "Sweet spot" } : null}
        labelKeep={(_c, i) => hours[i]! % 3 === 0 || i === 0 || i === hours.length - 1}
        heightClass="h-36 md:h-44"
      />
      <ChartLegend>
        <LegendKey swatch="measured">Usual standby</LegendKey>
        {window && <LegendKey swatch="best">Quietest stretch</LegendKey>}
        {nowIdx >= 0 && <LegendKey swatch="now">This hour</LegendKey>}
      </ChartLegend>
    </div>
  );
}

// ───────────────────────── Section ───────────────────────────────────────────
/**
 * Per-ride analysis charts for the attraction detail page: a windowed wait
 * trend (off `parks.history`) plus hour-of-day, day-of-week, and crowd-calendar
 * rollups from `parks.rideAnalytics`, all in the "When to ride" chart
 * language. Each chart is error-isolated by its `AnalyticsCard`.
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
  const tz = q.data?.timezone ?? timezone;
  const clock = useParkClock(tz);

  const hourly = q.data?.hourly ?? [];
  const weekdayMeans = React.useMemo(() => {
    const means: Array<number | null> = [null, null, null, null, null, null, null];
    for (const w of q.data?.weekday ?? []) means[w.dow] = Math.round(w.avgWait);
    return means;
  }, [q.data]);
  const hourPeak = hourly.reduce<HourDatum | null>(
    (b, d) => (!b || d.avgWait > b.avgWait ? d : b),
    null,
  );
  const todayDow = clock ? new Date(`${clock.date}T00:00:00`).getDay() : null;

  return (
    // No heading of its own: the page's "Know" band already says what these
    // are, and a second title inside it read as a nested page (the park page's
    // analytics grid dropped its own for the same reason).
    <section className="flex flex-col gap-4">
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="lg:col-span-2">
          <WaitTrendCard attractionId={attractionId} timeZone={tz} />
        </div>
        <AnalyticsCard
          title="Best time to ride"
          description="Usual standby by hour of day · 30 days"
          meta={
            hourPeak
              ? `Peaks ${hourLabel(hourPeak.hour)} · ${minutes(hourPeak.avgWait)}`
              : undefined
          }
        >
          <HourColumns data={hourly} nowHour={clock?.hour ?? null} />
        </AnalyticsCard>
        <AnalyticsCard title="By day of week" description="Usual standby by weekday · 30 days">
          {weekdayMeans.every((m) => m == null) ? (
            <ChartEmpty label="Not enough history yet." height={CHART_H} />
          ) : (
            <WeekdayColumns
              means={weekdayMeans}
              good="min"
              unit={minutes}
              words={WAIT_WORDS}
              today={todayDow}
              heightClass="h-36 md:h-44"
            />
          )}
        </AnalyticsCard>
        <div className="lg:col-span-2">
          <AnalyticsCard
            title="Crowd calendar"
            description="Usual standby by day and hour, park local · 14 days"
          >
            {(q.data?.heatmap ?? []).length === 0 ? (
              <ChartEmpty label="Not enough history for a calendar yet." height={CHART_H} />
            ) : (
              <HourDayHeatmap
                cells={(q.data?.heatmap ?? []).map((c) => ({
                  date: c.date,
                  hour: c.hour,
                  value: c.avgWait,
                }))}
                today={clock?.date ?? null}
                nowHour={clock?.hour ?? null}
                unit={minutes}
                subject="this ride"
              />
            )}
          </AnalyticsCard>
        </div>
      </div>
    </section>
  );
}
