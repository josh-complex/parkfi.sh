"use client";

import * as React from "react";
import type { CSSProperties, ReactNode } from "react";

import { hourLabel } from "#/components/detail/hour-bars.tsx";
import { cn } from "#/lib/utils.ts";

/**
 * The detail pages' chart language, lifted out of the ride page's "When to
 * ride" panel (`TodayCurve`) so every other chart on these pages can speak it.
 *
 * The paradigms, in the order a reader meets them:
 *
 *  1. **The sentence is the chart's output.** A bold headline states the
 *     answer for whatever is pointed at (or, with nothing pointed at, for the
 *     thing that matters most — now, the peak, the best day), and a muted
 *     subline compares it with the reference. No axis to read off.
 *  2. **Pointing rewrites the sentence.** Hover, tap and keyboard focus all
 *     select a mark; the container's `mouseleave` releases it. Every mark is a
 *     `<button>` with an `aria-label`, so the chart is a list to a screen
 *     reader and the sentence is `aria-live`.
 *  3. **The value sits at the foot of the mark** in an opaque pill — one fixed
 *     spot, never chasing the height — so a reader following the marks along
 *     doesn't hunt for the number.
 *  4. **"Now" is brand yellow** — the mark you're standing in, under a pill on
 *     a dotted drop line. A reference that isn't now (a median, an average)
 *     takes the wash ink instead, so yellow keeps meaning "you are here".
 *  5. **Measured is solid, usual is a dashed outline**, both in the wash blue.
 *     Magnitude is one hue; a ramp is reserved for the heat calendars.
 *  6. **The good answer is mint** — a "sweet spot" bracket under a window, the
 *     quietest bar, the cheapest day — and a bad delta is peach.
 *  7. **The legend row is the key**: small square swatches, the series named,
 *     and room on the right for a standing comparison.
 *
 * Plain `<div>`s wherever the mark count is small (a day of columns, seven
 * weekdays, a calendar): they render on the server, need no measuring, and
 * cost nothing. The line charts stay in visx (`trend-chart.tsx`) but wear the
 * same sentence, pills and ink.
 */

// ───────────────────────── labels ─────────────────────────────────────────

/** "9 AM", "Noon", "9:30 PM" for a minute of the day (may run past 1440). */
export function clockLabel(mod: number): string {
  const hour = Math.floor(mod / 60) % 24;
  const minute = mod % 60;
  if (minute === 0) return hourLabel(hour);
  const h = hour % 12 === 0 ? 12 : hour % 12;
  return `${h}:${String(minute).padStart(2, "0")} ${hour < 12 ? "AM" : "PM"}`;
}

/** "9 AM" for a park-local hour — the long form the charts label with. */
export { hourLabel };

/** Mean of a list, rounded; null when the list is empty. */
export function mean(xs: Array<number>): number | null {
  if (xs.length === 0) return null;
  return Math.round(xs.reduce((a, b) => a + b, 0) / xs.length);
}

/**
 * "12 min longer than …" — the comparison clause the sublines are built from.
 * `unit` renders the absolute difference; `than` names the reference.
 */
export function deltaClause(
  value: number,
  reference: number,
  unit: (n: number) => string,
  than: string,
  words: { more?: string; less?: string; same?: string } = {},
): string {
  const d = value - reference;
  if (Math.abs(d) < 1) return `${words.same ?? "About the same as"} ${than}.`;
  const more = words.more ?? "more than";
  const less = words.less ?? "less than";
  return `${unit(Math.abs(d))} ${d > 0 ? more : less} ${than}.`;
}

/** Sign of a delta as a sentence tone: good when the number went the good way. */
export function deltaTone(
  value: number,
  reference: number,
  good: "min" | "max" = "min",
): "good" | "bad" | "neutral" {
  const d = value - reference;
  if (Math.abs(d) < 1) return "neutral";
  return d < 0 === (good === "min") ? "good" : "bad";
}

/**
 * Where a label floating over column `i` of `n` anchors. Columns near either
 * edge pin it to that edge instead of centring it on the column, so a 70px
 * "Now · 21" over the second column of the day doesn't hang out of the panel.
 */
