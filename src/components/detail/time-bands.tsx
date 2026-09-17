"use client";

import * as React from "react";

import { heatClass, heatRamped } from "#/components/detail/day-series.tsx";
import { cn } from "#/lib/utils.ts";

/** What one swept service date holds, folded to the clock. */
export interface DayHours {
  /** Park-local `YYYY-MM-DD`. */
  date: string;
  /** False when the sweep never reached this date — not the same as "full". */
  checked: boolean;
  /** Park-local hour of day → how many distinct times are open in it. */
  hours: Array<{ hour: number; slots: number }>;
}

/**
 * The bands the clock is cut into.
 *
 * Deliberately the clock and not the operator's own meal periods: Disney's
 * "Lunch" runs to 4:50 PM and its "Dinner" starts at 2 PM, so the two overlap
 * by three hours and a time can belong to both. Nobody books by meal period
 * anyway — they book by "we want dinner around seven", which is what `prime`
 * is. Its emptiness against a solid `late` row is the whole point of the chart.
 */
export const TIME_BANDS = [
  { key: "morning", label: "Morning", clock: "to 11 AM", from: 0, to: 11 },
  { key: "midday", label: "Midday", clock: "11 – 3", from: 11, to: 15 },
  { key: "afternoon", label: "Afternoon", clock: "3 – 5", from: 15, to: 17 },
  { key: "prime", label: "Prime", clock: "5 – 8", from: 17, to: 20 },
  { key: "late", label: "Late", clock: "8 PM on", from: 20, to: 24 },
] as const;

export type TimeBand = (typeof TIME_BANDS)[number];

function day(date: string): Date {
  return new Date(`${date}T00:00:00`);
}

/** Where along the range the legend samples the ramp — its five steps, evenly. */
const RAMP_STOPS = [0, 0.3, 0.5, 0.8, 1] as const;

interface Cell {
  date: string;
  label: string;
  /** Open times in this band, or `null` where the date was never swept. */
  slots: number | null;
}

/** `[band][date]` — the grid, and the day labels its columns are in. */
export function bandGrid(days: Array<DayHours>): {
  rows: Array<{ band: TimeBand; cells: Array<Cell> }>;
  lo: number;
  hi: number;
} {
  const labelled = days.map((d) => ({
    ...d,
    label: day(d.date).toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
    }),
  }));
  const rows = TIME_BANDS.map((band) => ({
    band,
    cells: labelled.map((d) => ({
      date: d.date,
      label: d.label,
      slots: d.checked
        ? d.hours.reduce((n, h) => (h.hour >= band.from && h.hour < band.to ? n + h.slots : n), 0)
        : null,
    })),
  }));
  const positives = rows.flatMap((r) =>
    r.cells.flatMap((c) => (c.slots != null && c.slots > 0 ? [c.slots] : [])),
  );
  return {
    rows,
    lo: positives.length > 0 ? Math.min(...positives) : 0,
    hi: positives.length > 0 ? Math.max(...positives) : 0,
  };
}

/** "3 of the next 30 days" for one band — the number the row is worth reading for. */
export function bandOpenDays(row: { cells: Array<Cell> }): { open: number; checked: number } {
  let open = 0;
  let checked = 0;
  for (const c of row.cells) {
    if (c.slots == null) continue;
    checked++;
    if (c.slots > 0) open++;
  }
  return { open, checked };
}

/**
 * **When you can actually get in.** One row per stretch of the clock, one
 * column per date — the horizon we already sweep, opened along the axis the two
 * day-scale charts collapse.
 *
 * Those charts answer "how much is open on the 24th" and "which weekday is
 * kindest". Neither answers the question anyone actually has, which is "can we
 * eat at seven". A venue can show thirty healthy days and still not have had a
 * 7 PM table all month — the counts are carried entirely by 3 PM and 9:45 PM —
 * and until this row existed the page had no way to say so. Every figure here
 * was already in `dining_obs`; nothing but the selected day's list ever read it.
 *
 * One ramp across the whole grid, not per row, because comparing `prime`
 * against `late` *is* the reading. Bands are drawn even when empty all month:
 * an empty `prime` row is the strongest thing this chart ever says.
 */
