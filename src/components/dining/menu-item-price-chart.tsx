"use client";

import * as React from "react";
import { bisector, extent } from "d3-array";
import { AxisBottom, AxisRight } from "@visx/axis";
import { curveStepAfter } from "@visx/curve";
import { localPoint } from "@visx/event";
import { GridRows } from "@visx/grid";
import { Group } from "@visx/group";
import { scaleLinear, scaleTime } from "@visx/scale";
import { Bar, Circle, Line, LinePath } from "@visx/shape";

import {
  AXIS_INK,
  ChartFrame,
  chartMargin,
  GRID_INK,
  MOBILE_TICK,
  PRIMARY,
  clientXY,
  tickLabelProps,
  useChartTooltip,
} from "#/components/park-dashboard/visx/kit.tsx";

const PLOT_H = 188;
const MARGIN = { top: 10, bottom: 22 };

export interface PricePoint {
  t: number;
  price: number;
}

const bisectT = bisector<PricePoint, number>((d) => d.t).left;

function priceFmt(currency: string | null): (n: number) => string {
  return (n: number) => {
    try {
      return new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: currency ?? "USD",
        minimumFractionDigits: Number.isInteger(n) ? 0 : 2,
      }).format(n);
    } catch {
      return `$${n}`;
    }
  };
}

function Plot({
  width,
  points,
  currency,
}: {
  width: number;
  points: Array<PricePoint>;
  currency: string | null;
}) {
  const tip = useChartTooltip<PricePoint>();
  const narrow = width < 480;
  const tick = narrow ? MOBILE_TICK : 11;
  const margin = { ...MARGIN, ...chartMargin(width) };
  const innerW = Math.max(0, width - margin.left - margin.right);
  const usd = priceFmt(currency);

  const x = scaleTime({
    domain: (extent(points, (d) => d.t) as [number, number]).map((t) => new Date(t)) as [
      Date,
      Date,
    ],
    range: [0, innerW],
  });
  const [lo, hi] = extent(points, (d) => d.price) as [number, number];
  // Pad the band so a flat series doesn't collapse to a zero-height domain.
  const pad = Math.max(1, (hi - lo) * 0.15);
  const y = scaleLinear({
    domain: [lo - pad, hi + pad],
    range: [PLOT_H, 0],
    nice: true,
  });

  const onHover = (e: React.MouseEvent | React.TouchEvent) => {
    const pt = localPoint(e);
    if (!pt) return;
    const date = x.invert(pt.x - margin.left);
    const idx = bisectT(points, date.getTime(), 1);
    const a = points[idx - 1];
    const b = points[idx];
    const row = !b || (a && date.getTime() - a.t < b.t - date.getTime()) ? a : b;
    if (row) tip.show(row, clientXY(e));
  };

  return (
    <div className="relative w-full" style={{ height: PLOT_H + 24 }}>
      <svg width={width} height={PLOT_H + 24} className="overflow-visible">
        <Group left={margin.left} top={margin.top}>
          <GridRows scale={y} width={innerW} stroke={GRID_INK} strokeOpacity={0.5} numTicks={4} />

          {/* Step line — prices hold flat between the runs we observed them change. */}
          <LinePath
            data={points}
            x={(d) => x(new Date(d.t))}
            y={(d) => y(d.price)}
            curve={curveStepAfter}
            stroke={PRIMARY}
            strokeWidth={2.5}
          />

          {points.map((d, i) => (
            <Circle
              key={i}
              cx={x(new Date(d.t))}
              cy={y(d.price)}
              r={3}
              fill={PRIMARY}
              stroke="var(--background)"
              strokeWidth={1.25}
            />
          ))}

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
            tickLabelProps={() =>
              tickLabelProps({ textAnchor: "end", dx: "2.4em", dy: "0.3em" }, tick)
            }
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
            tickLabelProps={() => tickLabelProps({ textAnchor: "middle", dy: "0.25em" }, tick)}
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
            <span className="font-medium text-foreground">{usd(d.price)}</span>
            <span className="text-muted-foreground">
              {new Date(d.t).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
            </span>
          </div>
        )}
      </tip.Tooltip>
    </div>
  );
}

/**
 * Observed price trend for one menu item, stitched across any prior names it was
 * renamed from (`dining.menuItem.priceHistory`). A step line — a Disney menu
 * price holds until the next time we catch it move — with a dot on every
 * observed price. Renders nothing above the fixed height; callers gate the
 * thin-data / empty states.
 */
export function MenuItemPriceChart({
  points,
  currency,
}: {
  points: Array<PricePoint>;
  currency: string | null;
}) {
  return (
    <ChartFrame height={PLOT_H + 24}>
      {({ width }) => <Plot width={width} points={points} currency={currency} />}
    </ChartFrame>
  );
}