export function floatAt(i: number, n: number): { style: CSSProperties; className: string } {
  const at = (i + 0.5) / n;
  if (at < 0.08) return { style: { left: 0 }, className: "" };
  if (at > 0.92) return { style: { right: 0 }, className: "" };
  return { style: { left: `${at * 100}%` }, className: "-translate-x-1/2" };
}

/** The same, for a fraction along a plot rather than a column index. */
export function floatAtFraction(at: number): { style: CSSProperties; className: string } {
  if (at < 0.08) return { style: { left: 0 }, className: "" };
  if (at > 0.92) return { style: { right: 0 }, className: "" };
  return { style: { left: `${at * 100}%` }, className: "-translate-x-1/2" };
}

/**
 * Which columns get a label. Every column whose `keep` is true is wanted, then
 * anything within `clear` columns of one already kept is dropped, because a
 * 10px "3 PM" is wider than the column under it. The `always` column (Now)
 * wins its spot. Clearance scales with the column count.
 */
export function thinLabels(
  n: number,
  keep: (i: number) => boolean,
  always: number = -1,
): Set<number> {
  const clear = Math.max(2, Math.ceil(n / 10));
  const kept = new Set<number>();
  if (always >= 0) kept.add(always);
  for (let i = 0; i < n; i++) {
    if (i === always || !keep(i)) continue;
    if ([...kept].some((k) => Math.abs(k - i) < clear)) continue;
    kept.add(i);
  }
  return kept;
}

/**
 * The quietest (or busiest) stretch of a run of values: the extreme, widened
 * to every adjoining index within `slack` of it, so the answer is a window a
 * guest can aim at rather than a single column.
 */
export function bestRun(
  values: Array<number | null>,
  good: "min" | "max" = "min",
  slack = 4,
): { lo: number; hi: number; value: number } | null {
  const present = values.flatMap((v, i) => (v == null ? [] : [{ v, i }]));
  if (present.length === 0) return null;
  const best = present.reduce((b, p) => ((good === "min" ? p.v < b.v : p.v > b.v) ? p : b));
  const ok = (v: number | null) =>
    v != null && (good === "min" ? v <= best.v + slack : v >= best.v - slack);
  let lo = best.i;
  let hi = best.i;
  while (lo > 0 && ok(values[lo - 1]!)) lo--;
  while (hi < values.length - 1 && ok(values[hi + 1]!)) hi++;
  return { lo, hi, value: best.v };
}

// ───────────────────────── the sentence ───────────────────────────────────

/**
 * The words above the marks: the answer for what's pointed at. `aria-live` so
 * a keyboard reader hears the comparison as focus moves along the marks.
 * `size="sm"` for a chart sharing a grid row with three others.
 */
export function ChartSentence({
  headline,
  subline,
  tone = "neutral",
  size = "default",
  className,
}: {
  headline: ReactNode;
  subline?: ReactNode;
  /** Colours the subline when it carries a good or bad comparison. */
  tone?: "good" | "bad" | "neutral";
  size?: "default" | "sm";
  className?: string;
}) {
  const sm = size === "sm";
  return (
    <div
      className={cn("flex flex-col gap-0.5", sm ? "min-h-[2.75rem]" : "min-h-[3.25rem]", className)}
      aria-live="polite"
    >
      <p
        className={cn(
          "leading-tight font-bold text-foreground",
          sm ? "text-[15px] md:text-[16px]" : "text-[17px] md:text-[19px]",
        )}
      >
        {headline}
      </p>
      {subline && (
        <p
          className={cn(
            "leading-snug",
            sm ? "text-[12.5px]" : "text-[13px]",
            tone === "good" ? "text-mint-fg" : tone === "bad" ? "text-peach-fg" : "text-wash-muted",
          )}
        >
          {subline}
        </p>
      )}
    </div>
  );
}

// ───────────────────────── pills ──────────────────────────────────────────

