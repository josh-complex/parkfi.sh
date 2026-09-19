"use client";

import * as React from "react";

import {
  ChartLegend,
  ChartSentence,
  LegendKey,
  deltaClause,
  deltaTone,
} from "#/components/detail/chart-kit.tsx";
import { TrendChart, type TrendPoint } from "#/components/detail/trend-chart.tsx";

const PLOT_H = { base: 150, md: 188 };

export interface PricePoint {
  t: number;
  price: number;
}

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

const when = (t: number) =>
  new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric" });

/**
 * Observed price trend for one menu item (`dining.menuItem.priceHistory`). A
 * step line — a Disney menu price holds until the next time we catch it
 * move — with the price right now pinned in yellow, and the step you point
 * at compared with it. Callers gate the thin-data / empty states.
 */
export function MenuItemPriceChart({
  points,
  currency,
}: {
  points: Array<PricePoint>;
  currency: string | null;
}) {
  const [sel, setSel] = React.useState<number | null>(null);
  const fmt = React.useMemo(() => priceFmt(currency), [currency]);
  const series = React.useMemo<Array<TrendPoint>>(
    () => points.map((p) => ({ t: p.t, value: p.price })),
    [points],
  );
  if (points.length < 2) return null;

  const last = points.length - 1;
  const now = points[last]!;
  const first = points[0]!;
  const active = sel != null && sel !== last ? points[sel]! : null;

  let headline: string;
  let subline: string;
  let tone: "good" | "bad" | "neutral" = "neutral";
  if (active) {
    headline = `${fmt(active.price)} from ${when(active.t)}`;
    subline = deltaClause(active.price, now.price, fmt, "the price now");
    tone = deltaTone(active.price, now.price, "min");
  } else {
    headline = `${fmt(now.price)} right now`;
    subline =
      now.price === first.price
        ? `Back where it started on ${when(first.t)}. Tap a step for its price.`
        : `${deltaClause(now.price, first.price, fmt, `when we first saw it on ${when(first.t)}`, {
            more: "up on",
            less: "down on",
          })} Tap a step for its price.`;
    tone = deltaTone(now.price, first.price, "min");
  }

  return (
    <div className="flex flex-col gap-3">
      <ChartSentence headline={headline} subline={subline} tone={tone} />
      <TrendChart
        points={series}
        selected={sel}
        onSelect={setSel}
        format={fmt}
        tickFormat={(d) => d.toLocaleDateString("en-US", { month: "short", day: "numeric" })}
        anchor={{ index: last, label: `Now · ${fmt(now.price)}` }}
        baseline="fit"
        curve="step"
        height={PLOT_H}
      />
      <ChartLegend>
        <LegendKey swatch="measured">Posted price</LegendKey>
        <LegendKey swatch="now">Now</LegendKey>
      </ChartLegend>
    </div>
  );
}
