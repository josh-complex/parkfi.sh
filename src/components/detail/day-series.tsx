"use client";

import type { ReactNode } from "react";

import { cn } from "#/lib/utils.ts";

/** One day in a day-scale series. */
export interface DayPoint {
  /** Park-local `YYYY-MM-DD`. */
  date: string;
  /** `null` when we hold nothing for this day — which is not the same as zero. */
  value: number | null;
}

const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const WEEKDAY_LONG = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

/** A park-local `YYYY-MM-DD` as a real date, at local midnight — never
 *  `Date.parse("2026-09-13")`, which is UTC and lands a day early west of
 *  Greenwich. */
function day(date: string): Date {
  return new Date(`${date}T00:00:00`);
}

function isoOf(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function shift(d: Date, days: number): Date {
  const out = new Date(d);
  out.setDate(out.getDate() + days);
  return out;
}

/** One drawn cell: its date, how a tooltip names it, and what we hold for it. */
export interface DayCell {
  iso: string;
  label: string;
  value: number | null;
  /**
   * True for a cell outside the series entirely — the days before the first and
   * after the last, which exist only so the grid is whole weeks and a column is
   * one weekday. Not the same as a day inside the window we hold nothing for:
   * that's a gap in the sweep and worth drawing. Padding is nothing at all, and
   * drawing it as a bordered box put four empty squares in front of every
   * forecast that didn't happen to start on a Sunday.
   */
  pad: boolean;
}

/**
 * The calendar's window, as whole Sunday-to-Saturday weeks — so every column of
 * the grid really is one weekday, which is the only reason the columns mean
 * anything.
 *
 * `"end"` hangs the window on the last day we hold (a history runs up to
 * today); `"start"` hangs it on the first (a forecast runs forward from today)
 * and stops at the last day we hold rather than padding out the requested
 * weeks — a forecast's trailing rows would otherwise be a fortnight of cells
 * claiming "nothing", which is not the same claim as "we haven't looked".
 */
export function calendarCells(
  days: Array<DayPoint>,
  align: "end" | "start" = "end",
  weeks = 5,
): Array<DayCell> {
  if (days.length === 0) return [];
  const byDate = new Map(days.map((d) => [d.date, d.value]));
  const first = day(days[0]!.date);
  const last = day(days[days.length - 1]!.date);
  const span = weeks * 7;

  let start: Date;
  let end: Date;
  if (align === "end") {
    end = shift(last, 6 - last.getDay());
    start = shift(end, -(span - 1));
  } else {
    start = shift(first, -first.getDay());
    end = shift(last, 6 - last.getDay());
    if ((end.getTime() - start.getTime()) / 86_400_000 + 1 > span) {
      end = shift(start, span - 1);
    }
  }

  const cells: Array<DayCell> = [];
  for (let d = start; d <= end; d = shift(d, 1)) {
    const iso = isoOf(d);
    cells.push({
      iso,
      label: d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }),
      value: byDate.get(iso) ?? null,
      pad: d < first || d > last,
    });
  }
  return cells;
}

function weekdayBuckets(days: Array<DayPoint>): Array<Array<number>> {
  const buckets = WEEKDAY_SHORT.map(() => [] as Array<number>);
  for (const d of days) {
    if (d.value == null) continue;
    buckets[day(d.date).getDay()]!.push(d.value);
  }
  return buckets;
}

/** The window folded onto the seven weekdays, Sunday first. `null` for a
 *  weekday the window never covered, which draws as a stub rather than a zero. */
export function weekdayMeans(days: Array<DayPoint>): Array<number | null> {
  return weekdayBuckets(days).map((xs) =>
    xs.length === 0 ? null : Math.round(xs.reduce((a, b) => a + b, 0) / xs.length),
  );
}

/** How many days each weekday's mean was taken over — Sunday first. */
export function weekdayCounts(days: Array<DayPoint>): Array<number> {
  return weekdayBuckets(days).map((xs) => xs.length);
}

const HEAT_BG = ["bg-heat-1", "bg-heat-2", "bg-heat-3", "bg-heat-4", "bg-heat-5"] as const;

/**
 * The spread the five heat steps need before they're allowed to mean anything.
 *
 * The ramp is relative to the series (see `heatStep`), so without a floor it
 * happily paints a venue whose whole month runs between 9 and 10 open times as
 * a dramatic navy-to-white gradient — pixel-identical to one running 1 to 40.
 * Under this spread the series is drawn flat and the legend states the range in
 * words instead, which is the honest reading: nothing here varies.
 */
const MIN_HEAT_SPAN = 5;

