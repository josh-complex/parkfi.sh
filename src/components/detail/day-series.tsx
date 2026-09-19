"use client";

import * as React from "react";
import type { ReactNode } from "react";

import { cn } from "#/lib/utils.ts";

import {
  ChartLegend,
  ChartSentence,
  ColumnChart,
  HEAT_BG,
  HeatRampKey,
  LegendKey,
  deltaClause,
  deltaTone,
} from "./chart-kit.tsx";

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
 * The words the calendar and the weekday bars build their sentences from.
 * Every series has its own idiom — a wait is "longer", a rate "costs more", a
 * table count "has more" — so the chart asks for the verbs rather than guess.
 */
export interface SeriesWords {
  /** "Quietest day" / "Cheapest check-in" / "Most open" — leads the idle line. */
  best: string;
  /** "Busiest" / "Priciest" / "Fewest openings". */
  worst: string;
  /** Comparative pair for the pointed-at value against the reference:
   *  ["longer than", "shorter than"], ["more than", "less than"]. */
  more?: string;
  less?: string;
  /** "usually run about" — how a weekday's mean is spoken. */
  usually?: string;
}

const DEFAULT_WORDS: Required<SeriesWords> = {
  best: "Lowest",
  worst: "Highest",
  more: "more than",
  less: "less than",
  usually: "usually average",
};

