"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";

import {
  ChartLegend,
  ChartSentence,
  HeatRampKey,
  LegendKey,
  heatBg,
} from "#/components/detail/chart-kit.tsx";
import { Skeleton } from "#/components/ui/skeleton.tsx";
import { useTRPC } from "#/integrations/trpc/react.ts";
import { todayInTz } from "#/lib/park-hours.ts";
import { cn } from "#/lib/utils.ts";

/** Five weeks, starting from the Sunday of the week we're in. */
const WEEKS = 5;
/** The horizon the card's one-line answer covers. */
const SOON_DAYS = 14;

const CROWD_LABELS = ["Ghost town", "Light", "Moderate", "Busy", "Packed"] as const;

/** `YYYY-MM-DD` at local midnight — never `Date.parse("2026-09-13")`, which is
 *  UTC and lands a day early west of Greenwich. */
function day(iso: string): Date {
  return new Date(`${iso}T00:00:00`);
}

function isoOf(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Crowd index (1–10) onto the five-step heat ramp the calendars share. */
function heatStep(index: number): number {
  return Math.min(5, Math.max(1, Math.ceil(index / 2)));
}

/**
 * "Crowd calendar" — the five weeks ahead, each day shaded by its crowd index,
 * with the one thing a guest choosing a date actually wants: the quietest day
 * in the fortnight to come. Pointing at a day speaks its index above the grid.
 *
 * Forward-looking on purpose. The history version of this grid (five weeks
 * *past*, in `ParkCrowdCalendar`) belongs to the page's reference band; this one
 * sits in AHEAD next to hours and price, where every card answers "which day
 * should I come".
 *
 * Indexes are `forecast.parkCalendar`: measured for days already run, the ML
 * prediction for the next couple of days, and the day-of-week/holiday heuristic
 * beyond that — the last flagged `crowdIsEstimate`, which is why an estimated
 * day says so rather than pretending to be a measurement.
 */
export function CrowdAhead({
  parkSlug,
  timezone,
  className,
}: {
  parkSlug: string | null;
  timezone: string | undefined;
  className?: string;
}) {
  const trpc = useTRPC();
  const tz = timezone ?? "America/New_York";
  const today = todayInTz(tz);
  const [sel, setSel] = React.useState<string | null>(null);

  // The grid runs from the Sunday of this week so every column is one weekday.
  const { startIso, endIso, cells } = React.useMemo(() => {
    const start = day(today);
    start.setDate(start.getDate() - start.getDay());
    const out: Array<{ iso: string; label: string }> = [];
    for (let i = 0; i < WEEKS * 7; i++) {
      const d = new Date(start);
      d.setDate(d.getDate() + i);
      out.push({
        iso: isoOf(d),
        label: d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }),
      });
    }
    return { startIso: out[0]!.iso, endIso: out.at(-1)!.iso, cells: out };
  }, [today]);

  const q = useQuery({
    ...trpc.forecast.parkCalendar.queryOptions({
      parkSlug: parkSlug ?? "",
      startDate: startIso,
      endDate: endIso,
    }),
    enabled: !!parkSlug,
  });

  // `!q.data`, not `isLoading`: TanStack reports `isLoading` as `isPending &&
  // isFetching`, which is false on a server that never fetches *and* on the
  // client's very first render before the fetch starts — so an `isLoading`
  // guard renders nothing at exactly the moment the space needs reserving, and
  // the card pops in at full height later. This card is ~560px tall; that pop
  // moved everything under it.
  if (!parkSlug || !q.data) {
    return <Skeleton className={cn("h-[560px] w-full rounded-[22px]", className)} />;
  }

  const byDate = new Map((q.data?.days ?? []).map((d) => [d.date, d]));
  if (byDate.size === 0) return null;

  // The card's one-line answer: the quietest day inside the horizon a trip is
  // actually planned over. Today counts — it may well be the quiet one.
  // `setDate` rather than millisecond arithmetic: adding 14 × 86,400,000 ms
  // across a DST change lands an hour off, and at midnight that's the wrong day.
  const horizon = day(today);
  horizon.setDate(horizon.getDate() + SOON_DAYS);
  const horizonIso = isoOf(horizon);
  const soon = cells
    .filter((c) => c.iso >= today && c.iso < horizonIso)
    .flatMap((c) => {
      const d = byDate.get(c.iso);
      return d?.crowdIndex != null ? [{ ...c, index: d.crowdIndex }] : [];
    });
  const quietest = soon.reduce<(typeof soon)[number] | null>(
    (best, c) => (!best || c.index < best.index ? c : best),
    null,
  );
  const busiest = soon.reduce<(typeof soon)[number] | null>(
    (best, c) => (!best || c.index > best.index ? c : best),
    null,
  );

  const active = sel ? (cells.find((c) => c.iso === sel) ?? null) : null;
  const activeDay = active ? byDate.get(active.iso) : null;
  let headline: string;
  let subline: string;
  let tone: "good" | "bad" | "neutral" = "neutral";
  if (active) {
    const index = activeDay?.crowdIndex ?? null;
    if (index == null) {
      headline = `${active.label} · no forecast yet`;
      subline = "Check back after tonight's run.";
    } else {
      headline = `${active.iso === today ? "Today" : active.label} · crowd ${index} of 10 · ${CROWD_LABELS[heatStep(index) - 1]}`;
      subline =
        active.iso < today
          ? "Already behind us — what we measured."
          : activeDay?.crowdIsEstimate
            ? "An estimate from the weekday and the calendar; the model firms it up closer in."
            : "From the forecast model.";
      tone =
        active.iso >= today && quietest && active.iso === quietest.iso
          ? "good"
          : active.iso >= today && busiest && active.iso === busiest.iso
            ? "bad"
            : "neutral";
    }
  } else if (quietest) {
    headline = `Quietest in the next fortnight: ${day(quietest.iso).toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
    })} · crowd ${quietest.index} of 10`;
    subline =
      busiest && busiest.iso !== quietest.iso
        ? `Busiest: ${day(busiest.iso).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })} · ${busiest.index} of 10. Tap a day for its crowd.`
        : "Tap a day for its crowd.";
  } else {
    headline = "Five weeks ahead";
    subline = "Tap a day for its crowd.";
  }

  return (
    <div
      className={cn(
        "flex flex-col gap-3 rounded-[22px] border border-card-edge bg-card p-4 md:p-5",
        className,
      )}
    >
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-[19px] font-extrabold tracking-[-0.01em]">Crowd calendar</h3>
        <span className="shrink-0 text-xs text-muted-foreground">Five weeks ahead</span>
      </div>

      <ChartSentence headline={headline} subline={subline} tone={tone} size="sm" />

      <div className="grid grid-cols-7 gap-1.5" onMouseLeave={() => setSel(null)}>
        {["S", "M", "T", "W", "T", "F", "S"].map((w, i) => (
          <span
            key={`${w}-${i}`}
            className="text-center text-[10px] font-bold tracking-[0.06em] text-wash-muted uppercase"
          >
            {w}
          </span>
        ))}
        {cells.map((c) => {
          const d = byDate.get(c.iso);
          const index = d?.crowdIndex ?? null;
          const hot = sel === c.iso;
          const isQuietest = quietest != null && c.iso === quietest.iso;
          return (
            <button
              key={c.iso}
              type="button"
              aria-label={
                index == null
                  ? `${c.label}: no forecast`
                  : `${c.label}: crowd ${index} of 10${d?.crowdIsEstimate ? " (estimated)" : ""}`
              }
              aria-pressed={hot}
              onMouseEnter={() => setSel(c.iso)}
              onFocus={() => setSel(c.iso)}
              onBlur={() => setSel(null)}
              onClick={() => setSel(c.iso)}
              className={cn(
                "relative aspect-square cursor-pointer rounded-[6px] outline-none transition-[box-shadow]",
                index == null ? "bg-muted" : heatBg(heatStep(index)),
                // A day already behind us is context, not a choice.
                c.iso < today && "opacity-40",
                c.iso === today && "ring-2 ring-brand-yellow ring-offset-1 ring-offset-card",
                hot && "ring-[3px] ring-wash-fg/50 ring-offset-1 ring-offset-card",
              )}
            >
              {isQuietest && (
                <span
                  aria-hidden
                  className="absolute top-1 right-1 size-2 rounded-full bg-mint-fg ring-2 ring-card"
                />
              )}
            </button>
          );
        })}
      </div>

      <ChartLegend>
        <HeatRampKey from="Quiet" to="Packed" />
        {quietest && <LegendKey swatch="best">Quietest ahead</LegendKey>}
        <LegendKey swatch="now">Today</LegendKey>
      </ChartLegend>
    </div>
  );
}
