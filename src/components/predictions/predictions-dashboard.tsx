"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { Area, CartesianGrid, ComposedChart, Line, XAxis, YAxis } from "recharts";

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

  if (!win || !win.ready) {
    const n = win?.nPredictions ?? 0;
    return (
      <Empty>
        <EmptyTitle>Accuracy is still calibrating</EmptyTitle>
        <EmptyDescription>
          We hold back public accuracy numbers until the backtest has enough verified predictions to
          be honest. {n.toLocaleString()} so far.
        </EmptyDescription>
      </Empty>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
      <Tile label="Mean error (MAE)" value={`±${fmt1(win.mae)} min`} sub={`${win.window} window`} />
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
  );
}

const curveConfig = {
  predictedWait: { label: "Predicted wait", color: "var(--primary)" },
  band: { label: "p10–p90 band", color: "var(--primary)" },
} satisfies ChartConfig;

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

  const points = (curveQ.data?.points ?? []).map((p) => ({
    label: new Date(p.targetTs).toLocaleTimeString([], { hour: "numeric" }),
    predictedWait: p.predictedWait,
    band: p.lower != null && p.upper != null ? [p.lower, p.upper] : null,
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
                busier than {Math.round(crowd.percentile * 100)}% of the last {crowd.basisDays} days
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
          <ChartContainer config={curveConfig} className="h-64 w-full">
            <ComposedChart data={points} margin={{ left: 4, right: 8, top: 8 }}>
              <CartesianGrid vertical={false} />
              <XAxis
                dataKey="label"
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                minTickGap={24}
              />
              <YAxis tickLine={false} axisLine={false} width={32} />
              <ChartTooltip content={<ChartTooltipContent />} />
              <Area
                dataKey="band"
                stroke="none"
                fill="var(--color-band)"
                fillOpacity={0.15}
                isAnimationActive={false}
                connectNulls
              />
              <Line
                dataKey="predictedWait"
                type="monotone"
                stroke="var(--color-predictedWait)"
                strokeWidth={2}
                dot={false}
                isAnimationActive={false}
              />
            </ComposedChart>
          </ChartContainer>
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
