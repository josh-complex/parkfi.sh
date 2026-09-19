"use client";

import * as React from "react";
import type { CSSProperties, ReactNode } from "react";

import { hourLabel } from "#/components/detail/hour-bars.tsx";
import { WashPanel } from "#/components/detail/panels.tsx";
import { Skeleton } from "#/components/ui/skeleton.tsx";
import { useIsMobile } from "#/hooks/use-mobile.ts";
import { cn } from "#/lib/utils.ts";

import type { ParkCrowd } from "./types.ts";

/**
 * How finely each page asks `parks.crowd` / `parks.rideCrowd` to slice the
 * day, in minutes. The park page draws the curve in a narrow column, so
 * half-hours; the ride page gives it the wide one, so quarter-hours. Every
 * caller of the query passes one of these, and the prefetch in the ride route
 * must pass the same value as the page or the two never share a cache entry.
 *
 * The *drawn* grain can still be coarser than the fetched one: a phone folds
 * quarter-hours back to half-hours (`mobileStep`) rather than ask for a second
 * copy of the day, because 56 columns across 340px are two pixels wide.
 */
export const PARK_CURVE_STEP = 30;
export const RIDE_CURVE_STEP = 15;

/** The least of a day the chart will draw. Under three hours it's two sticks. */
const MIN_SPAN_MINUTES = 180;

/** One bar on the chart, already resolved to the figure we draw. */
interface Point {
  /** Position along the day — the column index. */
  i: number;
  /** Minute of the park's day, running past 1440 for hours after midnight. */
  mod: number;
  value: number;
  /** This weekday's usual figure for the slot, when we hold one. */
  typical: number | null;
  /** True when the figure is what this slot *usually* does, not what it did. */
  projected: boolean;
  now: boolean;
}

/** "Sunday" for a park-local `YYYY-MM-DD`, parsed at local midnight (never
 *  `Date.parse("2026-09-13")`, which is UTC and lands a day early). */
function weekdayName(date: string | null | undefined): string | null {
  if (!date) return null;
  const d = new Date(`${date}T00:00:00`);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString("en-US", { weekday: "long" });
}

/** "9 AM", "Noon", "9:30 PM" for a minute of the day. */
function timeLabel(mod: number): string {
  const hour = Math.floor(mod / 60) % 24;
  const minute = mod % 60;
  if (minute === 0) return hourLabel(hour);
  const h = hour % 12 === 0 ? 12 : hour % 12;
  return `${h}:${String(minute).padStart(2, "0")} ${hour < 12 ? "AM" : "PM"}`;
}

/** Mean of a list, rounded; null when the list is empty. */
function mean(xs: Array<number>): number | null {
  if (xs.length === 0) return null;
  return Math.round(xs.reduce((a, b) => a + b, 0) / xs.length);
}

/**
 * Fold the payload's rows into coarser buckets of `step` minutes — the ride
 * page's quarter-hours into half-hours on a phone.
 *
 * Measured and typical are averaged apart, so the half-hour we are standing in
 * keeps the live figure from its measured half instead of being diluted by the
 * projection for the half after it. A bucket is "now" if any row in it is.
 * Rows arrive in day order and a park day never spans a full 24 hours, so
 * minute-of-day is a safe key and a run of equal keys is a bucket.
 */
function coarsen(hours: ParkCrowd["hours"], step: number): ParkCrowd["hours"] {
  const bins: Array<{ key: number; rows: ParkCrowd["hours"] }> = [];
  for (const h of hours) {
    const key = Math.floor((h.hour * 60 + h.minute) / step) * step;
    const open = bins.at(-1);
    if (open && open.key === key) open.rows.push(h);
    else bins.push({ key, rows: [h] });
  }
  return bins.map(({ key, rows }) => ({
    hour: Math.floor(key / 60),
    minute: key % 60,
    actual: mean(rows.flatMap((r) => (r.actual == null ? [] : [r.actual]))),
    typical: mean(rows.flatMap((r) => (r.typical == null ? [] : [r.typical]))),
    now: rows.some((r) => r.now),
  }));
}

/**
 * The quietest stretch of the slots still to come: the minimum, widened to
 * every adjoining slot within `SLACK` minutes of it, so the answer is a window
 * a guest can actually aim at rather than a single quarter-hour.
 */
const SLACK = 4;

