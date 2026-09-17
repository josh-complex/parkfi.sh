"use client";

import * as React from "react";
import type { ReactNode } from "react";

import { hourLabel } from "#/components/detail/hour-bars.tsx";
import { WashPanel } from "#/components/detail/panels.tsx";
import { Skeleton } from "#/components/ui/skeleton.tsx";
import { cn } from "#/lib/utils.ts";

import type { ParkCrowd } from "./types.ts";

/** One hour on the curve, already resolved to the figure we draw. */
interface Point {
  /** Position along the day — the x scale's domain. */
  i: number;
  hour: number;
  value: number;
  /** True when the figure is what this hour *usually* does, not what it did. */
  projected: boolean;
  now: boolean;
}

/**
 * The width the chart draws at before it has measured itself — the server's
 * markup and the first client render, so the two agree.
 */
const W_FALLBACK = 400;
/** The chart's height, in viewBox units *and* CSS pixels: the box is 1:1. */
const H = 190;
/** The narrowest the chart will draw; under this it falls back to scaling. */
const W_MIN = 280;
const PAD = { top: 16, right: 6, bottom: 22, left: 26 };

/**
 * The chart's drawing width in CSS pixels, so the SVG's user units *are*
 * device pixels and its 10px labels stay 10px at every size.
 *
 * A fixed `viewBox` plus `w-full` scales the whole drawing, which is right for
 * an icon and wrong for a chart (2026-09-17, Josh): this panel runs at ~480px
 * in a detail page's narrow column, at ~630px in the wide one, and at the full
 * page width below `wide` — so one 400-unit box drew the axis labels at 5px in
 * the first case and 28px in the last, with a 540px-tall curve to match.
 *
 * Height is constant, so a measurement never moves anything below the panel;
 * before one lands the SVG simply centres its natural 400×190 drawing, which
 * is also what a reader with no JavaScript gets.
 */