/**
 * Which of the five heat steps a value falls in. Quintiles of the *observed*
 * range rather than fixed thresholds: two of these series can differ by a
 * factor of four (a 12-minute Tuesday at Universal Studios is a quiet day; at
 * Magic Kingdom it's a miracle), and a fixed ramp paints the quiet one entirely
 * pale.
 *
 * The range is taken over the values that are actually *there* — zero draws as
 * its own cell (see `zeroLabel`), so it neither anchors the ramp nor gets a
 * colour that says "a few".
 */
function heatStep(value: number, lo: number, hi: number): number {
  if (hi <= lo) return 3;
  return Math.min(5, Math.max(1, Math.ceil(((value - lo) / (hi - lo)) * 5)));
}

/**
 * The heat ramp as a class, shared by every chart that draws this scale so a
 * colour means the same thing across a page. `null` when the range is too
 * narrow to encode (see `MIN_HEAT_SPAN`) — draw the flat mid step instead.
 */
export function heatClass(value: number, lo: number, hi: number): string {
  if (hi - lo < MIN_HEAT_SPAN) return HEAT_BG[2];
  return HEAT_BG[heatStep(value, lo, hi) - 1]!;
}

/** Whether a range earns the five-step ramp at all. */
export function heatRamped(lo: number, hi: number): boolean {
  return hi - lo >= MIN_HEAT_SPAN;
}

/**
 * A calendar of one value per day — five-odd weeks of it, one cell per date,
 * today ringed. No numbers in the cells: they're illegible at this size, so
 * every cell carries its figure in its tooltip instead.
 *
 * Four states, because "we never looked", "we looked and there was nothing" and
 * "this square isn't a day in the series at all" are three different claims:
 * padding draws as nothing, `null` as a dashed hairline, `0` as the neutral
 * `--heat-none` step under the ramp (labelled by `zeroLabel` — "Full",
 * "Closed"), and everything above it takes the ramp itself. The zero step is
 * neutral on purpose: drawn in `--muted` it was a 97% grey against a 95% blue,
 * which at this cell size is the same colour, so a fully-booked day and a day
 * with two tables left were indistinguishable.
 */
export function DayHeatGrid({
  days,
  today,
  align = "end",
  weeks = 5,
  unit,
  zeroLabel,
  todayLabel,
  className,
}: {
  days: Array<DayPoint>;
  /** The date to ring. */
  today?: string | null;
  /** `"end"` ends the grid on the last day (a history); `"start"` begins it on
   *  the first (a forecast). Either way the grid is whole weeks, Sunday-first. */
  align?: "end" | "start";
  weeks?: number;
  /** A value in words, for the tooltips and the legend's ends ("36 times"). */
  unit: (value: number) => string;
  /** What a zero means here. Omit when zero can't occur in this series. */
  zeroLabel?: string;
  /**
   * Tooltip for the `today` cell when the series deliberately holds no value
   * for it. A forward-looking series starts *tomorrow* — today is a part-day
   * and not comparable to a whole one — but the cell is still drawn and ringed,
   * and "not recorded" would be a lie about why it's blank.
   */
  todayLabel?: string;
  className?: string;
}) {
  const cells = calendarCells(days, align, weeks);
  if (cells.length === 0) return null;

  const positives = cells.flatMap((c) => (c.value != null && c.value > 0 ? [c.value] : []));
  if (positives.length === 0) return null;
  const lo = Math.min(...positives);
  const hi = Math.max(...positives);
  const ramped = heatRamped(lo, hi);

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <div className="grid grid-cols-7 gap-1.5">
        {WEEKDAY_SHORT.map((w) => (
          <span
            key={w}
            className="text-center text-[10px] font-bold tracking-[0.06em] text-muted-foreground uppercase"
          >
            {w.slice(0, 1)}
          </span>
        ))}
        {cells.map((c) =>
          // Padding is drawn as the hole it is — no fill, no border, no tooltip.
          c.pad && c.iso !== today ? (
            <div key={c.iso} className="aspect-square" aria-hidden />
          ) : (
            <div
              key={c.iso}
              title={
                c.value == null
                  ? `${c.label} · ${(c.iso === today ? todayLabel : null) ?? "not recorded"}`
                  : c.value === 0
                    ? `${c.label} · ${zeroLabel ?? unit(0)}`
                    : `${c.label} · ${unit(c.value)}`
              }
              className={cn(
                "aspect-square rounded-[6px]",
                c.value == null
                  ? "border border-dashed border-card-edge"
                  : c.value === 0
                    ? "bg-heat-none"
                    : heatClass(c.value, lo, hi),
                c.iso === today && "ring-2 ring-brand-yellow ring-offset-2 ring-offset-card",
              )}
            />
          ),
        )}
      </div>
      <div className="flex flex-wrap items-center justify-end gap-x-1.5 gap-y-1 text-[10px] font-semibold text-muted-foreground">
        {zeroLabel && (
          <>
            <span className="size-2.5 rounded-[3px] bg-heat-none" />
            <span className="mr-1">{zeroLabel}</span>
          </>
        )}
        {ramped ? (
          <>
            <span>{unit(lo)}</span>
            {HEAT_BG.map((bg) => (
              <span key={bg} className={cn("size-2.5 rounded-[3px]", bg)} />
            ))}
            <span>{unit(hi)}</span>
          </>
        ) : (
          <>
            <span className={cn("size-2.5 rounded-[3px]", HEAT_BG[2])} />
            <span>{lo === hi ? unit(lo) : `${lo}–${unit(hi)}`} every open day</span>
          </>
        )}
      </div>
    </div>
  );
}