function bestWindow(
  points: Array<Point>,
  step: number,
): { lo: number; hi: number; label: string } | null {
  const ahead = points.filter((p) => p.projected);
  if (ahead.length === 0) return null;
  const min = Math.min(...ahead.map((p) => p.value));
  const i = ahead.findIndex((p) => p.value === min);
  let lo = i;
  let hi = i;
  while (lo > 0 && ahead[lo - 1]!.value <= min + SLACK) lo--;
  while (hi < ahead.length - 1 && ahead[hi + 1]!.value <= min + SLACK) hi++;
  // The window runs to the *end* of the last slot in the run.
  return {
    lo: ahead[lo]!.i,
    hi: ahead[hi]!.i,
    label: `${timeLabel(ahead[lo]!.mod)} – ${timeLabel(ahead[hi]!.mod + step)}`,
  };
}

/**
 * How today is running against this weekday's own history: today's measured
 * slots against the typical figure for those same slots. Only slots that have
 * both count, so a park with no history simply loses the line.
 */
function versusTypical(
  hours: ParkCrowd["hours"],
  weekday: string | null,
): { delta: number; text: string } | null {
  const paired = hours.filter((h) => h.actual != null && h.typical != null);
  if (paired.length < 2) return null;
  const actual = mean(paired.map((h) => h.actual as number));
  const typical = mean(paired.map((h) => h.typical as number));
  if (actual == null || typical == null) return null;
  const delta = actual - typical;
  const day = weekday ? `a typical ${weekday.slice(0, 3)}` : "usual";
  return {
    delta,
    text:
      Math.abs(delta) < 2
        ? `Today is running about like ${day}`
        : `Today is running ${Math.abs(delta)} min ${delta > 0 ? "busier" : "quieter"} than ${day}`,
  };
}

/**
 * Which columns get a time under them. Every third hour of the clock, both
 * ends and "Now" — then anything within `clear` columns of a label already
 * kept is dropped, because a 10px "3 PM" is wider than the column it sits
 * under and two of them side by side collide. "Now" always wins its spot.
 * The clearance scales with the column count: a quarter-hour chart has
 * columns a quarter the width, so a label covers four times as many.
 */
function labelledColumns(points: Array<Point>, nowIndex: number): Set<number> {
  const clear = Math.max(2, Math.ceil(points.length / 10));
  const want = new Set<number>();
  points.forEach((p, i) => {
    if (i === 0 || i === points.length - 1 || p.mod % 180 === 0) want.add(i);
  });
  const kept = new Set<number>();
  if (nowIndex >= 0) kept.add(nowIndex);
  for (const i of [...want].sort((a, b) => a - b)) {
    if (i === nowIndex) continue;
    if ([...kept].some((k) => Math.abs(k - i) < clear)) continue;
    kept.add(i);
  }
  return kept;
}

/**
 * The words above the bars for the slot a reader is pointing at — or, with
 * nothing pointed at, for the one they are standing in.
 */
function describe(
  points: Array<Point>,
  active: Point | null,
  nowPoint: Point | null,
  peak: Point,
  window: ReturnType<typeof bestWindow>,
  weekday: string | null,
  subject: string,
): { headline: string; subline: string } {
  const day = weekday ?? "day like this";
  const ahead = window ? `Quietest stretch still to come: ${window.label}. ` : "";

  // Nothing pointed at, or pointing at the slot we're in.
  if (!active || (nowPoint && active.i === nowPoint.i)) {
    if (nowPoint) {
      const measured = points.filter((p) => !p.projected).map((p) => p.value);
      const lowest = nowPoint.value <= Math.min(...measured);
      const highest = nowPoint.value >= Math.max(...measured);
      const tail =
        measured.length > 1 && lowest
          ? " — the shortest line so far today."
          : measured.length > 1 && highest
            ? " — the longest line so far today."
            : ".";
      return {
        headline: `Right now: ${nowPoint.value} min${tail}`,
        subline: `${ahead}Tap a bar to compare it with now.`,
      };
    }
    // No current slot: the park is yet to open, or has already closed.
    const allProjected = points.every((p) => p.projected);
    return {
      headline: allProjected
        ? `Expect a peak around ${timeLabel(peak.mod)} · ~${peak.value} min`
        : `Today peaked at ${timeLabel(peak.mod)} · ${peak.value} min`,
      subline: allProjected
        ? `${ahead}What ${subject} usually does on a ${day}.`
        : `What we measured at ${subject} today. Tap a bar for the time.`,
    };
  }

  const at = timeLabel(active.mod);
  const headline = active.projected
    ? `${at} usually runs about ${active.value} min`
    : `${at} was ${active.value} min`;
  const parts: Array<string> = [];
  if (nowPoint) {
    const d = active.value - nowPoint.value;
    parts.push(
      d > 0
        ? `${d} min longer than the line right now.`
        : d < 0
          ? `${-d} min shorter than right now${active.projected ? " — worth waiting for" : ""}.`
          : "About the same as right now.",
    );
  }
  // Where a projected figure comes from is a standing fact about the dashed
  // bars, not about the one you're pointing at — it lives in the panel's meta
  // line, under "Peaks", so the sentence here stays the comparison.
  if (!active.projected && active.typical != null) {
    parts.push(`Usually about ${active.typical} at this time on a ${day}.`);
  }
  return {
    headline,
    subline: parts.join(" ") || `What ${subject} usually does on a ${day}.`,
  };
}