/**
 * The little opaque label the charts hang on a mark. `now` is the brand-yellow
 * "you are here"; `mark` is a reference that isn't now (a median, an average)
 * in the wash ink; `value` is the hovered figure at the foot of a mark, on the
 * card so it reads over the bar it sits on and over a neighbour's drop line.
 */
export function Pill({
  tone = "value",
  className,
  style,
  children,
}: {
  tone?: "now" | "mark" | "value" | "best";
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
}) {
  return (
    <span
      style={style}
      className={cn(
        "rounded-full px-1.5 text-[11px] leading-5 font-extrabold whitespace-nowrap",
        tone === "now" && "bg-brand-yellow text-ink-on-yellow",
        tone === "mark" && "bg-wash-fg text-white dark:text-background",
        tone === "best" && "bg-mint-fg text-white dark:text-background",
        tone === "value" &&
          "border border-wash-edge bg-card leading-[18px] text-foreground shadow-[0_1px_0_0_rgb(0_0_0/0.04)]",
        className,
      )}
    >
      {children}
    </span>
  );
}

// ───────────────────────── legend ─────────────────────────────────────────

const SWATCH: Record<string, string> = {
  measured: "bg-wash-bar-strong",
  typical: "box-border border-2 border-dashed border-wash-bar-strong bg-wash-bar-strong/15",
  now: "bg-brand-yellow",
  best: "bg-mint-fg",
  mark: "bg-wash-fg",
  muted: "bg-wash-bar",
  none: "border border-dashed border-card-edge",
  zero: "bg-heat-none",
  cool: "bg-wait-cool",
  warm: "bg-wait-warm",
  hot: "bg-wait-hot",
  /** The likely-range band behind a trend line. */
  band: "bg-wash-bar-strong/25",
  /** The closed-hours hatch on a trend. */
  hatch:
    "bg-[repeating-linear-gradient(135deg,var(--wash-bar-strong)_0_1px,transparent_1px_4px)] opacity-70",
};

/** One entry in the legend row: a square swatch and the series it names. */
export function LegendKey({
  swatch,
  className,
  children,
}: {
  /** A named swatch, or a class string for a one-off colour. */
  swatch: keyof typeof SWATCH | (string & {});
  className?: string;
  children: ReactNode;
}) {
  return (
    <span className={cn("inline-flex items-center gap-1.5", className)}>
      <span className={cn("size-3 shrink-0 rounded-[3px]", SWATCH[swatch] ?? swatch)} aria-hidden />
      {children}
    </span>
  );
}

/** The five heat steps as classes, written out so Tailwind can see them. */
export const HEAT_BG = ["bg-heat-1", "bg-heat-2", "bg-heat-3", "bg-heat-4", "bg-heat-5"] as const;

/** The heat step's background class. */
export function heatBg(step: number): string {
  return HEAT_BG[Math.min(5, Math.max(1, step)) - 1]!;
}

/** The five heat steps in a row, quiet to packed — the calendars' key. */
export function HeatRampKey({ from, to }: { from: ReactNode; to: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span className="mr-0.5">{from}</span>
      {HEAT_BG.map((bg) => (
        <span key={bg} className={cn("size-3 rounded-[3px]", bg)} aria-hidden />
      ))}
      <span className="ml-0.5">{to}</span>
    </span>
  );
}

/**
 * The key under a chart. `note` sits on the right — the standing comparison
 * ("Today is running 9 min quieter than a typical Sat"), coloured by tone.
 */
export function ChartLegend({
  note,
  noteTone = "neutral",
  className,
  children,
}: {
  note?: ReactNode;
  noteTone?: "good" | "bad" | "neutral";
  className?: string;
  children?: ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11.5px] font-semibold text-wash-muted",
        className,
      )}
    >
      {children}
      {note && (
        <span
          className={cn(
            "ml-auto",
            noteTone === "good" ? "text-mint-fg" : noteTone === "bad" ? "text-peach-fg" : "",
          )}
        >
          {note}
        </span>
      )}
    </div>
  );
}

// ───────────────────────── columns ────────────────────────────────────────

export type ColumnTone = "measured" | "typical" | "best" | "bestTypical" | "now" | "muted";