export function TimeBandStrip({ days, className }: { days: Array<DayHours>; className?: string }) {
  const { rows, lo, hi } = React.useMemo(() => bandGrid(days), [days]);
  if (days.length === 0 || hi === 0) return null;
  const ramped = heatRamped(lo, hi);

  // A tick every seventh column, so a 30-column strip carries dates without
  // thirty labels no one can read.
  const ticks = days.map((d, i) =>
    i % 7 === 0
      ? day(d.date).toLocaleDateString("en-US", { month: "short", day: "numeric" })
      : null,
  );

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      {rows.map(({ band, cells }) => {
        const { open, checked } = bandOpenDays({ cells });
        // A band this venue never serves is kept — an empty `prime` row is the
        // loudest thing the chart says — but it steps back so the rows that do
        // carry something read first.
        const empty = open === 0;
        return (
          <div
            key={band.key}
            className={cn("flex items-center gap-2 md:gap-3", empty && "opacity-55")}
          >
            <div className="flex w-12 shrink-0 flex-col md:w-24 md:flex-row md:items-baseline md:gap-1.5">
              <span className="truncate text-[11px] leading-tight font-bold">{band.label}</span>
              <span className="truncate text-[10px] leading-tight font-semibold text-muted-foreground">
                {band.clock}
              </span>
            </div>
            <div className="flex min-w-0 flex-1 gap-px md:gap-[2px]">
              {cells.map((c) => (
                <div
                  key={c.date}
                  title={
                    c.slots == null
                      ? `${c.label} · ${band.label.toLowerCase()} · not swept`
                      : c.slots === 0
                        ? `${c.label} · no ${band.label.toLowerCase()} times`
                        : `${c.label} · ${c.slots} ${band.label.toLowerCase()} ${c.slots === 1 ? "time" : "times"}`
                  }
                  className={cn(
                    "h-5 min-w-0 flex-1 rounded-[2px] md:h-[26px] md:rounded-[3px]",
                    c.slots == null
                      ? "border border-dashed border-card-edge"
                      : c.slots === 0
                        ? "bg-heat-none"
                        : heatClass(c.slots, lo, hi),
                  )}
                />
              ))}
            </div>
            <span className="hidden w-12 shrink-0 text-right text-[11px] font-bold tabular-nums sm:block">
              {open}
              <span className="font-semibold text-muted-foreground">/{checked}</span>
            </span>
          </div>
        );
      })}
      <div className="flex items-center gap-2 md:gap-3">
        <span className="w-12 shrink-0 md:w-24" />
        <div className="flex min-w-0 flex-1 gap-px md:gap-[2px]">
          {ticks.map((t, i) => (
            <span
              key={days[i]!.date}
              className="min-w-0 flex-1 text-[9px] font-bold tracking-tight whitespace-nowrap text-muted-foreground uppercase"
            >
              {t}
            </span>
          ))}
        </div>
        <span className="hidden w-12 shrink-0 sm:block" />
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[10px] font-semibold text-muted-foreground">
        <span className="size-2.5 rounded-[3px] bg-heat-none" />
        <span className="mr-2">None</span>
        <span>{lo}</span>
        {(ramped ? RAMP_STOPS : [0]).map((f) => (
          <span
            key={f}
            className={cn("size-2.5 rounded-[3px]", heatClass(lo + (hi - lo) * f, lo, hi))}
          />
        ))}
        <span>{ramped ? `${hi} times` : `–${hi} times`}</span>
        <span className="ml-auto hidden sm:block">Days with an opening ▸</span>
      </div>
    </div>
  );
}
