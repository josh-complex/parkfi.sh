"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { max as d3max } from "d3-array";
import { AxisBottom, AxisLeft } from "@visx/axis";
import { curveMonotoneX } from "@visx/curve";
import { localPoint } from "@visx/event";
import { LinearGradient } from "@visx/gradient";
import { GridRows } from "@visx/grid";
import { Group } from "@visx/group";
import { scaleLinear } from "@visx/scale";
import { Area, Bar, Circle, Line, LinePath } from "@visx/shape";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "#/components/ui/card.tsx";
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

import {
  AXIS_INK,
  ChartFrame,
  GRID_INK,
  PRIMARY,
  TooltipCard,
  tickLabelProps,
} from "#/components/park-dashboard/visx/kit.tsx";

/** Tomorrow as a YYYY-MM-DD string (the default crowd-calendar date). */
function tomorrowIso(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
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
    <Card size="sm" className="gap-2">
      <CardContent className="flex flex-col gap-1">
        <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          {label}
        </span>
        <span className="text-2xl font-semibold tabular-nums leading-tight">{value}</span>
        {sub && <span className="line-clamp-1 text-xs text-muted-foreground">{sub}</span>}
      </CardContent>
    </Card>
  );
}

/** Accuracy tiles for the active model (gated by the cold-start floor). */
function AccuracyTiles() {
  const trpc = useTRPC();
  const q = useQuery(trpc.forecast.accuracy.queryOptions());

  if (q.isLoading) {
    return (
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-24 rounded-4xl" />
        ))}
      </div>
    );
  }

  const data = q.data;
  if (!data?.model) {
    return (
      <Empty>
        <EmptyTitle>No model trained yet</EmptyTitle>
        <EmptyDescription>
          Forecasts appear once the daily training run has produced its first model.
        </EmptyDescription>
      </Empty>
    );
  }

  // Prefer the 7d window, falling back to 30d, then any window present.
  const byWindow = new Map(data.windows.map((w) => [w.window, w]));
  const win = byWindow.get("7d") ?? byWindow.get("30d") ?? data.windows[0];

  if (!win) {
    return (
      <Empty>
        <EmptyTitle>Accuracy is still calibrating</EmptyTitle>
        <EmptyDescription>
          Numbers appear once the backtest has run against verified wait-time actuals.
        </EmptyDescription>
      </Empty>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {!win.ready && (
        <p className="text-sm text-muted-foreground">
          Early data · {win.nPredictions.toLocaleString()} predictions verified so far. Numbers will
          stabilize as more actuals accumulate.
        </p>
      )}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
        <Tile
          label="Mean error (MAE)"
          value={`±${fmt1(win.mae)} min`}
          sub={`${win.window} window`}
        />
        <Tile label="RMSE" value={`±${fmt1(win.rmse)} min`} sub="penalizes big misses" />
        <Tile
          label="MAPE"
          value={win.mape == null ? "—" : `${Math.round(win.mape * 100)}%`}
          sub="avg percent error"
        />
        <Tile
          label="R²"
          value={win.r2 == null ? "—" : (Math.round(win.r2 * 100) / 100).toFixed(2)}
          sub="variance explained"
        />
        <Tile
          label="Predictions"
          value={win.nPredictions.toLocaleString()}
          sub="verified vs actuals"
        />
        <Tile
          label="Verified coverage"
          value={win.coveragePct == null ? "—" : `${Math.round(win.coveragePct * 100)}%`}
          sub="forecasts checked against actuals"
        />
      </div>
    </div>
  );
}

type CurvePoint = {
  label: string;
  predictedWait: number | null;
  band: [number, number] | null;
  i: number;
};

