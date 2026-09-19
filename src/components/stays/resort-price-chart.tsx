"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";

import { ChartErrorBoundary } from "#/components/chart-error-boundary.tsx";
import {
  ChartLegend,
  ChartSentence,
  LegendKey,
  deltaClause,
  deltaTone,
} from "#/components/detail/chart-kit.tsx";
import { DetailCard } from "#/components/detail/panels.tsx";
import { TrendChart, type TrendPoint } from "#/components/detail/trend-chart.tsx";
import { Skeleton } from "#/components/ui/skeleton.tsx";
import { useTRPC } from "#/integrations/trpc/react.ts";

const PLOT_H = { base: 150, md: 188 };

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

const usd = (n: number) => `$${Math.round(n).toLocaleString()}`;
const when = (t: number) =>
  new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "numeric" });

/**
 * Observed nightly-rate trend for one resort at the currently-searched (dates,
 * party) tuple. Reads `stays.priceHistory` (cached observations only) and
 * speaks the current rate against its tracked average and range, so the page
 * answers "is now a good time to book?" rather than just quoting a number.
 * Pointing at an earlier reading compares it with the rate right now.
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
  const [sel, setSel] = React.useState<number | null>(null);

  const points = React.useMemo<Array<TrendPoint>>(
    () =>
      (historyQ.data?.points ?? [])
        .filter((p) => p.pricePerNight != null)
        .map((p) => ({ t: p.observedAt, value: p.pricePerNight as number })),
    [historyQ.data],
  );

  const stats = React.useMemo(() => {
    if (points.length === 0) return null;
    const prices = points.map((p) => p.value as number);
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

  const last = points.length - 1;
  const active = sel != null && sel !== last ? points[sel]! : null;
  let headline = "";
  let subline = "";
  let tone: "good" | "bad" | "neutral" = "neutral";
  if (stats) {
    if (active) {
      headline = `${usd(active.value as number)} / night on ${when(active.t)}`;
      subline = deltaClause(active.value as number, stats.current, usd, "the rate right now");
      tone = deltaTone(active.value as number, stats.current, "min");
    } else {
      const pctOfRange =
        stats.max > stats.min ? (stats.current - stats.min) / (stats.max - stats.min) : 0;
      const position =
        pctOfRange <= 0.15
          ? "Near its lowest tracked rate."
          : pctOfRange >= 0.85
            ? "Near its highest tracked rate."
            : "";
      headline = `${usd(stats.current)} / night right now`;
      subline = `${deltaClause(stats.current, stats.avg, usd, `its ${stats.days}-day average`, {
        more: "above",
        less: "below",
        same: "Right on",
      })} ${position}`.trim();
      tone = deltaTone(stats.current, stats.avg, "min");
    }
  }

  return (
    // A `DetailCard`, not the app's `Card`: the 3D shelf belongs on keys, and a
    // chart is read rather than pressed (plan deviation D1).
    <DetailCard
      title="Price trend"
      description={`Tracked nightly rate · ${nightsLabel}`}
      action={
        stats ? (
          <span className="text-[13px] font-semibold text-wash-muted">
            {usd(stats.min)} – {usd(stats.max)} tracked
          </span>
        ) : undefined
      }
    >
      <ChartErrorBoundary
        label="Price trend"
        fallback={<Empty>Trend unavailable right now.</Empty>}
      >
        {!enabled ? (
          <Empty>Search dates above to see this resort&rsquo;s rate trend.</Empty>
        ) : historyQ.isLoading ? (
          <Skeleton className="h-[212px] w-full rounded-2xl" />
        ) : points.length < 2 || !stats ? (
          <Empty>
            {points.length === 1 && stats
              ? `We just started tracking these dates at ${usd(stats.current)}/night. The trend fills in as we re-check — set an alert above to catch a drop.`
              : "We don't have a rate history for these dates yet. Set an alert above and we'll watch them for you."}
          </Empty>
        ) : (
          <div className="flex flex-col gap-3">
            <ChartSentence headline={headline} subline={subline} tone={tone} />
            <TrendChart
              points={points}
              selected={sel}
              onSelect={setSel}
              format={usd}
              tickFormat={(d) => d.toLocaleDateString("en-US", { month: "short", day: "numeric" })}
              anchor={{ index: last, label: `Now · ${usd(stats.current)}` }}
              reference={{ value: stats.avg, label: `avg ${usd(stats.avg)}` }}
              baseline="fit"
              curve="smooth"
              height={PLOT_H}
            />
            <ChartLegend>
              <LegendKey swatch="measured">Nightly rate</LegendKey>
              <LegendKey swatch="now">Now</LegendKey>
              <LegendKey swatch="muted">{stats.days}-day average</LegendKey>
            </ChartLegend>
          </div>
        )}
      </ChartErrorBoundary>
    </DetailCard>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-[212px] items-center justify-center rounded-2xl bg-wash/50 px-6 text-center text-sm text-wash-muted">
      {children}
    </div>
  );
}
