"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "#/components/ui/card.tsx";
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

const STATE_STYLE: Record<AvailState, { fill: string; label: string }> = {
  available: { fill: "bg-emerald-500 dark:bg-emerald-400", label: "Available" },
  limited: { fill: "bg-amber-500 dark:bg-amber-400", label: "Limited or changing" },
  "sold-out": { fill: "bg-rose-500 dark:bg-rose-400", label: "Sold out" },
  paused: { fill: "bg-slate-400 dark:bg-slate-500", label: "Paused" },
  none: { fill: "bg-muted", label: "No data" },
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

/**
 * The ride page's Lightning Lane / Express availability timeline: a 24-hour strip
 * of coloured ticks (available / limited / sold out) for one attraction's paid
 * line. Rendered only for rides that actually offer the line — the caller gates
 * on `paidLineInfo(...).has`.
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

  const grid = React.useMemo(
    () => fillGrid((q.data ?? []).map((b) => ({ bucket: b.bucket, availState: b.availState }))),
    [q.data],
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

  return (
    <Card>
      <CardHeader>
        <CardTitle>{product} availability</CardTitle>
        <CardDescription>Last 24 hours · availability over time</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {q.isLoading ? (
          <Skeleton className="h-9 w-full rounded-md" />
        ) : !hasLive ? (
          <p className="py-4 text-center text-sm text-muted-foreground">
            No {product} availability recorded in the last 24 hours yet.
          </p>
        ) : (
          <>
            <div className="flex h-9 w-full gap-px overflow-hidden rounded-md">
              {grid.map((b) => {
                const cls = classifyState(b.availState);
                const time = new Date(b.bucket).toLocaleTimeString("en-US", {
                  hour: "numeric",
                  minute: "2-digit",
                  timeZone: timeZone ?? "America/New_York",
                });
                return (
                  <div
                    key={b.bucket}
                    className={cn("h-full flex-1", STATE_STYLE[cls].fill)}
                    title={`${time} · ${STATE_STYLE[cls].label}`}
                  />
                );
              })}
            </div>
            {ticks.length > 0 && (
              <div className="flex justify-between text-[11px] tabular-nums text-muted-foreground">
                {ticks.map((t, i) => (
                  <span key={i}>{t}</span>
                ))}
              </div>
            )}
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
              {LEGEND.map((s) => (
                <span key={s} className="flex items-center gap-1.5">
                  <span className={cn("size-2.5 rounded-[3px]", STATE_STYLE[s].fill)} />
                  {STATE_STYLE[s].label}
                </span>
              ))}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