/** visx forecast curve: a p10–p90 confidence band under the predicted line. */
function ForecastCurveChart({ points }: { points: Array<CurvePoint> }) {
  const tip = useChartTooltipLocal();
  const margin = { top: 10, right: 12, bottom: 24, left: 34 };

  return (
    <ChartFrame height={256}>
      {({ width, height }) => {
        const innerW = Math.max(0, width - margin.left - margin.right);
        const innerH = Math.max(0, height - margin.top - margin.bottom);
        const n = points.length;
        const x = scaleLinear({ domain: [0, Math.max(1, n - 1)], range: [0, innerW] });
        const yMax = d3max(points, (p) => Math.max(p.predictedWait ?? 0, p.band?.[1] ?? 0)) ?? 0;
        const y = scaleLinear({ domain: [0, yMax * 1.1 || 1], range: [innerH, 0], nice: true });

        const line = points.filter((p) => p.predictedWait != null);
        const band = points.filter((p) => p.band != null);

        // A few evenly-spaced index ticks, labelled by their hour string.
        const step = Math.max(1, Math.ceil(n / 6));
        const tickVals = points.filter((_, i) => i % step === 0).map((p) => p.i);

        const onMove = (e: React.MouseEvent | React.TouchEvent) => {
          const pt = localPoint(e);
          if (!pt) return;
          const idx = Math.max(0, Math.min(n - 1, Math.round(x.invert(pt.x - margin.left))));
          const d = points[idx];
          if (d) tip.show(d, margin.left + x(d.i), margin.top + y(d.predictedWait ?? 0));
        };

        return (
          <div className="relative h-full w-full">
            <svg width={width} height={height}>
              <LinearGradient
                id="forecast-band"
                from={PRIMARY}
                to={PRIMARY}
                fromOpacity={0.22}
                toOpacity={0.06}
              />
              <Group left={margin.left} top={margin.top}>
                <GridRows
                  scale={y}
                  width={innerW}
                  stroke={GRID_INK}
                  strokeOpacity={0.5}
                  numTicks={4}
                />
                {band.length > 1 && (
                  <Area<CurvePoint>
                    data={band}
                    x={(d) => x(d.i)}
                    y0={(d) => y(d.band![0])}
                    y1={(d) => y(d.band![1])}
                    curve={curveMonotoneX}
                    fill="url(#forecast-band)"
                  />
                )}
                <LinePath<CurvePoint>
                  data={line}
                  x={(d) => x(d.i)}
                  y={(d) => y(d.predictedWait ?? 0)}
                  curve={curveMonotoneX}
                  stroke={PRIMARY}
                  strokeWidth={2}
                />
                {tip.data && (
                  <g pointerEvents="none">
                    <Line
                      from={{ x: x(tip.data.i), y: 0 }}
                      to={{ x: x(tip.data.i), y: innerH }}
                      stroke={AXIS_INK}
                      strokeWidth={1}
                      strokeDasharray="3 3"
                      strokeOpacity={0.6}
                    />
                    <Circle
                      cx={x(tip.data.i)}
                      cy={y(tip.data.predictedWait ?? 0)}
                      r={3.5}
                      fill={PRIMARY}
                      stroke="var(--background)"
                      strokeWidth={1.5}
                    />
                  </g>
                )}
                <AxisBottom
                  top={innerH}
                  scale={x}
                  stroke={GRID_INK}
                  hideTicks
                  tickValues={tickVals}
                  tickFormat={(v) => points[Math.round(v as number)]?.label ?? ""}
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
            {tip.data && (
              <div
                className="pointer-events-none absolute top-0"
                style={{
                  left: tip.left,
                  // Size to content (capped), not to the space left of the container edge.
                  // Without this, an `absolute` box with only `left` set shrink-to-fits the
                  // remaining width, so the card narrows the further right the pointer is.
                  width: "max-content",
                  maxWidth: "16rem",
                  transform: `translateX(${tip.left > width / 2 ? "calc(-100% - 10px)" : "10px"})`,
                }}
              >
                <TooltipCard>
                  <div className="font-medium text-foreground">{tip.data.label}</div>
                  <div className="text-foreground">
                    <span className="font-mono font-medium tabular-nums">
                      {Math.round(tip.data.predictedWait ?? 0)}
                    </span>{" "}
                    <span className="text-muted-foreground">min predicted</span>
                  </div>
                  {tip.data.band && (
                    <div className="text-muted-foreground">
                      band {Math.round(tip.data.band[0])}–{Math.round(tip.data.band[1])} min
                    </div>
                  )}
                </TooltipCard>
              </div>
            )}
          </div>
        );
      }}
    </ChartFrame>
  );
}