/**
 * Where a label floating over column `i` of `n` anchors. Columns near either
 * edge pin it to that edge instead of centring it on the column, so a 70px
 * "Now · 21" over the second quarter-hour of the day doesn't hang out of the
 * panel. Returns the inline position and the class that does the centring.
 */
function floatAt(i: number, n: number): { style: CSSProperties; className: string } {
  const at = (i + 0.5) / n;
  if (at < 0.08) return { style: { left: 0 }, className: "" };
  if (at > 0.92) return { style: { right: 0 }, className: "" };
  return { style: { left: `${at * 100}%` }, className: "-translate-x-1/2" };
}

/**
 * "The rest of today" as a row of bars — Google's popular-times idea, over a
 * queue instead of a shop. Solid bars are what we measured today, dashed
 * outlines are what this weekday usually does from here, the slot you're
 * standing in is brand yellow under a "Now" pill on a dotted drop line, and
 * the quietest stretch still ahead is picked out in mint with a bracket
 * under it.
 *
 * Pointing at a bar (hover, tap, or keyboard focus) rewrites the headline
 * into a comparison against right now — "4:15 PM usually runs about 28 min ·
 * 13 min longer than the line right now" — so the chart answers the question
 * a guest actually has without their reading an axis. There is no axis: the
 * value sits at the foot of the bar you're looking at — always the same spot,
 * never chasing the bar's height — and the legend row is the key.
 *
 * The bar width is the payload's: the query buckets the day by the `step` its
 * caller asks for (`PARK_CURVE_STEP`, `RIDE_CURVE_STEP`) and the chart reads
 * the grain back off the rows, so one component draws 14 hourly bars or 56
 * quarter-hours without being told which. `mobileStep` folds a fetched grain
 * finer than a phone can draw back to a coarser one under `md`.
 *
 * Plain `<div>`s rather than visx (2026-09-18, Josh): fifty columns cost
 * nothing, need no measurement, and render on the server — this is the band
 * the page is about, so it shouldn't wait on a chart chunk.
 */
