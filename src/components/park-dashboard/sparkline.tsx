import * as React from "react";

import { cn } from "#/lib/utils.ts";

import { indicativeSeries, strokeRuns } from "./visx/indicative.ts";

/**
 * A tiny inline-SVG trend line for a ride's recent waits. Deliberately not a
 * Recharts chart — the board renders one per row (dozens of rides), and dozens
 * of `ResponsiveContainer`s would tank scroll performance.
 *
 * The line never breaks. Live readings are stroked solid; stretches with no live
 * reading — mid-day downtime gaps or park-closed buckets — are bridged with a
 * dashed stroke over a faint hatch band, so the trend stays glanceable while
 * making clear that span isn't live data. Gaps bridge between their neighbours;
 * closed buckets sink to the baseline (`closed[i]`), so overnight reads as low,
 * not as a phantom mid-range value.
 */
export function Sparkline({
  data,
  closed,
  width = 96,
  height = 28,
  color = "var(--primary)",
  className,
}: {
  data: Array<number | null>;
  /** Parallel flags: true where the park calendar is closed for that bucket. */
  closed?: Array<boolean>;
  width?: number;
  height?: number;
  color?: string;
  className?: string;
}) {
  const hatchId = React.useId();

  const { liveAreas, segments, bands, last } = React.useMemo(() => {
    const live = data.filter((d): d is number => d != null);
    const empty = {
      liveAreas: [] as string[],
      segments: [] as Array<{ bridge: boolean; d: string }>,
      bands: [] as Array<{ x: number; w: number }>,
      last: null as null | { x: number; y: number; live: boolean },
    };
    if (live.length < 2) return empty;

    const baseline = Math.min(...live);
    const { values, kinds, hasLive } = indicativeSeries(
      data.map((value, i) => ({ value, closed: closed?.[i] })),
      baseline,
    );
    if (!hasLive) return empty;

    const min = Math.min(...live);
    const max = Math.max(...live);
    const span = max - min || 1;
    const pad = 2;
    const innerH = height - pad * 2;
    const stepX = data.length > 1 ? width / (data.length - 1) : width;
    const xy = (i: number): [number, number] => [
      i * stepX,
      pad + innerH - ((values[i] - min) / span) * innerH,
    ];

    const runs = strokeRuns(kinds);
    const segments = runs.map((run) => ({
      bridge: run.bridge,
      d:
        "M" +
        run.idx
          .map((i) =>
            xy(i)
              .map((n) => n.toFixed(1))
              .join(","),
          )
          .join("L"),
    }));

    // A soft fill under the live runs only — keeps the eye on real data.
    const liveAreas = runs
      .filter((run) => !run.bridge)
      .map((run) => {
        const pts = run.idx.map(xy);
        return (
          `M${pts[0][0].toFixed(1)},${height} ` +
          pts.map(([x, y]) => `L${x.toFixed(1)},${y.toFixed(1)}`).join(" ") +
          ` L${pts[pts.length - 1][0].toFixed(1)},${height} Z`
        );
      });

    // Hatch bands span each bridged (non-live) run.
    const bands = runs
      .filter((run) => run.bridge)
      .map((run) => {
        const x0 = run.idx[0] * stepX;
        const x1 = run.idx[run.idx.length - 1] * stepX;
        return { x: x0, w: Math.max(1, x1 - x0) };
      });

    const lastIdx = data.length - 1;
    const [lx, ly] = xy(lastIdx);
    return { liveAreas, segments, bands, last: { x: lx, y: ly, live: kinds[lastIdx] === "live" } };
  }, [data, closed, width, height]);

  if (segments.length === 0) {
    return (
      <div
        className={cn("text-muted-foreground/60 text-xs tabular-nums", className)}
        style={{ width, height }}
        aria-hidden
      >
        <span className="flex h-full items-center justify-center">—</span>
      </div>
    );
  }

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={cn("overflow-visible", className)}
      role="img"
      aria-label="Recent wait trend"
      style={{ color }}
    >
      <defs>
        <pattern
          id={hatchId}
          width={5}
          height={5}
          patternUnits="userSpaceOnUse"
          patternTransform="rotate(45)"
        >
          <line
            x1={0}
            y1={0}
            x2={0}
            y2={5}
            stroke="currentColor"
            strokeWidth={0.75}
            strokeOpacity={0.25}
          />
        </pattern>
      </defs>
      {bands.map((b) => (
        <rect key={b.x} x={b.x} y={0} width={b.w} height={height} fill={`url(#${hatchId})`} />
      ))}
      {liveAreas.map((d, i) => (
        <path key={i} d={d} fill="currentColor" fillOpacity={0.12} stroke="none" />
      ))}
      {segments.map((seg, i) => (
        <path
          key={i}
          d={seg.d}
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          strokeOpacity={seg.bridge ? 0.55 : 1}
          strokeDasharray={seg.bridge ? "2.5 2.5" : undefined}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ))}
      {last ? (
        <circle
          cx={last.x}
          cy={last.y}
          r={2}
          fill={last.live ? "currentColor" : "var(--background)"}
          stroke="currentColor"
          strokeWidth={last.live ? 0 : 1.25}
        />
      ) : null}
    </svg>
  );
}
