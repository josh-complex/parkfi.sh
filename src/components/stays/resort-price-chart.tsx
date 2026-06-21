"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { bisector, extent } from "d3-array";
import { AxisBottom, AxisRight } from "@visx/axis";
import { curveMonotoneX } from "@visx/curve";
import { localPoint } from "@visx/event";
import { GridRows } from "@visx/grid";
import { Group } from "@visx/group";
import { scaleLinear, scaleTime } from "@visx/scale";
import { Bar, Circle, Line, LinePath } from "@visx/shape";
import { TrendingDownIcon, TrendingUpIcon } from "lucide-react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "#/components/ui/card.tsx";
import { ChartErrorBoundary } from "#/components/chart-error-boundary.tsx";
import { Skeleton } from "#/components/ui/skeleton.tsx";
import {
  AXIS_INK,
  ChartFrame,
  GRID_INK,
  PRIMARY,
  clientXY,
  tickLabelProps,
  useChartTooltip,
} from "#/components/park-dashboard/visx/kit.tsx";
import { useTRPC } from "#/integrations/trpc/react.ts";

const PLOT_H = 188;
const MARGIN = { top: 10, right: 30, bottom: 22, left: 8 };

export interface PriceHistoryParams {
  resortId: string;
  checkInDate: string;
  checkOutDate: string;
  adults: number;
  children: number;
  childAges: Array<number>;
  accessible: boolean;
  floridaResident: boolean;
}

interface Point {
  t: number;
  price: number;
}

const bisectT = bisector<Point, number>((d) => d.t).left;
const usd = (n: number) => `$${Math.round(n).toLocaleString()}`;

function PricePlot({ width, points, avg }: { width: number; points: Array<Point>; avg: number }) {
  const tip = useChartTooltip<Point>();
  const innerW = Math.max(0, width - MARGIN.left - MARGIN.right);

  const x = scaleTime({
    domain: (extent(points, (d) => d.t) as [number, number]).map((t) => new Date(t)) as [
      Date,
      Date,
    ],
    range: [0, innerW],
  });
  const [lo, hi] = extent(points, (d) => d.price) as [number, number];
  // Pad the band a little so the line never rides the top/bottom edge, and keep
  // the average line inside the domain.
  const y = scaleLinear({
    domain: [Math.min(lo, avg) * 0.97, Math.max(hi, avg) * 1.03],
    range: [PLOT_H, 0],
    nice: true,
  });

  const onHover = (e: React.MouseEvent | React.TouchEvent) => {
    const pt = localPoint(e);
    if (!pt) return;
    const date = x.invert(pt.x - MARGIN.left);
    const idx = bisectT(points, date.getTime(), 1);
    const a = points[idx - 1];
    const b = points[idx];
    const row = !b || (a && date.getTime() - a.t < b.t - date.getTime()) ? a : b;
    if (row) tip.show(row, clientXY(e));
  };

  const last = points[points.length - 1]!;

  return (
    <div className="relative w-full" style={{ height: PLOT_H + 24 }}>
      <svg width={width} height={PLOT_H + 24} className="overflow-visible">
        <Group left={MARGIN.left} top={MARGIN.top}>
          <GridRows scale={y} width={innerW} stroke={GRID_INK} strokeOpacity={0.5} numTicks={4} />

          {/* Average reference line. */}
          <Line
            from={{ x: 0, y: y(avg) }}
            to={{ x: innerW, y: y(avg) }}
            stroke={AXIS_INK}
            strokeWidth={1}
            strokeDasharray="4 4"
            strokeOpacity={0.55}
          />

          <LinePath
            data={points}
            x={(d) => x(new Date(d.t))}
            y={(d) => y(d.price)}
            curve={curveMonotoneX}
            stroke={PRIMARY}
            strokeWidth={2.5}
          />

          {/* Latest reading marker. */}
          <Circle
            cx={x(new Date(last.t))}
            cy={y(last.price)}
            r={4}
            fill={PRIMARY}
            stroke="var(--background)"
            strokeWidth={1.5}
          />

          {tip.data && (
            <g pointerEvents="none">
              <Line
                from={{ x: x(new Date(tip.data.t)), y: 0 }}
                to={{ x: x(new Date(tip.data.t)), y: PLOT_H }}
                stroke={AXIS_INK}
                strokeWidth={1}
                strokeDasharray="3 3"
                strokeOpacity={0.6}
              />
              <Circle
                cx={x(new Date(tip.data.t))}
                cy={y(tip.data.price)}
                r={4}
                fill={PRIMARY}
                stroke="var(--background)"
                strokeWidth={1.5}
              />
            </g>
          )}

          <AxisRight
            left={innerW}
            scale={y}
            numTicks={4}
            hideTicks
            hideAxisLine
            tickFormat={(v) => usd(Number(v))}
            tickLabelProps={() => tickLabelProps({ textAnchor: "end", dx: "2.4em", dy: "0.3em" })}
          />
          <AxisBottom
            top={PLOT_H}
            scale={x}
            numTicks={Math.max(2, Math.floor(innerW / 90))}
            stroke={GRID_INK}
            hideTicks
            tickFormat={(v) =>
              (v as Date).toLocaleDateString("en-US", { month: "short", day: "numeric" })
            }
            tickLabelProps={() => tickLabelProps({ textAnchor: "middle", dy: "0.25em" })}
          />
          <Bar
            width={innerW}
            height={PLOT_H}
            fill="transparent"
            onMouseMove={onHover}
            onTouchMove={onHover}
            onMouseLeave={tip.hide}
          />
        </Group>
      </svg>

      <tip.Tooltip>
        {(d) => (
          <div className="grid gap-0.5">
            <span className="font-medium text-foreground">{usd(d.price)} / night</span>
            <span className="text-muted-foreground">
              {new Date(d.t).toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
                hour: "numeric",
              })}
            </span>
          </div>
        )}
      </tip.Tooltip>
    </div>
  );
}