export interface WeekdayStats {
  /** Sunday-first averages; `null` for a weekday the window didn't cover. */
  means: Array<number | null>;
  /** Index of the weekday this series calls good, and of its opposite. */
  bestIndex: number;
  worstIndex: number;
  /** "Saturday" / "Sunday", ready for a sentence. */
  best: string;
  worst: string;
}

/**
 * The same window folded onto the seven weekdays, so someone choosing a day can
 * see which one this place actually rewards. The good end is picked out in
 * green — it's the answer to the question the card is asking.
 *
 * Feed it whole weeks. Seven bars drawn from an uneven window aren't a weekday
 * comparison at all: with a forward series, availability drifts up with lead
 * time, so a weekday holding one far-out sample outranks one holding two near
 * ones on nothing but the slice boundary. The bars still draw — the shape is
 * honest enough — but the `caption`'s best/worst *claim* is withheld unless
 * every covered weekday was measured the same number of times.
 *
 * The bars live inside a fixed-height box on purpose: a percentage height
 * resolves against nothing in an auto-height flex column, which is how the
 * venue page shipped this chart as seven numbers floating over seven labels
 * with no bars at all between them.
 */
export function WeekdayBars({
  days,
  good = "min",
  unit,
  caption,
  className,
}: {
  days: Array<DayPoint>;
  /** Which end of the range is the good news — fewest minutes, most tables. */
  good?: "min" | "max";
  unit: (value: number) => string;
  /** A closing line, given the stats the bars were drawn from. */
  caption?: (stats: WeekdayStats) => ReactNode;
  className?: string;
}) {
  const means = weekdayMeans(days);
  const present = means.filter((m): m is number => m != null);
  if (present.length === 0) return null;
  const peak = Math.max(...present);
  const trough = Math.min(...present);
  const bestValue = good === "min" ? trough : peak;
  const worstValue = good === "min" ? peak : trough;
  const bestIndex = means.indexOf(bestValue);
  const worstIndex = means.indexOf(worstValue);
  // Every weekday we drew must rest on the same number of days, or the ranking
  // is an artifact of where the window was cut rather than of the weekday.
  const counts = weekdayCounts(days).filter((n) => n > 0);
  const balanced = counts.length > 0 && Math.min(...counts) === Math.max(...counts);

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      <div className="flex items-end gap-2">
        {means.map((m, i) => (
          <div key={WEEKDAY_SHORT[i]} className="flex min-w-0 flex-1 flex-col items-center gap-1.5">
            {/* The definite height the bar's percentage is measured against.
                The figure rides *inside* it, directly on top of its own bar —
                in a row of its own above the box every figure sat at the same
                altitude, leaving a short Thursday's "10" floating a hundred
                pixels clear of the bar it belongs to. */}
            <div className="flex h-32 w-full flex-col justify-end gap-1">
              <span className="text-center text-[11px] font-bold tabular-nums">{m ?? "—"}</span>
              <div
                title={`${WEEKDAY_LONG[i]} · ${m == null ? "not recorded" : unit(m)}`}
                style={{ height: `${m == null ? 3 : Math.max(6, Math.round((m / peak) * 82))}%` }}
                className={cn(
                  "w-full rounded-t-[5px]",
                  m == null
                    ? "bg-heat-none"
                    : m === bestValue
                      ? "bg-wait-cool"
                      : "bg-wash-bar-strong dark:bg-wash-bar-strong",
                )}
              />
            </div>
            <span className="text-[10px] font-bold tracking-[0.04em] text-muted-foreground uppercase">
              {WEEKDAY_SHORT[i]!.slice(0, 1)}
            </span>
          </div>
        ))}
      </div>
      {caption && balanced && bestIndex !== worstIndex && (
        <p className="text-xs text-muted-foreground">
          {caption({
            means,
            bestIndex,
            worstIndex,
            best: WEEKDAY_LONG[bestIndex]!,
            worst: WEEKDAY_LONG[worstIndex]!,
          })}
        </p>
      )}
    </div>
  );
}
