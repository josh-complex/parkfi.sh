"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";

import { ChartLegend, ChartSentence, LegendKey } from "#/components/detail/chart-kit.tsx";
import { DetailCard } from "#/components/detail/panels.tsx";
import { Skeleton } from "#/components/ui/skeleton.tsx";
import { QueueState } from "#/server/parks/codes.ts";
import { useTRPC } from "#/integrations/trpc/react.ts";
import { cn } from "#/lib/utils.ts";

// A 24h availability timeline is the natural read for a single ride's Lightning
// Lane: each 15-minute bucket is a coloured tick showing whether the LL was
// available, limited, or sold out then — the same categorical states the board
// pills show, laid out over time (no percentages).
//
// 15 minutes (the `history` default) is a rendering constraint as much as a
// data one: 96 ticks are individually legible across the strip, where a finer
// grid collapses into an unreadable smear. The resolution the wider bucket
// would otherwise cost is recovered by the server's reducer instead — a bucket
// is green or red only if every sample in it agreed, so amber marks a bucket
// the LL changed within rather than a state it sat in.
const BUCKET_MS = 15 * 60_000;

type AvailState = "available" | "limited" | "sold-out" | "paused" | "none";

/**
 * Map a queue-state code to a coarse availability class for the timeline.
 * LIMITED carries a second meaning here beyond the upstream state of the same
 * name: the server also resolves any bucket whose samples disagreed to it.
 */
function classifyState(state: number | null): AvailState {
  switch (state) {
    case QueueState.AVAILABLE:
      return "available";
    case QueueState.LIMITED:
      return "limited";
    case QueueState.SOLD_OUT:
      return "sold-out";
    case QueueState.PAUSED:
      return "paused";
    default:
      // NOT_OFFERED, or no reading in the bucket (park closed / collection gap).
      return "none";
  }
}

// The page's own wait ramp rather than raw Tailwind greens and reds: cool is
// the colour a good number is drawn in everywhere else on these pages (the
// quietest weekday's bar, a short wait's pill), and hot is the bad end of the
// same scale. A closed/unread bucket is the track showing through.
const STATE_STYLE: Record<AvailState, { fill: string; swatch: string; label: string }> = {
  available: { fill: "bg-wait-cool", swatch: "cool", label: "Available" },
  limited: { fill: "bg-wait-warm", swatch: "warm", label: "Limited or changing" },
  "sold-out": { fill: "bg-wait-hot", swatch: "hot", label: "Sold out" },
  paused: { fill: "bg-heat-none", swatch: "zero", label: "Paused" },
  none: { fill: "bg-transparent", swatch: "none", label: "No reading" },
};

// The three states worth a legend swatch — "paused" is rare and "none" reads as
// the empty track, so neither needs its own key.
const LEGEND: Array<AvailState> = ["available", "limited", "sold-out"];

type Bucket = { bucket: string; availState: number | null };

/**
 * Fill the span between the first and last returned bucket at the 15-minute
 * cadence, so a stretch with no readings (overnight closure, a collection gap)
 * becomes explicit empty ticks rather than silently collapsing the axis.
 */
function fillGrid(data: Array<Bucket>): Array<Bucket> {
  if (data.length === 0) return [];
  const byTime = new Map(data.map((d) => [new Date(d.bucket).getTime(), d]));
  const start = new Date(data[0]!.bucket).getTime();
  const end = new Date(data[data.length - 1]!.bucket).getTime();
  const steps = Math.max(0, Math.round((end - start) / BUCKET_MS));
  const grid: Array<Bucket> = [];
  for (let i = 0; i <= steps; i++) {
    const t = start + i * BUCKET_MS;
    grid.push(byTime.get(t) ?? { bucket: new Date(t).toISOString(), availState: null });
  }
  return grid;
}

/** A stretch the line spent in one state: where it starts, how many buckets it
 *  ran for, and what it was doing. */