/**
 * Observed nightly-rate trend for one resort at the currently-searched (dates,
 * party) tuple. Reads `stays.priceHistory` (cached observations only) and frames
 * the current rate against its tracked average / range so the page answers
 * "is now a good time to book?" rather than just quoting a single number.
 */
export function ResortPriceChart({
  params,
  enabled,
  nightsLabel,
}: {
  params: PriceHistoryParams;
  enabled: boolean;
  /** e.g. "Jul 12 – Jul 16 · 2 adults" — describes the tracked tuple. */
  nightsLabel: string;
}) {
  const trpc = useTRPC();
  const historyQ = useQuery({
    ...trpc.stays.priceHistory.queryOptions(params),
    enabled,
  });

  const points = React.useMemo<Array<Point>>(
    () =>
      (historyQ.data?.points ?? [])
        .filter((p) => p.pricePerNight != null)
        .map((p) => ({ t: p.observedAt, price: p.pricePerNight as number })),
    [historyQ.data],
  );

  const stats = React.useMemo(() => {
    if (points.length === 0) return null;
    const prices = points.map((p) => p.price);
    const min = Math.min(...prices);
    const max = Math.max(...prices);
    const avg = prices.reduce((a, b) => a + b, 0) / prices.length;
    const current = prices[prices.length - 1]!;
    const days = Math.max(
      1,
      Math.round((points[points.length - 1]!.t - points[0]!.t) / 86_400_000),
    );
    return { min, max, avg, current, days };
  }, [points]);

  return (
    <Card className="flex flex-col overflow-hidden">
      <CardHeader>
        <CardTitle className="text-base">Price trend</CardTitle>
        <CardDescription className="truncate">Tracked nightly rate · {nightsLabel}</CardDescription>
      </CardHeader>
      <CardContent className="flex min-h-0 flex-1 flex-col gap-3 px-2 pb-4 sm:px-4">
        <ChartErrorBoundary
          label="Price trend"
          fallback={<Empty>Trend unavailable right now.</Empty>}
        >
          {!enabled ? (
            <Empty>Search dates above to see this resort&rsquo;s rate trend.</Empty>
          ) : historyQ.isLoading ? (
            <Skeleton className="h-[212px] w-full" />
          ) : points.length < 2 || !stats ? (
            <Empty>
              {points.length === 1 && stats
                ? `We just started tracking these dates at ${usd(stats.current)}/night. The trend fills in as we re-check — set an alert above to catch a drop.`
                : "We don't have a rate history for these dates yet. Set an alert above and we'll watch them for you."}
            </Empty>
          ) : (
            <>
              <PriceSummary stats={stats} />
              <ChartFrame height={PLOT_H + 24}>
                {({ width }) => <PricePlot width={width} points={points} avg={stats.avg} />}
              </ChartFrame>
            </>
          )}
        </ChartErrorBoundary>
      </CardContent>
    </Card>
  );
}

function PriceSummary({
  stats,
}: {
  stats: { min: number; max: number; avg: number; current: number; days: number };
}) {
  const delta = stats.current - stats.avg;
  const below = delta < 0;
  const pctOfRange =
    stats.max > stats.min ? (stats.current - stats.min) / (stats.max - stats.min) : 0;
  const position =
    pctOfRange <= 0.15
      ? "near its lowest tracked rate"
      : pctOfRange >= 0.85
        ? "near its highest tracked rate"
        : null;

  return (
    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-2 sm:px-1">
      <span className="text-xl font-semibold tabular-nums">{usd(stats.current)}</span>
      <span className="text-sm text-muted-foreground">current / night</span>
      {Math.abs(delta) >= 1 && (
        <span
          className={
            below
              ? "inline-flex items-center gap-1 text-sm font-medium text-emerald-600 dark:text-emerald-400"
              : "inline-flex items-center gap-1 text-sm font-medium text-rose-600 dark:text-rose-400"
          }
        >
          {below ? (
            <TrendingDownIcon className="size-3.5" />
          ) : (
            <TrendingUpIcon className="size-3.5" />
          )}
          {usd(Math.abs(delta))} {below ? "below" : "above"} its {stats.days}-day average
        </span>
      )}
      {position && <span className="text-sm text-muted-foreground">· {position}</span>}
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="flex items-center justify-center px-6 text-center text-sm text-muted-foreground"
      style={{ height: PLOT_H + 24 }}
    >
      {children}
    </div>
  );
}