export interface ColumnDatum {
  key: string | number;
  /** `null` draws a stub — "we hold nothing", which is not zero. */
  value: number | null;
  /** The label under the column; omit or null for none. */
  label?: string | null;
  /** How a screen reader names it — "4 PM: usually about 50 minutes". */
  name: string;
  tone?: ColumnTone;
}

const TONE_FILL: Record<ColumnTone, string> = {
  measured: "bg-wash-bar-strong",
  best: "bg-mint-fg",
  now: "bg-brand-yellow",
  muted: "bg-wash-bar/60",
  // Dashed tones take their border classes from the grain below.
  typical: "border-wash-bar-strong bg-wash-bar-strong/15",
  bestTypical: "border-mint-fg bg-mint-fg/15",
};

/**
 * A row of columns — the `TodayCurve` bars, generalised. Any count from seven
 * weekdays to fifty-six quarter-hours: the gaps, corners and dash weights
 * follow the column count so the bars never turn to dust.
 *
 * Controlled selection: the parent owns `selected` because it also owns the
 * sentence the selection rewrites. `anchor` puts the "Now" (or "Median") pill
 * over one column with a dotted drop line; `bracket` draws the sweet-spot rule
 * under a window of them.
 */
export function ColumnChart({
  columns,
  max,
  selected,
  onSelect,
  anchor,
  bracket,
  labelKeep,
  heightClass = "h-40 md:h-48",
  className,
}: {
  columns: Array<ColumnDatum>;
  /** The value a full-height column stands for. Defaults to the max, floored
   *  so a quiet series doesn't draw a 4-minute slot as a wall. */
  max?: number;
  selected: number | null;
  onSelect: (index: number | null) => void;
  anchor?: { index: number; label: ReactNode; tone?: "now" | "mark" } | null;
  bracket?: { lo: number; hi: number; label: string; tone?: "mint" | "peach" } | null;
  /** Which columns get their label; defaults to all. Thinning is applied on
   *  top so labels never collide. */
  labelKeep?: (column: ColumnDatum, index: number) => boolean;
  heightClass?: string;
  className?: string;
}) {
  const n = columns.length;
  if (n === 0) return null;
  const last = n - 1;
  const values = columns.map((c) => c.value);
  const peak = Math.max(0, ...values.map((v) => v ?? 0));
  const scale = max ?? Math.max(peak, 1);

  const fine = n > 30;
  const mid = n > 12 && !fine;
  const grid: CSSProperties = {
    gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))`,
    columnGap: fine ? 2 : mid ? 3 : n > 8 ? 4 : 6,
  };
  const shape = fine
    ? "rounded-t-[3px] rounded-b-[1px]"
    : mid
      ? "rounded-t-[5px] rounded-b-[2px]"
      : "rounded-t-[7px] rounded-b-[3px]";
  const dash = fine
    ? "border border-dashed"
    : mid
      ? "border-[1.5px] border-dashed"
      : "border-2 border-dashed";

  const anchorIndex = anchor?.index ?? -1;
  const labelled = thinLabels(
    n,
    (i) => columns[i]!.label != null && (labelKeep ? labelKeep(columns[i]!, i) : true),
    anchorIndex >= 0 && columns[anchorIndex]?.label != null ? anchorIndex : -1,
  );
  const anchorFloat = anchorIndex >= 0 ? floatAt(anchorIndex, n) : null;
  const anchorPct =
    anchorIndex >= 0 && columns[anchorIndex]?.value != null
      ? Math.max(6, Math.round(((columns[anchorIndex]!.value as number) / scale) * 100))
      : null;

  return (
    <div className={cn("flex flex-col gap-1.5", className)} onMouseLeave={() => onSelect(null)}>
      {/* The anchor pill has its own row above the bars, pinned over its
          column, so nothing a hover raises can land on it. */}
      <div className="relative h-5">
        {anchor && anchorFloat && (
          <Pill
            tone={anchor.tone ?? "now"}
            style={anchorFloat.style}
            className={cn("absolute top-0", anchorFloat.className)}
          >
            {anchor.label}
          </Pill>
        )}
      </div>

      {/* The plot is an absolutely-placed grid inside a sized box, so the bars'
          percentage heights resolve whether the box is fixed (`h-44`) or
          flexed to fill a card beside a taller neighbour (`flex-1`). */}
      <div className={cn("relative", heightClass)}>
        <div className="absolute inset-0 grid items-end" style={grid}>
          {columns.map((c, i) => {
            const tone = c.tone ?? "measured";
            const isAnchor = i === anchorIndex;
            const hot = selected === i;
            const pct = c.value == null ? 4 : Math.max(6, Math.round((c.value / scale) * 100));
            const dashed = tone === "typical" || tone === "bestTypical";
            return (
              <button
                key={c.key}
                type="button"
                aria-label={c.name}
                aria-pressed={hot}
                onMouseEnter={() => onSelect(i)}
                onFocus={() => onSelect(i)}
                onBlur={() => onSelect(null)}
                onClick={() => onSelect(i)}
                className="relative flex h-full min-w-0 cursor-pointer flex-col justify-end rounded-sm outline-none"
              >
                {isAnchor && anchorPct != null && (
                  <span
                    aria-hidden
                    style={{ bottom: `${anchorPct}%` }}
                    className={cn(
                      "absolute top-0 left-1/2 w-0 -translate-x-1/2 border-l-2 border-dotted",
                      (anchor?.tone ?? "now") === "now" ? "border-brand-yellow" : "border-wash-fg",
                    )}
                  />
                )}
                {hot && !(isAnchor && (anchor?.tone ?? "now") === "now") && c.value != null && (
                  <Pill tone="value" className="absolute bottom-1 left-1/2 z-10 -translate-x-1/2">
                    {c.value}
                  </Pill>
                )}
                <span
                  style={{ height: `${pct}%` }}
                  className={cn(
                    "block w-full transition-[box-shadow]",
                    shape,
                    c.value == null ? TONE_FILL.muted : TONE_FILL[tone],
                    dashed && c.value != null && dash,
                    hot && "ring-[3px] ring-wash-fg/40",
                  )}
                />
              </button>
            );
          })}
        </div>
      </div>

      {/* Labels under the columns. Each cell centres its label and lets it
          spill over the neighbours (blank by construction); the two ends lean
          inward so they stay inside the card's padding. */}
      <div className="grid" style={grid} aria-hidden>
        {columns.map((c, i) => (
          <span
            key={c.key}
            className={cn(
              "flex h-3.5 min-w-0 text-[10px] leading-[14px] font-bold whitespace-nowrap",
              i === 0 ? "justify-start" : i === last ? "justify-end" : "justify-center",
              i === anchorIndex ? "text-wash-fg" : "text-wash-muted",
            )}
          >
            {labelled.has(i) ? c.label : ""}
          </span>
        ))}
      </div>

      {bracket && (
        <div className="grid" style={grid} aria-hidden>
          <div
            style={{ gridColumn: `${bracket.lo + 1} / span ${bracket.hi - bracket.lo + 1}` }}
            className={cn(
              "flex min-w-0 border-t-2 pt-1",
              (bracket.tone ?? "mint") === "mint" ? "border-mint-fg" : "border-peach-fg",
              bracket.lo === 0
                ? "justify-start"
                : bracket.hi === last
                  ? "justify-end"
                  : "justify-center",
            )}
          >
            <span
              className={cn(
                "text-[10px] font-extrabold tracking-[0.06em] whitespace-nowrap uppercase",
                (bracket.tone ?? "mint") === "mint" ? "text-mint-fg" : "text-peach-fg",
              )}
            >
              {bracket.label}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

// ───────────────────────── rows ───────────────────────────────────────────

export interface RowDatum {
  key: string | number;
  label: string;
  value: number;
  /** The figure printed at the end of the track. */
  display: string;
  name: string;
  tone?: "measured" | "best" | "now";
}

/**
 * Horizontal bars — for a ranked list of named things (lands, rides), where
 * the name needs the width a column can't give it. Same pointing, same
 * sentence, same ink; the best row in mint.
 */
export function RowBars({
  rows,
  selected,
  onSelect,
  className,
}: {
  rows: Array<RowDatum>;
  selected: number | null;
  onSelect: (index: number | null) => void;
  className?: string;
}) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <div className={cn("flex flex-col gap-1", className)} onMouseLeave={() => onSelect(null)}>
      {rows.map((r, i) => {
        const hot = selected === i;
        const pct = Math.max(2, Math.round((r.value / max) * 100));
        const tone = r.tone ?? "measured";
        return (
          <button
            key={r.key}
            type="button"
            aria-label={r.name}
            aria-pressed={hot}
            onMouseEnter={() => onSelect(i)}
            onFocus={() => onSelect(i)}
            onBlur={() => onSelect(null)}
            onClick={() => onSelect(i)}
            className={cn(
              "grid cursor-pointer grid-cols-[minmax(0,7.5rem)_minmax(0,1fr)_2.75rem] items-center gap-2.5 rounded-lg px-1 py-0.5 text-left outline-none md:grid-cols-[minmax(0,9rem)_minmax(0,1fr)_3rem]",
              hot && "bg-wash/70",
            )}
          >
            <span
              className={cn(
                "truncate text-[11.5px] font-bold",
                hot ? "text-foreground" : "text-wash-muted",
              )}
            >
              {r.label}
            </span>
            <span className="relative h-4 min-w-0">
              <span
                style={{ width: `${pct}%` }}
                className={cn(
                  "absolute inset-y-0 left-0 rounded-r-[5px] rounded-l-[2px] transition-[box-shadow]",
                  TONE_FILL[tone],
                  hot && "ring-[3px] ring-wash-fg/40",
                )}
              />
            </span>
            <span
              className={cn(
                "text-right text-[11px] font-extrabold tabular-nums",
                hot ? "text-foreground" : "text-wash-muted",
              )}
            >
              {r.display}
            </span>
          </button>
        );
      })}
    </div>
  );
}

// ───────────────────────── heat ───────────────────────────────────────────

/** Which of the five heat steps a value falls in, over an observed range. */
export function heatStepOf(value: number, lo: number, hi: number): 1 | 2 | 3 | 4 | 5 {
  if (hi <= lo) return 3;
  return Math.min(5, Math.max(1, Math.ceil(((value - lo) / (hi - lo)) * 5))) as 1 | 2 | 3 | 4 | 5;
}

/** The heat step as an SVG-able colour. */
export function heatVar(step: number): string {
  return `var(--heat-${Math.min(5, Math.max(1, step))})`;
}

/** Whether ink on a heat step must be light: the top two steps are navy. */
export function heatInkLight(step: number): boolean {
  return step >= 4;
}

/**
 * The park's clock, for pinning "Now" on a chart of its day: today's date,
 * the hour and minute, all park-local. `null` on the server and through
 * hydration — the server's clock is not the reader's, and a pill that says
 * "Now" on the wrong column for a frame is worse than one that arrives a
 * frame late — then ticking once a minute.
 */
export function useParkClock(
  timeZone: string | null | undefined,
): { date: string; hour: number; minute: number } | null {
  const [clock, setClock] = React.useState<{ date: string; hour: number; minute: number } | null>(
    null,
  );
  React.useEffect(() => {
    const tz = timeZone || "America/New_York";
    const read = () => {
      const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone: tz,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
      }).formatToParts(new Date());
      const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
      setClock({
        date: `${get("year")}-${get("month")}-${get("day")}`,
        hour: Number(get("hour")) % 24,
        minute: Number(get("minute")),
      });
    };
    read();
    const id = window.setInterval(read, 60_000);
    return () => window.clearInterval(id);
  }, [timeZone]);
  return clock;
}

/**
 * Selection state for a chart whose marks are pointed at: the index (or key)
 * pointed at, or null for "nothing — describe the default". Just `useState`
 * with the null documented.
 */
export function useSelection<T = number>(): [T | null, (v: T | null) => void] {
  return React.useState<T | null>(null);
}
