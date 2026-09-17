"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";

import { Skeleton } from "#/components/ui/skeleton.tsx";
import { useTRPC } from "#/integrations/trpc/react.ts";
import { todayInTz } from "#/lib/park-hours.ts";
import { cn } from "#/lib/utils.ts";

/** Five weeks, starting from the Sunday of the week we're in. */
const WEEKS = 5;
/** The horizon the card's one-line answer covers. */
const SOON_DAYS = 14;

const HEAT_BG = ["bg-heat-1", "bg-heat-2", "bg-heat-3", "bg-heat-4", "bg-heat-5"] as const;

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
 * in the fortnight to come.
 *
 * Forward-looking on purpose. The history version of this grid (five weeks
 * *past*, in `ParkCrowdCalendar`) belongs to the page's reference band; this one
 * sits in AHEAD next to hours and price, where every card answers "which day
 * should I come".
 *
 * Indexes are `forecast.parkCalendar`: measured for days already run, the ML
 * prediction for the next couple of days, and the day-of-week/holiday heuristic
 * beyond that — the last flagged `crowdIsEstimate`, which is why an estimated
 * day says so in its tooltip rather than pretending to be a measurement.
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
  // the card pops in at full height later. This card is ~517px tall; that pop
  // moved everything under it.
  if (!parkSlug || !q.data) {
    return <Skeleton className={cn("h-[517px] w-full rounded-[22px]", className)} />;
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

      <div className="grid grid-cols-7 gap-1.5">
        {["S", "M", "T", "W", "T", "F", "S"].map((w, i) => (
          <span
            key={`${w}-${i}`}
            className="text-center text-[10px] font-bold tracking-[0.06em] text-muted-foreground uppercase"
          >
            {w}
          </span>
        ))}
        {cells.map((c) => {
          const d = byDate.get(c.iso);
          const index = d?.crowdIndex ?? null;
          return (
            <div
              key={c.iso}
              title={
                index == null
                  ? `${c.label} · no forecast`
                  : `${c.label} · crowd ${index}/10${d?.crowdIsEstimate ? " (estimated)" : ""}`
              }
              className={cn(
                "aspect-square rounded-[6px]",
                index == null ? "bg-muted" : HEAT_BG[heatStep(index) - 1],
                // A day already behind us is context, not a choice.
                c.iso < today && "opacity-40",
                c.iso === today && "ring-2 ring-brand-yellow ring-offset-1 ring-offset-card",
              )}
            />
          );
        })}
      </div>

      <div className="flex items-center justify-end gap-1.5 text-[10px] font-semibold text-muted-foreground">
        <span>Quiet</span>
        {HEAT_BG.map((bg) => (
          <span key={bg} className={cn("size-2.5 rounded-[3px]", bg)} />
        ))}
        <span>Packed</span>
      </div>

      {quietest && (
        <p className="text-[12.5px] leading-snug text-foreground/80">
          Quietest in the next fortnight:{" "}
          <strong>
            {day(quietest.iso).toLocaleDateString("en-US", {
              weekday: "short",
              month: "short",
              day: "numeric",
            })}
          </strong>{" "}
          — crowd {quietest.index} of 10.
        </p>
      )}
    </div>
  );
}