/** Tiny local tooltip state for the inline forecast chart. */
function useChartTooltipLocal() {
  const [state, setState] = React.useState<{ data: CurvePoint; left: number; top: number } | null>(
    null,
  );
  return {
    data: state?.data ?? null,
    left: state?.left ?? 0,
    top: state?.top ?? 0,
    show: (data: CurvePoint, left: number, top: number) => setState({ data, left, top }),
    hide: () => setState(null),
  };
}

const CROWD_LABELS = ["Ghost town", "Light", "Moderate", "Busy", "Packed"];
function crowdLabel(index: number): string {
  return CROWD_LABELS[Math.min(CROWD_LABELS.length - 1, Math.floor((index - 1) / 2))];
}

/** Park crowd index + next-day predicted standby curve with confidence band. */
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

  const points: Array<CurvePoint> = (curveQ.data?.points ?? []).map((p, i) => ({
    label: new Date(p.targetTs).toLocaleTimeString([], { hour: "numeric" }),
    predictedWait: p.predictedWait,
    band: p.lower != null && p.upper != null ? [p.lower, p.upper] : null,
    i,
  }));
  const crowd = curveQ.data?.crowd;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Crowd forecast</CardTitle>
        <CardDescription>
          Predicted standby curve for {date} with a p10–p90 confidence band.
        </CardDescription>
        <div className="col-start-2 row-span-2 row-start-1 self-start justify-self-end">
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
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {crowd?.index != null ? (
          <div className="flex items-baseline gap-3">
            <span className="text-4xl font-semibold tabular-nums">{crowd.index}</span>
            <span className="text-muted-foreground">/ 10</span>
            <span className="rounded-full bg-primary/10 px-2.5 py-0.5 text-sm font-medium text-primary">
              {crowdLabel(crowd.index)}
            </span>
            {crowd.percentile != null && (
              <span className="text-xs text-muted-foreground">
                busier than {Math.round(crowd.percentile * 100)}% of the last {crowd.basisDays}{" "}
                {(crowd.basisDays ?? 0) < 30 ? "days (early data)" : "days"}
              </span>
            )}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            No crowd index yet — needs a forecast for this date and some history to rank against.
          </p>
        )}

        {curveQ.isLoading ? (
          <Skeleton className="h-64 w-full rounded-2xl" />
        ) : points.length === 0 ? (
          <Empty>
            <EmptyTitle>No forecast for this date</EmptyTitle>
            <EmptyDescription>
              The model emits a next-day curve once it has run for this park.
            </EmptyDescription>
          </Empty>
        ) : (
          <ForecastCurveChart points={points} />
        )}
      </CardContent>
    </Card>
  );
}

function relativeAge(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const h = Math.floor(ms / 3_600_000);
  if (h < 1) return "less than an hour ago";
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

/** Retraining status strip (model version + age; daily 06:00 UTC cadence). */
function ModelStatus() {
  const trpc = useTRPC();
  const q = useQuery(trpc.forecast.accuracy.queryOptions());
  const model = q.data?.model;
  if (!model) return null;
  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-sm text-muted-foreground">
      <span>
        Model <span className="font-medium text-foreground">{model.version}</span>
      </span>
      <span>Trained {relativeAge(model.trainedAt)}</span>
      <span>Retrains daily · 06:00 UTC</span>
    </div>
  );
}

export function PredictionsDashboard({ className }: { className?: string }) {
  return (
    <div className={cn("flex flex-col gap-6 p-4 lg:p-6", className)}>
      <div className="flex flex-col gap-1">
        <h1 className="font-heading text-2xl font-semibold">Wait-time forecasts</h1>
        <p className="text-sm text-muted-foreground">
          Crowd predictions and how accurate they've been, backtested against real waits.
        </p>
      </div>
      <ModelStatus />
      <ParkCurve />
      <div className="flex flex-col gap-3">
        <h2 className="font-heading text-lg font-medium">Accuracy</h2>
        <AccuracyTiles />
      </div>
    </div>
  );
}