/**
 * A calendar of one value per day — five-odd weeks of it, one cell per date,
 * today ringed. No numbers in the cells: they're illegible at this size, so
 * the cell you point at is spoken in the sentence above the grid instead, and
 * compared with the average day.
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
  good = "min",
  words,
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
  /** A value in words, for the sentence and the legend's ends ("36 times"). */
  unit: (value: number) => string;
  /** Which end of the range is the good news — fewest minutes, most tables. */
  good?: "min" | "max";
  words?: SeriesWords;
  /** What a zero means here. Omit when zero can't occur in this series. */
  zeroLabel?: string;
  /**
   * What to say of the `today` cell when the series deliberately holds no
   * value for it. A forward-looking series starts *tomorrow* — today is a
   * part-day and not comparable to a whole one — but the cell is still drawn
   * and ringed, and "not recorded" would be a lie about why it's blank.
   */
  todayLabel?: string;
  className?: string;
}) {
  const w = { ...DEFAULT_WORDS, ...words };
  const [sel, setSel] = React.useState<string | null>(null);
  const cells = calendarCells(days, align, weeks);
  if (cells.length === 0) return null;

  const positives = cells.flatMap((c) => (c.value != null && c.value > 0 ? [c.value] : []));
  if (positives.length === 0) return null;
  const lo = Math.min(...positives);
  const hi = Math.max(...positives);
  const ramped = heatRamped(lo, hi);
  const avg = Math.round(positives.reduce((a, b) => a + b, 0) / positives.length);
  const drawn = cells.filter((c) => !c.pad && c.value != null && c.value > 0);
  const best = drawn.reduce<DayCell | null>(
    (b, c) => (!b || (good === "min" ? c.value! < b.value! : c.value! > b.value!) ? c : b),
    null,
  );
  const worst = drawn.reduce<DayCell | null>(
    (b, c) => (!b || (good === "min" ? c.value! > b.value! : c.value! < b.value!) ? c : b),
    null,
  );

  const active = sel ? (cells.find((c) => c.iso === sel) ?? null) : null;
  let headline: string;
  let subline: string;
  let tone: "good" | "bad" | "neutral" = "neutral";
  if (active) {
    headline =
      active.value == null
        ? `${active.label} · ${(active.iso === today ? todayLabel : null) ?? "not recorded"}`
        : active.value === 0
          ? `${active.label} · ${zeroLabel ?? unit(0)}`
          : `${active.label} · ${unit(active.value)}`;
    subline =
      active.value != null && active.value > 0
        ? deltaClause(active.value, avg, unit, "the average day", { more: w.more, less: w.less })
        : active.iso === today
          ? "Today is ringed."
          : "Nothing recorded for this day.";
    tone =
      active.value != null && active.value > 0 ? deltaTone(active.value, avg, good) : "neutral";
  } else if (best && worst && best.iso !== worst.iso) {
    headline = `${w.best}: ${best.label} · ${unit(best.value!)}`;
    subline = `${w.worst} was ${worst.label} · ${unit(worst.value!)}. Tap a day to compare.`;
  } else {
    headline = ramped ? `${unit(lo)} to ${unit(hi)} across the window` : `${unit(lo)} every day`;
    subline = "Tap a day for its figure.";
  }

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      <ChartSentence headline={headline} subline={subline} tone={tone} size="sm" />
      <div className="grid grid-cols-7 gap-1.5" onMouseLeave={() => setSel(null)}>
        {WEEKDAY_SHORT.map((wd) => (
          <span
            key={wd}
            className="text-center text-[10px] font-bold tracking-[0.06em] text-wash-muted uppercase"
          >
            {wd.slice(0, 1)}
          </span>
        ))}
        {cells.map((c) => {
          // Padding is drawn as the hole it is — no fill, no border, no button.
          if (c.pad && c.iso !== today)
            return <div key={c.iso} className="aspect-square" aria-hidden />;
          const hot = sel === c.iso;
          const isBest = best != null && c.iso === best.iso && best.iso !== worst?.iso;
          return (
            <button
              key={c.iso}
              type="button"
              aria-label={
                c.value == null
                  ? `${c.label}: ${(c.iso === today ? todayLabel : null) ?? "not recorded"}`
                  : c.value === 0
                    ? `${c.label}: ${zeroLabel ?? unit(0)}`
                    : `${c.label}: ${unit(c.value)}`
              }
              aria-pressed={hot}
              onMouseEnter={() => setSel(c.iso)}
              onFocus={() => setSel(c.iso)}
              onBlur={() => setSel(null)}
              onClick={() => setSel(c.iso)}
              className={cn(
                "relative aspect-square cursor-pointer rounded-[6px] outline-none transition-[box-shadow]",
                c.value == null
                  ? "border border-dashed border-card-edge"
                  : c.value === 0
                    ? "bg-heat-none"
                    : heatClass(c.value, lo, hi),
                c.iso === today && "ring-2 ring-brand-yellow ring-offset-2 ring-offset-card",
                hot && "ring-[3px] ring-wash-fg/50 ring-offset-2 ring-offset-card",
              )}
            >
              {/* The good answer, marked: a mint dot in the corner of the
                  cheapest / quietest / most-open day. */}
              {isBest && (
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
        {zeroLabel && <LegendKey swatch="zero">{zeroLabel}</LegendKey>}
        {ramped ? (
          <HeatRampKey from={unit(lo)} to={unit(hi)} />
        ) : (
          <LegendKey swatch={HEAT_BG[2]}>
            {lo === hi ? unit(lo) : `${lo}–${unit(hi)}`} every open day
          </LegendKey>
        )}
        {best && worst && best.iso !== worst.iso && <LegendKey swatch="best">{w.best}</LegendKey>}
        {today && <LegendKey swatch="now">Today</LegendKey>}
      </ChartLegend>
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
 * Seven weekday columns from their means — the bars under `WeekdayBars`, for
 * a caller that already holds per-weekday figures (the ride page's 30-day
 * rollup) rather than a run of days. The good end is mint; today's column
 * wears the yellow "Today" pill; the column you point at is spoken above.
 */
export function WeekdayColumns({
  means,
  good = "min",
  unit,
  words,
  today,
  claim = true,
  caption,
  heightClass = "min-h-32 flex-1",
  className,
}: {
  means: Array<number | null>;
  good?: "min" | "max";
  unit: (value: number) => string;
  words?: SeriesWords;
  /** Today's weekday, 0 = Sunday, to pin the "Today" pill on. */
  today?: number | null;
  /** Whether the best/worst *claim* may be made — false when the weekdays
   *  weren't measured evenly (see `WeekdayBars`). */
  claim?: boolean;
  caption?: (stats: WeekdayStats) => ReactNode;
  heightClass?: string;
  className?: string;
}) {
  const w = { ...DEFAULT_WORDS, ...words };
  const [sel, setSel] = React.useState<number | null>(null);
  const present = means.filter((m): m is number => m != null);
  if (present.length === 0) return null;
  const peak = Math.max(...present);
  const trough = Math.min(...present);
  const bestValue = good === "min" ? trough : peak;
  const worstValue = good === "min" ? peak : trough;
  const bestIndex = means.indexOf(bestValue);
  const worstIndex = means.indexOf(worstValue);
  const ranked = claim && bestIndex !== worstIndex;

  const active = sel != null ? means[sel] : null;
  let headline: string;
  let subline: string;
  let tone: "good" | "bad" | "neutral" = "neutral";
  if (sel != null && active != null) {
    headline = `${WEEKDAY_LONG[sel]}s ${w.usually} ${unit(active)}`;
    subline =
      ranked && sel !== bestIndex
        ? deltaClause(active, bestValue, unit, `${WEEKDAY_LONG[bestIndex]}s, the best day`, {
            more: w.more,
            less: w.less,
          })
        : ranked
          ? `The best day of the week here.`
          : `Tap another weekday to compare.`;
    tone = ranked && sel !== bestIndex ? deltaTone(active, bestValue, good) : "good";
    if (!ranked) tone = "neutral";
  } else if (sel != null) {
    headline = `${WEEKDAY_LONG[sel]}s · not recorded`;
    subline = "The window never covered one.";
  } else if (ranked) {
    headline = `${w.best}: ${WEEKDAY_LONG[bestIndex]}s · ${unit(bestValue)}`;
    subline = `${w.worst}: ${WEEKDAY_LONG[worstIndex]}s · ${unit(worstValue)}. Tap a bar to compare.`;
  } else {
    headline = `${unit(trough)} to ${unit(peak)} across the week`;
    subline = "Tap a bar for its weekday.";
  }

  return (
    <div className={cn("flex min-h-0 flex-1 flex-col gap-3", className)}>
      <ChartSentence headline={headline} subline={subline} tone={tone} size="sm" />
      <ColumnChart
        columns={means.map((m, i) => ({
          key: WEEKDAY_SHORT[i]!,
          value: m,
          label: WEEKDAY_SHORT[i]!.slice(0, 1),
          name: `${WEEKDAY_LONG[i]}: ${m == null ? "not recorded" : unit(m)}`,
          tone: ranked && i === bestIndex ? "best" : "measured",
        }))}
        selected={sel}
        onSelect={setSel}
        anchor={today != null && today >= 0 ? { index: today, label: "Today" } : null}
        heightClass={heightClass}
        className="min-h-0 flex-1"
      />
      <ChartLegend>
        <LegendKey swatch="measured">Weekday average</LegendKey>
        {ranked && <LegendKey swatch="best">{w.best}</LegendKey>}
        {today != null && today >= 0 && <LegendKey swatch="now">Today</LegendKey>}
      </ChartLegend>
      {caption && ranked && (
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

/**
 * The same window folded onto the seven weekdays, so someone choosing a day can
 * see which one this place actually rewards. The good end is picked out in
 * mint — it's the answer to the question the card is asking.
 *
 * Feed it whole weeks. Seven bars drawn from an uneven window aren't a weekday
 * comparison at all: with a forward series, availability drifts up with lead
 * time, so a weekday holding one far-out sample outranks one holding two near
 * ones on nothing but the slice boundary. The bars still draw — the shape is
 * honest enough — but the best/worst *claim* (in the sentence, the mint bar
 * and the `caption`) is withheld unless every covered weekday was measured
 * the same number of times.
 */
export function WeekdayBars({
  days,
  good = "min",
  unit,
  words,
  today,
  caption,
  className,
}: {
  days: Array<DayPoint>;
  /** Which end of the range is the good news — fewest minutes, most tables. */
  good?: "min" | "max";
  unit: (value: number) => string;
  words?: SeriesWords;
  /** Today's park-local `YYYY-MM-DD`, to pin the "Today" pill on its weekday. */
  today?: string | null;
  /** A closing line, given the stats the bars were drawn from. */
  caption?: (stats: WeekdayStats) => ReactNode;
  className?: string;
}) {
  const means = weekdayMeans(days);
  // Every weekday we drew must rest on the same number of days, or the ranking
  // is an artifact of where the window was cut rather than of the weekday.
  const counts = weekdayCounts(days).filter((n) => n > 0);
  const balanced = counts.length > 0 && Math.min(...counts) === Math.max(...counts);
  return (
    <WeekdayColumns
      means={means}
      good={good}
      unit={unit}
      words={words}
      today={today ? day(today).getDay() : null}
      claim={balanced}
      caption={caption}
      className={className}
    />
  );
}