interface Run {
  key: string;
  state: AvailState;
  count: number;
  from: string;
  /** Exclusive — the start of the next run, or one bucket past the last. */
  to: string;
}

/**
 * Collapse the bucket grid into contiguous same-state runs.
 *
 * The strip used to draw one div per bucket with a hairline between them, which
 * at 96 buckets read as a barcode: a stretch the line sat open all afternoon
 * came out as forty separate green ticks, so the eye counted stripes instead of
 * reading spans, and the one amber bucket that actually mattered was the same
 * size as its neighbours. Runs make the shape of the day the thing you see.
 */
function toRuns(grid: Array<Bucket>): Array<Run> {
  const runs: Array<Run> = [];
  for (const b of grid) {
    const state = classifyState(b.availState);
    const last = runs[runs.length - 1];
    const end = new Date(new Date(b.bucket).getTime() + BUCKET_MS).toISOString();
    if (last && last.state === state) {
      last.count += 1;
      last.to = end;
    } else {
      runs.push({ key: b.bucket, state, count: 1, from: b.bucket, to: end });
    }
  }
  return runs;
}

/** "2 h 15 min" for a count of quarter-hours. */
function span(buckets: number): string {
  const mins = buckets * 15;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

/**
 * The ride page's Lightning Lane / Express availability timeline: a 24-hour strip
 * of coloured spans (available / limited / sold out) for one attraction's paid
 * line, the span you point at spoken above it. Rendered only for rides that
 * actually offer the line — the caller gates on `paidLineInfo(...).has`.
 */
export function LightningLaneAvailability({
  attractionId,
  queueType,
  timeZone,
  product,
}: {
  attractionId: number;
  queueType: number;
  timeZone: string | null | undefined;
  /** Operator label for the paid line — "Lightning Lane" or "Express". */
  product: string;
}) {
  const trpc = useTRPC();
  const q = useQuery({
    ...trpc.parks.history.queryOptions({ attractionId, queueType, hours: 24 }),
    enabled: attractionId > 0,
  });
  const [sel, setSel] = React.useState<string | null>(null);

  const grid = React.useMemo(
    () => fillGrid((q.data ?? []).map((b) => ({ bucket: b.bucket, availState: b.availState }))),
    [q.data],
  );

  const runs = React.useMemo(() => toRuns(grid), [grid]);

  /** A bucket edge as a park-local clock time. */
  const clock = React.useCallback(
    (iso: string) =>
      new Date(iso).toLocaleTimeString("en-US", {
        hour: "numeric",
        minute: "2-digit",
        timeZone: timeZone ?? "America/New_York",
      }),
    [timeZone],
  );

  // A few evenly-spaced clock labels under the strip. Buckets are evenly spaced
  // in time, so a fractional position along the strip maps linearly to a time.
  const ticks = React.useMemo(() => {
    if (grid.length < 2) return [];
    const fmt = (iso: string) =>
      new Date(iso).toLocaleTimeString("en-US", {
        hour: "numeric",
        timeZone: timeZone ?? "America/New_York",
      });
    const n = 4;
    return Array.from({ length: n + 1 }, (_, i) => {
      const idx = Math.round((i / n) * (grid.length - 1));
      return fmt(grid[idx]!.bucket);
    });
  }, [grid, timeZone]);

  // At least one live (non-empty) reading is needed for the strip to say anything.
  const hasLive = grid.some((b) => classifyState(b.availState) !== "none");

  // A timeline of ONE state isn't a timeline — it's a flat bar, and a card whose
  // only content is "nothing changed" is worse than no card. So the whole card
  // is withheld rather than rendered empty.
  //
  // This is self-scoping rather than an operator special case: measured
  // 2026-07-28, 0 of the 50 Disney rides that render this card are flat, while
  // 28 of 28 Universal rides are — because UOR's upstream RETURN_TIME node is
  // pinned to TEMP_FULL (→ LIMITED) on every ride, every poll. As soon as a
  // ride's paid line genuinely varies, its card comes back on its own.
  const observed = React.useMemo(() => {
    const seen = new Set<AvailState>();
    for (const b of grid) {
      const cls = classifyState(b.availState);
      if (cls !== "none") seen.add(cls);
    }
    return seen.size;
  }, [grid]);
  if (!q.isLoading && observed <= 1 && hasLive) return null;

  // The standing totals: how much of the day the line was open, and shut.
  const totals = runs.reduce(
    (acc, r) => {
      acc[r.state] += r.count;
      return acc;
    },
    { available: 0, limited: 0, "sold-out": 0, paused: 0, none: 0 } as Record<AvailState, number>,
  );
  const active = sel ? (runs.find((r) => r.key === sel) ?? null) : null;
  const headline = active
    ? `${clock(active.from)} – ${clock(active.to)} · ${STATE_STYLE[active.state].label}`
    : totals.available > 0
      ? `Available for ${span(totals.available)} of the last 24 hours`
      : `Sold out for ${span(totals["sold-out"])} of the last 24 hours`;
  const subline = active
    ? `${span(active.count)} in this state.`
    : `${totals["sold-out"] > 0 ? `Sold out for ${span(totals["sold-out"])}` : "Never sold out"}${totals.limited > 0 ? ` · limited or changing for ${span(totals.limited)}` : ""}. Tap a span for its times.`;

  return (
    <DetailCard
      title={`${product} availability`}
      description="Last 24 hours · how the line has run"
    >
      {q.isLoading ? (
        <Skeleton className="h-7 w-full rounded-full" />
      ) : !hasLive ? (
        <p className="py-2 text-sm text-muted-foreground">
          No {product} availability recorded in the last 24 hours yet.
        </p>
      ) : (
        <div className="flex flex-col gap-3.5">
          <ChartSentence headline={headline} subline={subline} size="sm" />
          <div className="flex flex-col gap-1.5" onMouseLeave={() => setSel(null)}>
            {/* One track, spans painted onto it. The track's own fill is what a
                stretch with no reading shows as, so "the line wasn't running"
                is the absence of colour rather than a fourth colour. */}
            <div className="flex h-7 w-full overflow-hidden rounded-full bg-muted ring-1 ring-card-edge ring-inset">
              {runs.map((run) =>
                run.state === "none" ? (
                  <span
                    key={run.key}
                    style={{ flexGrow: run.count }}
                    className="h-full"
                    aria-hidden
                  />
                ) : (
                  <button
                    key={run.key}
                    type="button"
                    // Width by bucket count. Every span has zero content, so the
                    // grow factors split the whole track between them — the
                    // strip stays proportional at any card width.
                    style={{ flexGrow: run.count }}
                    aria-label={`${clock(run.from)} to ${clock(run.to)}: ${STATE_STYLE[run.state].label}`}
                    aria-pressed={sel === run.key}
                    onMouseEnter={() => setSel(run.key)}
                    onFocus={() => setSel(run.key)}
                    onBlur={() => setSel(null)}
                    onClick={() => setSel(run.key)}
                    className={cn(
                      "h-full min-w-0 cursor-pointer outline-none transition-[box-shadow,opacity]",
                      STATE_STYLE[run.state].fill,
                      sel != null && sel !== run.key && "opacity-55",
                      sel === run.key && "ring-[3px] ring-wash-fg/50 ring-inset",
                    )}
                  />
                ),
              )}
            </div>
            {ticks.length > 0 && (
              <div className="flex justify-between text-[10px] font-bold text-wash-muted">
                {ticks.map((t, i) => (
                  <span key={i}>{t}</span>
                ))}
              </div>
            )}
          </div>
          <ChartLegend>
            {LEGEND.map((st) => (
              <LegendKey key={st} swatch={STATE_STYLE[st].swatch}>
                {STATE_STYLE[st].label}
              </LegendKey>
            ))}
          </ChartLegend>
        </div>
      )}
    </DetailCard>
  );
}
