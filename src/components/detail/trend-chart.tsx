"use client";

import * as React from "react";
import type { ReactNode } from "react";
import { bisector, extent } from "d3-array";
import { curveMonotoneX, curveStepAfter } from "@visx/curve";
import { localPoint } from "@visx/event";
import { LinearGradient } from "@visx/gradient";
import { Group } from "@visx/group";
import { PatternLines } from "@visx/pattern";
import { scaleLinear, scaleTime } from "@visx/scale";
import { Area, AreaClosed, Bar, Circle, Line, LinePath } from "@visx/shape";

import { ChartFrame } from "#/components/park-dashboard/visx/kit.tsx";
import { cn } from "#/lib/utils.ts";

import { Pill, floatAtFraction } from "./chart-kit.tsx";

/**
 * One reading on a line over time.
 *
 * `value: null` is a hole — we failed to look — and the line bridges it with a
 * dashed stroke. `closed` is the park calendar saying shut: the line sinks to
 * the floor under a hatch. `projected` is a figure we expect rather than one
 * we measured: dashed, like the usual-for-a-Saturday bars on the day curve.
 */
export interface TrendPoint {
  /** Epoch milliseconds. */
  t: number;
  value: number | null;
  /** The likely range, when the series carries one (min–max in a bucket, a
   *  forecast's p10–p90). Drawn as a soft band behind the line. */
  lo?: number | null;
  hi?: number | null;
  closed?: boolean;
  projected?: boolean;
}

type Kind = "live" | "gap" | "closed" | "projected";
type PairKind = "live" | "bridge" | "projected";

const INK = "var(--wash-bar-strong)";
const INK_STRONG = "var(--wash-fg)";
const YELLOW = "var(--brand-yellow)";

/**
 * A drawable value at every index: live and projected readings keep theirs,
 * closed buckets sink to `floor`, holes interpolate between their neighbours.
 */
function fill(
  points: Array<TrendPoint>,
  floor: number,
): { values: Array<number>; kinds: Array<Kind> } {
  const n = points.length;
  const kinds: Array<Kind> = points.map((p) =>
    p.closed ? "closed" : p.value == null ? "gap" : p.projected ? "projected" : "live",
  );
  const has = (k: Kind) => k === "live" || k === "projected";
  const prev = Array.from({ length: n }, () => -1);
  const next = Array.from({ length: n }, () => -1);
  for (let i = 0, last = -1; i < n; i++) {
    if (has(kinds[i]!)) last = i;
    prev[i] = last;
  }
  for (let i = n - 1, nx = -1; i >= 0; i--) {
    if (has(kinds[i]!)) nx = i;
    next[i] = nx;
  }
  const values = points.map((p, i) => {
    const k = kinds[i]!;
    if (has(k)) return p.value as number;
    if (k === "closed") return floor;
    const a = prev[i]!;
    const b = next[i]!;
    if (a < 0 && b < 0) return floor;
    if (a < 0) return points[b]!.value as number;
    if (b < 0) return points[a]!.value as number;
    const va = points[a]!.value as number;
    const vb = points[b]!.value as number;
    return va + ((vb - va) * (i - a)) / (b - a);
  });
  return { values, kinds };
}

/** Contiguous stretches of the line that stroke alike, sharing boundaries. */
function runs(kinds: Array<Kind>): Array<{ kind: PairKind; idx: Array<number> }> {
  const out: Array<{ kind: PairKind; idx: Array<number> }> = [];
  for (let i = 0; i < kinds.length - 1; i++) {
    const a = kinds[i]!;
    const b = kinds[i + 1]!;
    const kind: PairKind =
      a === "gap" || b === "gap" || a === "closed" || b === "closed"
        ? "bridge"
        : a === "projected" || b === "projected"
          ? "projected"
          : "live";
    const last = out.at(-1);
    if (!last || last.kind !== kind) out.push({ kind, idx: [i, i + 1] });
    else last.idx.push(i + 1);
  }
  return out;
}

const bisectT = bisector<TrendPoint, number>((d) => d.t).left;

let patternSeq = 0;

/**
 * A line over time in the detail pages' chart language: no axes and no grid,
 * the reading you point at spoken in the sentence above and pinned in a pill
 * at the foot of the plot, "Now" in brand yellow on a dotted drop line, the
 * measured stretch solid and anything expected or bridged dashed.
 *
 * Controlled like `ColumnChart`: the parent owns `selected` because it owns
 * the sentence. Keyboard: the plot is focusable and the arrow keys walk it.
 */