function useCurveWidth(el: Element | null) {
  const [width, setWidth] = React.useState(W_FALLBACK);
  React.useEffect(() => {
    if (!el) return;
    const read = () => setWidth(Math.max(W_MIN, Math.round(el.getBoundingClientRect().width)));
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, [el]);
  return width;
}

/** "Sunday" for a park-local `YYYY-MM-DD`, parsed at local midnight (never
 *  `Date.parse("2026-09-13")`, which is UTC and lands a day early). */
function weekdayName(date: string | null | undefined): string | null {
  if (!date) return null;
  const d = new Date(`${date}T00:00:00`);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString("en-US", { weekday: "long" });
}

/** Mean of a list, rounded; null when the list is empty. */
function mean(xs: Array<number>): number | null {
  if (xs.length === 0) return null;
  return Math.round(xs.reduce((a, b) => a + b, 0) / xs.length);
}

/**
 * The quietest stretch of the hours still to come: the minimum, widened to
 * every adjoining hour within `SLACK` minutes of it, so the answer is a window
 * a guest can actually aim at rather than a single hour.
 */
const SLACK = 4;

function bestWindow(points: Array<Point>): string | null {
  const ahead = points.filter((p) => p.projected);
  if (ahead.length === 0) return null;
  const min = Math.min(...ahead.map((p) => p.value));
  const i = ahead.findIndex((p) => p.value === min);
  let lo = i;
  let hi = i;
  while (lo > 0 && ahead[lo - 1]!.value <= min + SLACK) lo--;
  while (hi < ahead.length - 1 && ahead[hi + 1]!.value <= min + SLACK) hi++;
  // The window runs to the *end* of the last hour in the run.
  return `${hourLabel(ahead[lo]!.hour)} – ${hourLabel((ahead[hi]!.hour + 1) % 24)}`;
}

/**
 * How today is running against this weekday's own history: today's measured
 * hours against the typical figure for those same hours. Only hours that have
 * both count, so a park with no history simply loses the tile.
 */
function versusTypical(
  hours: ParkCrowd["hours"],
  weekday: string | null,
): { label: string; value: string } | null {
  const paired = hours.filter((h) => h.actual != null && h.typical != null);
  if (paired.length < 2) return null;
  const actual = mean(paired.map((h) => h.actual as number));
  const typical = mean(paired.map((h) => h.typical as number));
  if (actual == null || typical == null) return null;
  const delta = actual - typical;
  return {
    label: weekday ? `vs a typical ${weekday.slice(0, 3)}` : "vs typical",
    value:
      Math.abs(delta) < 2
        ? "About typical"
        : `${delta > 0 ? "+" : "\u2212"}${Math.abs(delta)} min ${delta > 0 ? "busier" : "quieter"}`,
  };
}

/** Split into runs of adjacent hours that share a `projected` flag, so measured
 *  and forecast draw as one continuous silhouette in two strokes. */
function segments(points: Array<Point>): Array<{ projected: boolean; points: Array<Point> }> {
  const out: Array<{ projected: boolean; points: Array<Point> }> = [];
  for (const p of points) {
    const last = out.at(-1);
    if (last && last.projected === p.projected) {
      last.points.push(p);
    } else {
      // The forecast starts where the measurement stopped, so the two strokes
      // meet instead of leaving a gap at the hour the guest is standing in.
      out.push({ projected: p.projected, points: last ? [last.points.at(-1)!, p] : [p] });
    }
  }
  return out;
}

/**
 * "The rest of today" — the hour-by-hour average, measured up to now and this
 * weekday's typical shape from here on, with the two things a guest does with
 * that: when the lines let up, and whether today is worse than the day usually
 * is.
 *
 * Drawn from `parks.crowd` on the park page and `parks.rideCrowd` on the ride
 * page — one payload shape, one chart. Only the words change (`subject`), and
 * the ride page hangs its own keys under it (`children`).
 *
 * Drawn as plain SVG rather than visx: it is one line on a grid, it costs
 * nothing, and it renders on the server — this is the band the page is about,
 * so it shouldn't wait on a chart chunk.
 */
export function TodayCurve({
  crowd,
  loading,
  title = "The rest of today",
  subject = "this park",
  children,
  className,
}: {
  crowd: ParkCrowd | undefined;
  loading: boolean;
  /** The panel's heading. The ride page asks a narrower question of it. */
  title?: string;
  /** What the closing line is about — "this park", "this ride". */
  subject?: string;
  /** The page's keys, under the caption. Desktop's primary call to action
   *  lives inside the job block (the phone's is in the floating bar). */
  children?: ReactNode;
  className?: string;
}) {
  const weekday = weekdayName(crowd?.date);
  const [plot, setPlot] = React.useState<SVGSVGElement | null>(null);
  const W = useCurveWidth(plot);

  const points: Array<Point> = (crowd?.hours ?? []).reduce<Array<Point>>((out, h) => {
    const value = h.actual ?? h.typical;
    if (value != null) {
      out.push({ i: out.length, hour: h.hour, value, projected: h.actual == null, now: h.now });
    }
    return out;
  }, []);

  if (loading) {
    return (
      <WashPanel title={title} className={className}>
        <Skeleton className="h-48 w-full rounded-2xl bg-wash-bar/60" />
      </WashPanel>
    );
  }

  // A curve needs a shape: two hours is a pair of sticks, not a day.
  if (points.length < 3) {
    return null;
  }

  const peak = points.reduce((best, p) => (p.value > best.value ? p : best), points[0]!);
  const max = Math.max(20, peak.value);
  const x = (i: number) =>
    PAD.left + (i / Math.max(1, points.length - 1)) * (W - PAD.left - PAD.right);
  const y = (v: number) => PAD.top + (1 - v / max) * (H - PAD.top - PAD.bottom);
  const path = (ps: Array<Point>) =>
    ps
      .map((p, i) => `${i === 0 ? "M" : "L"}${x(p.i).toFixed(1)} ${y(p.value).toFixed(1)}`)
      .join(" ");

  const nowIndex = points.findIndex((p) => p.now);
  const nowPoint = nowIndex >= 0 ? points[nowIndex]! : null;
  const window = bestWindow(points);
  const versus = versusTypical(crowd?.hours ?? [], weekday);
  // Three x ticks — open, the middle of the day, close — is all this width
  // carries legibly, and the ends are the ones a reader actually needs.
  const ticks = [0, Math.floor((points.length - 1) / 2), points.length - 1];
  const gridlines = [0.25, 0.5, 0.75, 1].map((f) => max * f);

  return (
    <WashPanel
      title={title}
      meta={`Peaks ${hourLabel(peak.hour)} · ${peak.value} min`}
      className={className}
    >
      <svg
        ref={setPlot}
        viewBox={`0 0 ${W} ${H}`}
        style={{ height: H }}
        className="block w-full"
        role="img"
        aria-label={`Average standby by hour. Busiest around ${hourLabel(peak.hour)} at about ${peak.value} minutes.`}
      >
        {gridlines.map((v) => (
          <g key={v}>
            <line
              x1={PAD.left}
              x2={W - PAD.right}
              y1={y(v)}
              y2={y(v)}
              className="stroke-wash-edge"
              strokeWidth={1}
            />
            <text
              x={0}
              y={y(v) + 3.5}
              className="fill-wash-muted text-[10px] font-semibold"
              fontSize={10}
            >
              {Math.round(v)}
            </text>
          </g>
        ))}

        {segments(points).map((s, i) => (
          <path
            key={i}
            d={path(s.points)}
            fill="none"
            strokeWidth={3}
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeDasharray={s.projected ? "7 6" : undefined}
            className={cn("stroke-wash-fg", s.projected && "opacity-70")}
          />
        ))}

        {nowPoint && (
          <>
            <line
              x1={x(nowIndex)}
              x2={x(nowIndex)}
              y1={PAD.top - 10}
              y2={H - PAD.bottom}
              className="stroke-brand-yellow"
              strokeWidth={2.5}
              strokeDasharray="5 4"
            />
            <circle
              cx={x(nowIndex)}
              cy={y(nowPoint.value)}
              r={6}
              className="fill-brand-yellow stroke-brand-yellow-shelf"
              strokeWidth={2}
            />
          </>
        )}

        {ticks.map((i) => (
          <text
            key={i}
            x={x(i)}
            y={H - 6}
            textAnchor={i === 0 ? "start" : i === points.length - 1 ? "end" : "middle"}
            className="fill-wash-muted text-[10px] font-semibold"
            fontSize={10}
          >
            {hourLabel(points[i]!.hour)}
          </text>
        ))}
      </svg>

      {(window || versus) && (
        <div className="flex gap-2.5">
          {window && (
            <div className="flex-1 rounded-2xl border border-wash-edge bg-card px-3 py-2.5">
              <span className="text-[10px] font-bold tracking-[0.06em] text-wash-muted uppercase">
                Best window left
              </span>
              <p className="mt-0.5 text-[14.5px] font-bold">{window}</p>
            </div>
          )}
          {versus && (
            <div className="flex-1 rounded-2xl border border-wash-edge bg-card px-3 py-2.5">
              <span className="text-[10px] font-bold tracking-[0.06em] text-wash-muted uppercase">
                {versus.label}
              </span>
              <p className="mt-0.5 text-[14.5px] font-bold">{versus.value}</p>
            </div>
          )}
        </div>
      )}

      <p className="text-[11.5px] leading-relaxed text-wash-muted">
        Solid is what we measured today. Dashed is what {subject} usually does at that hour on a{" "}
        {weekday ?? "day like this"}, averaged over the last eight weeks.
      </p>

      {children}
    </WashPanel>
  );
}