export function TodayCurve({
  crowd,
  loading,
  title = "The rest of today",
  subject = "this park",
  mobileStep,
  children,
  className,
}: {
  crowd: ParkCrowd | undefined;
  loading: boolean;
  /** The panel's heading. The ride page asks a narrower question of it. */
  title?: string;
  /** What the closing line is about — "this park", "this ride". */
  subject?: string;
  /**
   * Draw this grain instead, in minutes, under the `md` breakpoint — for a
   * page that fetches a finer day than a phone has pixels for. The rows are
   * folded on the client, so the phone and the desktop share one query.
   */
  mobileStep?: number;
  /** The page's keys, under the legend. Desktop's primary call to action
   *  lives inside the job block (the phone's is in the floating bar). */
  children?: ReactNode;
  className?: string;
}) {
  const weekday = weekdayName(crowd?.date);
  // The column a reader is pointing at; null means "the slot we're in".
  const [sel, setSel] = React.useState<number | null>(null);
  // False on the server and through hydration, so both renders agree and the
  // phone re-folds to its own grain on the first client pass.
  const isMobile = useIsMobile();
  const rows = React.useMemo(() => {
    const hours = crowd?.hours ?? [];
    return isMobile && mobileStep ? coarsen(hours, mobileStep) : hours;
  }, [crowd?.hours, isMobile, mobileStep]);

  // Minute-of-day runs on past midnight so a 1 AM close sorts after 11 PM.
  let prevMod = -1;
  const points: Array<Point> = rows.reduce<Array<Point>>((out, h) => {
    const value = h.actual ?? h.typical;
    let mod = h.hour * 60 + h.minute;
    if (mod < prevMod) mod += 1440;
    prevMod = mod;
    if (value != null) {
      out.push({
        i: out.length,
        mod,
        value,
        typical: h.typical,
        projected: h.actual == null,
        now: h.now,
      });
    }
    return out;
  }, []);
  // The grain the query bucketed by, read back off the rows.
  const step =
    points.length > 1 ? Math.min(...points.slice(1).map((p, k) => p.mod - points[k]!.mod)) : 60;

  if (loading) {
    return (
      <WashPanel title={title} className={className}>
        <Skeleton className="h-48 w-full rounded-2xl bg-wash-bar/60" />
      </WashPanel>
    );
  }

  // A day needs a shape: three hours is the least that has one.
  if (points.length * step < MIN_SPAN_MINUTES) {
    return null;
  }

  const n = points.length;
  const last = n - 1;
  const peak = points.reduce((best, p) => (p.value > best.value ? p : best), points[0]!);
  // Floor the scale so a genuinely quiet day doesn't draw a 4-minute slot as a
  // full-height bar and read as a wall-to-wall queue.
  const max = Math.max(20, peak.value);
  const nowIndex = points.findIndex((p) => p.now);
  const nowPoint = nowIndex >= 0 ? points[nowIndex]! : null;
  const nowFloat = floatAt(nowIndex, n);
  const window = bestWindow(points, step);
  const versus = versusTypical(rows, weekday);
  const labelled = labelledColumns(points, nowIndex);
  const active = sel != null ? (points[sel] ?? null) : nowPoint;
  const { headline, subline } = describe(points, active, nowPoint, peak, window, weekday, subject);
  const dayShort = weekday ? weekday.slice(0, 3) : "day like this";

  // Column geometry follows the grain: fifty-six quarter-hours need thinner
  // gaps and tighter corners than fourteen hours, or the bars turn to dust.
  const fine = step <= 15;
  const mid = step > 15 && step < 60;
  const grid: CSSProperties = {
    gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))`,
    columnGap: fine ? 2 : mid ? 3 : 5,
  };
  const barShape = fine
    ? "rounded-t-[3px] rounded-b-[1px]"
    : mid
      ? "rounded-t-[5px] rounded-b-[2px]"
      : "rounded-t-[7px] rounded-b-[3px]";
  const dash = fine
    ? "border border-dashed"
    : mid
      ? "border-[1.5px] border-dashed"
      : "border-2 border-dashed";

  // Where the dashed bars come from: a standing note, so it sits under the
  // peak in the header rather than moving through the sentence under it.
  const basis = points.some((p) => p.projected)
    ? `Averaged over the last eight ${weekday ? `${weekday}s` : "weeks"}`
    : null;

  return (
    <WashPanel
      title={title}
      meta={
        <>
          <span className="block">
            Peaks {timeLabel(peak.mod)} · {peak.value} min
          </span>
          {basis && (
            /* Capped on a phone so it wraps rather than crowd the heading out
               of its own row; the wide column has room for the one line. */
            <span className="ml-auto block max-w-[10.5rem] text-[11.5px] font-medium opacity-80 md:max-w-none">
              {basis}
            </span>
          )}
        </>
      }
      className={className}
    >
      {/* The sentence the chart exists to produce. `aria-live` so a keyboard
          reader hears the comparison as focus moves along the bars. */}
      <div className="flex min-h-[3.25rem] flex-col gap-0.5" aria-live="polite">
        <p className="text-[17px] leading-tight font-bold text-foreground md:text-[19px]">
          {headline}
        </p>
        <p className="text-[13px] leading-snug text-wash-muted">{subline}</p>
      </div>

      <div className="flex flex-col gap-1.5" onMouseLeave={() => setSel(null)}>
        {/* The "Now" pill has its own row above the bars, pinned over the
            current column, so nothing a hover raises can land on it. */}
        <div className="relative h-5">
          {nowPoint && (
            <span
              aria-hidden
              style={nowFloat.style}
              className={cn(
                "absolute top-0 rounded-full bg-brand-yellow px-1.5 text-[11px] leading-5 font-extrabold whitespace-nowrap text-ink-on-yellow",
                nowFloat.className,
              )}
            >
              Now · {nowPoint.value}
            </span>
          )}
        </div>

        <div className="grid h-44 items-end md:h-52" style={grid}>
          {points.map((p, i) => {
            const isNow = p.now;
            const inWindow = window != null && i >= window.lo && i <= window.hi;
            const hot = sel === i;
            const pct = Math.max(6, Math.round((p.value / max) * 100));
            return (
              <button
                key={p.mod}
                type="button"
                aria-label={`${timeLabel(p.mod)}: ${p.projected ? "usually about" : "measured"} ${p.value} minutes`}
                aria-pressed={hot}
                onMouseEnter={() => setSel(i)}
                onFocus={() => setSel(i)}
                onBlur={() => setSel(null)}
                onClick={() => setSel(i)}
                className="relative flex h-full min-w-0 cursor-pointer flex-col justify-end rounded-sm outline-none"
              >
                {/* The drop line from the "Now" pill to the top of its bar. */}
                {isNow && (
                  <span
                    aria-hidden
                    style={{ bottom: `${pct}%` }}
                    className="absolute top-0 left-1/2 w-0 -translate-x-1/2 border-l-2 border-dotted border-brand-yellow"
                  />
                )}
                {/* The hovered value, dead centre over its own bar and just
                    above the baseline — one fixed spot, so a reader following
                    the bars along doesn't have to chase the number up and down
                    the plot to read it. Opaque, so it reads over the bar it
                    sits on and over a neighbour's drop line. The current slot
                    needs none: its pill is already up. */}
                {hot && !isNow && (
                  <span
                    aria-hidden
                    className="absolute bottom-1 left-1/2 z-10 -translate-x-1/2 rounded-full border border-wash-edge bg-card px-1.5 text-[11px] leading-[18px] font-extrabold whitespace-nowrap text-foreground"
                  >
                    {p.value}
                  </span>
                )}
                <span
                  style={{ height: `${pct}%` }}
                  className={cn(
                    "block w-full transition-[box-shadow]",
                    barShape,
                    isNow
                      ? "bg-brand-yellow"
                      : p.projected
                        ? inWindow
                          ? cn(dash, "border-mint-fg bg-mint-fg/15")
                          : cn(dash, "border-wash-bar-strong bg-wash-bar-strong/15")
                        : "bg-wash-bar-strong",
                    hot && "ring-[3px] ring-wash-fg/40",
                  )}
                />
              </button>
            );
          })}
        </div>

        {/* Times under the columns. Each cell centres its label and lets it
            spill over the neighbours (which are blank by construction); the
            two ends lean inward so they stay inside the panel's padding. */}
        <div className="grid" style={grid} aria-hidden>
          {points.map((p, i) => (
            <span
              key={p.mod}
              className={cn(
                "flex h-3.5 min-w-0 text-[10px] leading-[14px] font-bold whitespace-nowrap",
                i === 0 ? "justify-start" : i === last ? "justify-end" : "justify-center",
                p.now ? "text-wash-fg" : "text-wash-muted",
              )}
            >
              {labelled.has(i) ? (p.now ? "Now" : timeLabel(p.mod)) : ""}
            </span>
          ))}
        </div>

        {/* The bracket under the quietest stretch ahead. Same grid, so it
            lands under exactly those bars at every width; the label spills
            away from whichever edge the window touches. */}
        {window && (
          <div className="grid" style={grid} aria-hidden>
            <div
              style={{ gridColumn: `${window.lo + 1} / span ${window.hi - window.lo + 1}` }}
              className={cn(
                "flex min-w-0 border-t-2 border-mint-fg pt-1",
                window.lo === 0
                  ? "justify-start"
                  : window.hi === last
                    ? "justify-end"
                    : "justify-center",
              )}
            >
              <span className="text-[10px] font-extrabold tracking-[0.06em] whitespace-nowrap text-mint-fg uppercase">
                Sweet spot
              </span>
            </div>
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11.5px] font-semibold text-wash-muted">
        <span className="inline-flex items-center gap-1.5">
          <span className="size-3 rounded-[3px] bg-wash-bar-strong" aria-hidden />
          Measured today
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span
            className="box-border size-3 rounded-[3px] border-2 border-dashed border-wash-bar-strong bg-wash-bar-strong/15"
            aria-hidden
          />
          Usual for a {dayShort}
        </span>
        {nowPoint && (
          <span className="inline-flex items-center gap-1.5">
            <span className="size-3 rounded-[3px] bg-brand-yellow" aria-hidden />
            Now
          </span>
        )}
        {versus && (
          <span
            className={cn(
              "ml-auto",
              versus.delta <= -2 ? "text-mint-fg" : versus.delta >= 2 ? "text-peach-fg" : "",
            )}
          >
            {versus.text}
          </span>
        )}
      </div>

      {/* The bars carry their own labels; this is the day in one breath, on
          the hour, for a reader who'd rather not tab through fifty of them. */}
      <p className="sr-only">
        Standby through the day at {subject}, {timeLabel(points[0]!.mod)} to{" "}
        {timeLabel(points[last]!.mod)}:{" "}
        {points
          .filter((p) => p.mod % 60 === 0)
          .map((p) => `${timeLabel(p.mod)} ${p.value} minutes${p.projected ? " typical" : ""}`)
          .join(", ")}
        .
      </p>

      {children}
    </WashPanel>
  );
}
