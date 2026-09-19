"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDownIcon } from "lucide-react";

import { Band, BandHeading } from "#/components/detail/band.tsx";
import {
  ChartLegend,
  ChartSentence,
  LegendKey,
  bestRun,
  deltaClause,
  deltaTone,
} from "#/components/detail/chart-kit.tsx";
import { WashPanel } from "#/components/detail/panels.tsx";
import { TrendChart, type TrendPoint } from "#/components/detail/trend-chart.tsx";
import { PageBody, PageMasthead } from "#/components/site-chrome/page-masthead.tsx";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "#/components/ui/collapsible.tsx";
import { Empty, EmptyDescription, EmptyTitle } from "#/components/ui/empty.tsx";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "#/components/ui/select.tsx";
import { Skeleton } from "#/components/ui/skeleton.tsx";
import { useTRPC } from "#/integrations/trpc/react.ts";
import { cn } from "#/lib/utils.ts";

/** Tomorrow as a YYYY-MM-DD string (the default crowd-forecast date). */
function tomorrowIso(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** "Monday, August 31" from a YYYY-MM-DD string. */
function friendlyDate(iso: string): string {
  return new Date(`${iso}T12:00:00`).toLocaleDateString([], {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

function fmt1(n: number | null | undefined): string {
  return n == null ? "—" : (Math.round(n * 10) / 10).toLocaleString();
}

function Tile({
  label,
  value,
  sub,
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1 rounded-[22px] border border-card-edge bg-card p-5">
      <span className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
        {label}
      </span>
      <span className="text-2xl leading-tight font-extrabold tracking-[-0.02em] tabular-nums">
        {value}
      </span>
      {sub && <span className="line-clamp-1 text-xs text-muted-foreground">{sub}</span>}
    </div>
  );
}

const WINDOW_LABELS: Record<string, string> = {
  "24h": "day",
  "7d": "week",
  "30d": "month",
  all: "the whole time we've been forecasting",
};

/**
 * "How accurate is this?" — one plain-language headline plus three friendly
 * tiles, with the model-ops numbers (RMSE/MAPE/R², model version, cadence)
 * tucked into a collapsible technical-details disclosure. Numbers come from
 * the cross-version pipeline rollup (see forecast.accuracy).
 */
function AccuracySection() {
  const trpc = useTRPC();
  const q = useQuery(trpc.forecast.accuracy.queryOptions());

  if (q.isLoading) {
    return (
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-24 rounded-4xl" />
        ))}
      </div>
    );
  }

  const data = q.data;
  if (!data?.model) {
    return (
      <Empty>
        <EmptyTitle>No forecasts yet</EmptyTitle>
        <EmptyDescription>
          Accuracy numbers appear once the first forecasts have been made and checked.
        </EmptyDescription>
      </Empty>
    );
  }

  // Prefer the 7d window, falling back to 30d, then any window present.
  const byWindow = new Map(data.windows.map((w) => [w.window, w]));
  const win = byWindow.get("7d") ?? byWindow.get("30d") ?? data.windows[0];

  if (!win || win.mae == null) {
    return (
      <Empty>
        <EmptyTitle>Still checking our work</EmptyTitle>
        <EmptyDescription>
          Every forecast gets compared against the wait times that actually happened. Accuracy
          numbers appear here automatically once enough have been checked.
        </EmptyDescription>
      </Empty>
    );
  }

  const windowLabel = WINDOW_LABELS[win.window] ?? win.window;

  return (
    <div className="flex flex-col gap-4">
      <p className="max-w-prose text-sm text-muted-foreground">
        Every prediction is checked against the wait time that actually got posted. Over the past{" "}
        {windowLabel}, our forecasts have typically landed within{" "}
        <span className="font-medium text-foreground">±{fmt1(win.mae)} minutes</span> of the real
        wait
        {win.nPredictions > 0 && (
          <>
            , across{" "}
            <span className="font-medium text-foreground">{win.nPredictions.toLocaleString()}</span>{" "}
            checked predictions
          </>
        )}
        .
      </p>
      {!win.ready && (
        <p className="text-sm text-muted-foreground">
          Early days — these numbers will settle as more forecasts get checked.
        </p>
      )}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
        <Tile
          label="Typically within"
          value={`±${fmt1(win.mae)} min`}
          sub={`of the real wait, past ${windowLabel}`}
        />
        <Tile
          label="Predictions checked"
          value={win.nPredictions.toLocaleString()}
          sub="compared against real waits"
        />
        <Tile
          label="Checkable forecasts verified"
          value={win.coveragePct == null ? "—" : `${Math.round(win.coveragePct * 100)}%`}
          sub="the rest await wait-time data"
        />
      </div>
      <TechnicalDetails model={data.model} windows={data.windows} />
    </div>
  );
}

function relativeAge(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const h = Math.floor(ms / 3_600_000);
  if (h < 1) return "less than an hour ago";
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

type AccuracyWindow = {
  window: string;
  mae: number | null;
  rmse: number | null;
  mape: number | null;
  r2: number | null;
  nPredictions: number;
  coveragePct: number | null;
};

/** The model-ops view, folded away for the curious: version, cadence, and the
 * full error table per rolling window. */
function TechnicalDetails({
  model,
  windows,
}: {
  model: { version: string; trainedAt: string };
  windows: Array<AccuracyWindow>;
}) {
  return (
    <Collapsible className="rounded-2xl border">
      <CollapsibleTrigger className="group flex w-full items-center justify-between gap-2 px-4 py-3 text-sm font-medium">
        Technical details
        <ChevronDownIcon className="size-4 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" />
      </CollapsibleTrigger>
      <CollapsibleContent className="flex flex-col gap-3 px-4 pb-4 text-sm text-muted-foreground">
        <p>
          Model <span className="font-medium text-foreground">{model.version}</span> · trained{" "}
          {relativeAge(model.trainedAt)} · retrains daily at 06:00 UTC. A gradient-boosted quantile
          model predicts each ride's standby wait; the p10–p90 quantiles form the likely range shown
          on the chart. Metrics below aggregate all model versions over each rolling window of
          verified predictions.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full min-w-96 text-left tabular-nums">
            <thead>
              <tr className="border-b text-xs uppercase tracking-wider">
                <th className="py-1.5 pr-4 font-medium">Window</th>
                <th className="py-1.5 pr-4 font-medium">MAE</th>
                <th className="py-1.5 pr-4 font-medium">RMSE</th>
                <th className="py-1.5 pr-4 font-medium">MAPE</th>
                <th className="py-1.5 pr-4 font-medium">R²</th>
                <th className="py-1.5 font-medium">n</th>
              </tr>
            </thead>
            <tbody>
              {windows.map((w) => (
                <tr key={w.window} className="border-b border-dashed last:border-0">
                  <td className="py-1.5 pr-4 font-medium text-foreground">{w.window}</td>
                  <td className="py-1.5 pr-4">±{fmt1(w.mae)}m</td>
                  <td className="py-1.5 pr-4">±{fmt1(w.rmse)}m</td>
                  <td className="py-1.5 pr-4">
                    {w.mape == null ? "—" : `${Math.round(w.mape * 100)}%`}
                  </td>
                  <td className="py-1.5 pr-4">
                    {w.r2 == null ? "—" : (Math.round(w.r2 * 100) / 100).toFixed(2)}
                  </td>
                  <td className="py-1.5">{w.nPredictions.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

type CurvePoint = {
  /** Epoch ms of the forecast slot. */
  t: number;
  label: string;
  predictedWait: number | null;
  band: [number, number] | null;
};

/**
 * Tomorrow's curve, in the day chart's language: every reading is expected
 * rather than measured, so the whole line is dashed over its likely-range
 * band, and the quietest stretch of the day gets the sweet-spot bracket.
 * Pointing at an hour speaks it above and compares it with that stretch.
 */
function ForecastCurveChart({ points }: { points: Array<CurvePoint> }) {
  const [sel, setSel] = React.useState<number | null>(null);
  const series = React.useMemo<Array<TrendPoint>>(
    () =>
      points.map((p) => ({
        t: p.t,
        value: p.predictedWait,
        lo: p.band?.[0] ?? null,
        hi: p.band?.[1] ?? null,
        projected: true,
      })),
    [points],
  );
  const values = points.map((p) => p.predictedWait);
  const window = bestRun(values, "min", 4);
  const peakIdx = values.reduce<number>(
    (b, v, i) => (v != null && (values[b] == null || v > (values[b] as number)) ? i : b),
    0,
  );
  const peak = points[peakIdx]!;
  const ticks = points
    .filter((_, i) => i % Math.max(1, Math.ceil(points.length / 6)) === 0)
    .map((p) => p.t);

  const active = sel != null ? points[sel]! : null;
  let headline: string;
  let subline: string;
  let tone: "good" | "bad" | "neutral" = "neutral";
  if (active && active.predictedWait != null) {
    headline = `${active.label} should run about ${Math.round(active.predictedWait)} min`;
    subline = `${active.band ? `Likely ${Math.round(active.band[0])}–${Math.round(active.band[1])} min. ` : ""}${
      window && sel! >= window.lo && sel! <= window.hi
        ? "In the quietest stretch of the day."
        : window
          ? deltaClause(active.predictedWait, window.value, minutes, "the quietest stretch", {
              more: "longer than",
              less: "shorter than",
            })
          : ""
    }`;
    tone = window ? deltaTone(active.predictedWait, window.value) : "neutral";
    if (window && sel! >= window.lo && sel! <= window.hi) tone = "good";
  } else {
    headline = `Expect a peak around ${peak.label} · ~${Math.round(peak.predictedWait ?? 0)} min`;
    subline = window
      ? `Quietest stretch: ${points[window.lo]!.label} – ${points[window.hi]!.label}. Tap the line for an hour.`
      : "Tap the line for an hour.";
  }

  return (
    <div className="flex flex-col gap-3">
      <ChartSentence headline={headline} subline={subline} tone={tone} />
      <TrendChart
        points={series}
        selected={sel}
        onSelect={setSel}
        format={minutes}
        tickValues={ticks}
        tickFormat={(d) => d.toLocaleTimeString([], { hour: "numeric" })}
        bracket={window ? { lo: window.lo, hi: window.hi, label: "Sweet spot" } : null}
        height={{ base: 180, md: 240 }}
      />
      <ChartLegend>
        <LegendKey swatch="typical">Expected wait</LegendKey>
        <LegendKey swatch="band">Likely range</LegendKey>
        {window && <LegendKey swatch="best">Quietest stretch</LegendKey>}
      </ChartLegend>
    </div>
  );
}

const minutes = (v: number) => `${Math.round(v)} min`;

const CROWD_LABELS = ["Ghost town", "Light", "Moderate", "Busy", "Packed"];
function crowdLabel(index: number): string {
  return CROWD_LABELS[Math.min(CROWD_LABELS.length - 1, Math.floor((index - 1) / 2))];
}

/** Plain-English read on the percentile, instead of "busier than N% of days". */
function crowdSentence(percentile: number, basisDays: number): string {
  const base =
    percentile < 0.2
      ? "Should be one of the quietest days this park has had lately."
      : percentile < 0.45
        ? "Looking a bit quieter than a typical day here."
        : percentile < 0.6
          ? "About a typical day for this park."
          : percentile < 0.8
            ? "Busier than usual — expect longer lines."
            : "One of the busiest days this park has had lately.";
  return basisDays < 30 ? `${base} (Early estimate — we're still building history.)` : base;
}

/** Park crowd score + next-day expected-wait curve with its likely range. */
function ParkCurve() {
  const trpc = useTRPC();
  const parksQ = useQuery(trpc.parks.list.queryOptions());
  const [parkSlug, setParkSlug] = React.useState<string | null>(null);
  const date = React.useMemo(() => tomorrowIso(), []);

  const parks = parksQ.data;
  const activeSlug = parkSlug ?? parks?.[0]?.slug ?? null;

  const curveQ = useQuery({
    ...trpc.forecast.parkCurve.queryOptions({ parkSlug: activeSlug ?? "", date }),
    enabled: !!activeSlug,
  });

  const points: Array<CurvePoint> = (curveQ.data?.points ?? []).map((p) => ({
    t: new Date(p.targetTs).getTime(),
    label: new Date(p.targetTs).toLocaleTimeString([], { hour: "numeric" }),
    predictedWait: p.predictedWait,
    band: p.lower != null && p.upper != null ? [p.lower, p.upper] : null,
  }));
  const crowd = curveQ.data?.crowd;

  return (
    <WashPanel
      title="Tomorrow's crowds"
      meta={
        <Select value={activeSlug ?? undefined} onValueChange={setParkSlug}>
          <SelectTrigger className="w-44" size="sm">
            <SelectValue placeholder="Select a park" />
          </SelectTrigger>
          <SelectContent>
            {(parks ?? []).map((p) => (
              <SelectItem key={p.slug} value={p.slug}>
                {p.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      }
    >
      <p className="-mt-1 text-sm text-wash-muted">
        {friendlyDate(date)} · how long waits should run through the day
      </p>
      <div className="flex flex-col gap-4">
        {crowd?.index != null ? (
          <div className="flex flex-col gap-1">
            <div className="flex items-baseline gap-3">
              <span className="text-4xl font-extrabold tracking-[-0.02em] tabular-nums">
                {crowd.index}
              </span>
              <span className="text-wash-muted">/ 10</span>
              <span className="rounded-full bg-background/70 px-2.5 py-0.5 text-sm font-bold text-wash-fg">
                {crowdLabel(crowd.index)}
              </span>
            </div>
            {crowd.percentile != null && (
              <p className="text-sm text-muted-foreground">
                {crowdSentence(crowd.percentile, crowd.basisDays ?? 0)}
              </p>
            )}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            No crowd score yet for this date — check back after tonight's forecast run.
          </p>
        )}

        {curveQ.isLoading ? (
          <Skeleton className="h-64 w-full rounded-2xl" />
        ) : points.length === 0 ? (
          <Empty>
            <EmptyTitle>No forecast for this date yet</EmptyTitle>
            <EmptyDescription>
              Tomorrow's curve is generated overnight — check back after tonight's run.
            </EmptyDescription>
          </Empty>
        ) : (
          <>
            <ForecastCurveChart points={points} />
            <p className="text-xs text-wash-muted">
              The dashed line is the expected average wait across the park's rides; the band is the
              range waits will most likely fall in.
            </p>
          </>
        )}
      </div>
    </WashPanel>
  );
}

export function PredictionsDashboard({ className }: { className?: string }) {
  return (
    <div className={cn("flex flex-col", className)}>
      <PageMasthead
        kicker="Ahead"
        title="Wait-time forecasts"
        description="How busy each park will be tomorrow — and, because a forecast nobody checks is just a guess, how ours have held up against the waits that actually got posted."
      />
      <PageBody size="wide" className="gap-8">
        <ParkCurve />
        <Band>
          <BandHeading kicker="Know" title="How accurate is this?" />
          <AccuracySection />
        </Band>
      </PageBody>
    </div>
  );
}