export function TrendChart({
  points,
  selected,
  onSelect,
  format,
  tickFormat,
  tickValues,
  anchor,
  reference,
  bracket,
  baseline = "zero",
  curve = "smooth",
  band = true,
  height = { base: 150, md: 190 },
  className,
}: {
  points: Array<TrendPoint>;
  selected: number | null;
  onSelect: (index: number | null) => void;
  /** The pinned figure — "45 min", "$412". */
  format: (value: number) => string;
  tickFormat: (d: Date) => string;
  /** Epoch-ms positions to label; defaults to a handful spread along the plot. */
  tickValues?: Array<number>;
  /** The "you are here" mark: an index, and the pill over it. */
  anchor?: { index: number; label: ReactNode; tone?: "now" | "mark" } | null;
  /** A dashed level across the plot — an average — and its label. */
  reference?: { value: number; label: string } | null;
  /** A mint rule under a window of indexes — the quietest stretch ahead. */
  bracket?: { lo: number; hi: number; label: string } | null;
  /** `zero` rests the area on a zero floor (waits); `fit` frames the values
   *  (prices), with no area under the line. */
  baseline?: "zero" | "fit";
  /** `step` holds each value until the next reading (a price). */
  curve?: "smooth" | "step";
  /** Draw the `lo`–`hi` band when the points carry one. */
  band?: boolean;
  height?: number | { base: number; md: number };
  className?: string;
}) {
  const id = React.useMemo(() => `trend-${++patternSeq}`, []);
  const n = points.length;
  const [t0, t1] = React.useMemo(() => extent(points, (p) => p.t) as [number, number], [points]);
  const { values, kinds } = React.useMemo(() => fill(points, 0), [points]);
  const strokes = React.useMemo(() => runs(kinds), [kinds]);

  const [vLo, vHi] = React.useMemo(() => {
    const ys = points.flatMap((p, i) => [
      values[i]!,
      ...(band && p.lo != null ? [p.lo] : []),
      ...(band && p.hi != null ? [p.hi] : []),
      ...(reference ? [reference.value] : []),
    ]);
    if (ys.length === 0) return [0, 1];
    const lo = Math.min(...ys);
    const hi = Math.max(...ys);
    if (baseline === "zero") return [0, Math.max(hi * 1.12, 1)];
    const pad = Math.max((hi - lo) * 0.18, Math.abs(hi) * 0.02, 1);
    return [lo - pad, hi + pad];
  }, [points, values, band, reference, baseline]);

  if (n < 2) return null;

  const at = (i: number) => (n <= 1 ? 0 : (points[i]!.t - t0) / Math.max(1, t1 - t0));
  const anchorFloat = anchor ? floatAtFraction(at(anchor.index)) : null;
  const sel = selected != null ? points[selected] : null;
  const curveFn = curve === "step" ? curveStepAfter : curveMonotoneX;

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      e.preventDefault();
      const cur = selected ?? anchor?.index ?? (e.key === "ArrowRight" ? -1 : n);
      const nxt = Math.max(0, Math.min(n - 1, cur + (e.key === "ArrowRight" ? 1 : -1)));
      onSelect(nxt);
    } else if (e.key === "Escape") {
      onSelect(null);
    }
  };

  return (
    <div className={cn("flex flex-col gap-1.5", className)} onMouseLeave={() => onSelect(null)}>
      {/* The anchor pill's own row, pinned over its reading. */}
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

      <div
        role="group"
        tabIndex={0}
        aria-label="Trend. Use the arrow keys to move along it."
        onKeyDown={onKey}
        onBlur={() => onSelect(null)}
        className="relative rounded-lg outline-none focus-visible:ring-[3px] focus-visible:ring-wash-fg/30"
      >
        <ChartFrame height={height}>
          {({ width, height: h }) => {
            const margin = { top: 6, right: 4, bottom: 2, left: 4 };
            const innerW = Math.max(0, width - margin.left - margin.right);
            const innerH = Math.max(0, h - margin.top - margin.bottom);
            const x = scaleTime({ domain: [new Date(t0), new Date(t1)], range: [0, innerW] });
            const y = scaleLinear({ domain: [vLo, vHi], range: [innerH, 0] });
            const px = (i: number) => x(new Date(points[i]!.t));
            const py = (i: number) => y(values[i]!);

            const pick = (e: React.MouseEvent | React.TouchEvent) => {
              const pt = localPoint(e);
              if (!pt) return;
              const t = x.invert(pt.x - margin.left).getTime();
              const idx = bisectT(points, t, 1);
              const a = idx - 1;
              const b = idx;
              const i =
                b >= n || (a >= 0 && t - points[a]!.t < points[b]!.t - t) ? Math.max(0, a) : b;
              onSelect(i);
            };

            return (
              <svg width={width} height={h} className="overflow-visible">
                <LinearGradient
                  id={`${id}-fill`}
                  from={INK}
                  to={INK}
                  fromOpacity={0.38}
                  toOpacity={0.03}
                />
                <PatternLines
                  id={`${id}-hatch`}
                  height={6}
                  width={6}
                  stroke={`color-mix(in srgb, ${INK} 28%, transparent)`}
                  strokeWidth={1}
                  orientation={["diagonal"]}
                />
                <Group left={margin.left} top={margin.top}>
                  {/* Closed stretches: a hatch, so a floor at zero reads as
                      "shut" rather than "empty queue". */}
                  {strokes
                    .filter((r) => r.kind === "bridge")
                    .map((r) => {
                      const closedIdx = r.idx.filter((i) => kinds[i] === "closed");
                      if (closedIdx.length === 0) return null;
                      const x0 = px(closedIdx[0]!);
                      const x1 = px(closedIdx.at(-1)!);
                      return (
                        <rect
                          key={`c${r.idx[0]}`}
                          x={Math.min(x0, x1)}
                          y={0}
                          width={Math.max(2, Math.abs(x1 - x0))}
                          height={innerH}
                          fill={`url(#${id}-hatch)`}
                        />
                      );
                    })}
                  {/* The likely range, then the area under the measured line. */}
                  {strokes
                    .filter((r) => r.kind !== "bridge")
                    .map((r) => {
                      const data = r.idx;
                      const hasBand =
                        band && data.some((i) => points[i]!.lo != null && points[i]!.hi != null);
                      return (
                        <React.Fragment key={`a${r.idx[0]}`}>
                          {hasBand && (
                            <Area<number>
                              data={data}
                              x={(i) => px(i)}
                              y0={(i) => y(points[i]!.lo ?? values[i]!)}
                              y1={(i) => y(points[i]!.hi ?? values[i]!)}
                              curve={curveFn}
                              fill={INK}
                              fillOpacity={r.kind === "projected" ? 0.12 : 0.16}
                            />
                          )}
                          {baseline === "zero" && r.kind === "live" && (
                            <AreaClosed<number>
                              data={data}
                              x={(i) => px(i)}
                              y={(i) => py(i)}
                              yScale={y}
                              curve={curveFn}
                              fill={`url(#${id}-fill)`}
                            />
                          )}
                        </React.Fragment>
                      );
                    })}
                  {reference && (
                    <>
                      <Line
                        from={{ x: 0, y: y(reference.value) }}
                        to={{ x: innerW, y: y(reference.value) }}
                        stroke="var(--wash-muted)"
                        strokeWidth={1}
                        strokeDasharray="4 4"
                        strokeOpacity={0.7}
                      />
                      <text
                        x={innerW}
                        y={y(reference.value) - 4}
                        textAnchor="end"
                        fontSize={10}
                        fontWeight={700}
                        fill="var(--wash-muted)"
                      >
                        {reference.label}
                      </text>
                    </>
                  )}
                  {/* The line: solid where measured, dashed where expected or
                      bridged across a hole. */}
                  {strokes.map((r) => (
                    <LinePath<number>
                      key={`l${r.idx[0]}`}
                      data={r.idx}
                      x={(i) => px(i)}
                      y={(i) => py(i)}
                      curve={curveFn}
                      stroke={INK}
                      strokeWidth={r.kind === "live" ? 2.25 : 2}
                      strokeOpacity={r.kind === "bridge" ? 0.5 : 1}
                      strokeDasharray={
                        r.kind === "live" ? undefined : r.kind === "projected" ? "5 4" : "3 3"
                      }
                      strokeLinecap="round"
                    />
                  ))}
                  {/* Where you are. */}
                  {anchor && (
                    <>
                      <Line
                        from={{ x: px(anchor.index), y: -margin.top }}
                        to={{ x: px(anchor.index), y: py(anchor.index) }}
                        stroke={(anchor.tone ?? "now") === "now" ? YELLOW : INK_STRONG}
                        strokeWidth={2}
                        strokeDasharray="1 4"
                        strokeLinecap="round"
                        pointerEvents="none"
                      />
                      <Circle
                        cx={px(anchor.index)}
                        cy={py(anchor.index)}
                        r={5.5}
                        fill={(anchor.tone ?? "now") === "now" ? YELLOW : INK_STRONG}
                        stroke="var(--card)"
                        strokeWidth={2}
                        pointerEvents="none"
                      />
                    </>
                  )}
                  {/* What you're pointing at. */}
                  {sel && selected != null && selected !== anchor?.index && (
                    <>
                      <Line
                        from={{ x: px(selected), y: 0 }}
                        to={{ x: px(selected), y: innerH }}
                        stroke={INK_STRONG}
                        strokeWidth={1.5}
                        strokeDasharray="1 4"
                        strokeOpacity={0.6}
                        strokeLinecap="round"
                        pointerEvents="none"
                      />
                      <Circle
                        cx={px(selected)}
                        cy={py(selected)}
                        r={5}
                        fill={INK_STRONG}
                        stroke="var(--card)"
                        strokeWidth={2}
                        pointerEvents="none"
                      />
                    </>
                  )}
                  <Bar
                    width={innerW}
                    height={innerH}
                    fill="transparent"
                    onMouseMove={pick}
                    onTouchStart={pick}
                    onTouchMove={pick}
                    onClick={pick}
                  />
                </Group>
              </svg>
            );
          }}
        </ChartFrame>

        {/* The pinned figure: dead centre under the pointed-at reading, just
            above the floor — one fixed altitude, never chasing the line. */}
        {sel && selected != null && sel.value != null && (
          <Pill
            tone="value"
            style={floatAtFraction(at(selected)).style}
            className={cn(
              "pointer-events-none absolute bottom-1 z-10",
              floatAtFraction(at(selected)).className,
            )}
          >
            {format(sel.value)}
          </Pill>
        )}
      </div>

      {/* Times along the floor. Positioned by fraction so they land under
          their readings at every width; the ends lean inward. */}
      <div className="relative h-3.5" aria-hidden>
        {(tickValues ?? defaultTicks(t0, t1)).map((t) => {
          const f = (t - t0) / Math.max(1, t1 - t0);
          if (f < -0.001 || f > 1.001) return null;
          const edge = f < 0.06 ? "start" : f > 0.94 ? "end" : "mid";
          return (
            <span
              key={t}
              style={{ left: `${f * 100}%` }}
              className={cn(
                "absolute top-0 text-[10px] leading-[14px] font-bold whitespace-nowrap text-wash-muted",
                edge === "start" ? "" : edge === "end" ? "-translate-x-full" : "-translate-x-1/2",
              )}
            >
              {tickFormat(new Date(t))}
            </span>
          );
        })}
      </div>

      {bracket && (
        <div className="relative h-5" aria-hidden>
          <div
            style={{
              left: `${at(bracket.lo) * 100}%`,
              width: `${Math.max(1, (at(bracket.hi) - at(bracket.lo)) * 100)}%`,
            }}
            className={cn(
              "absolute top-0 flex border-t-2 border-mint-fg pt-1",
              bracket.lo === 0
                ? "justify-start"
                : bracket.hi === n - 1
                  ? "justify-end"
                  : "justify-center",
            )}
          >
            <span className="text-[10px] font-extrabold tracking-[0.06em] whitespace-nowrap text-mint-fg uppercase">
              {bracket.label}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

/** Five labels spread along the span — the caller passes real ones when the
 *  data has natural ticks (each day's noon, every third hour). */
function defaultTicks(t0: number, t1: number): Array<number> {
  return [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(t0 + (t1 - t0) * f));
}

/** Nearest-index helper for callers that describe a point by its time. */
export function indexAt(points: Array<TrendPoint>, t: number): number {
  const idx = bisectT(points, t, 1);
  const a = idx - 1;
  const b = idx;
  if (b >= points.length) return Math.max(0, a);
  if (a < 0) return b;
  return t - points[a]!.t < points[b]!.t - t ? a : b;
}
