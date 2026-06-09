import * as React from "react";

import { cn } from "#/lib/utils.ts";

/**
 * A tiny inline-SVG trend line for a ride's recent waits. Deliberately not a
 * Recharts chart — the board renders one per row (dozens of rides), and dozens
 * of `ResponsiveContainer`s would tank scroll performance. Nulls (gaps in the
 * data) split the line into segments rather than drawing through them.
 */
export function Sparkline({
  data,
  width = 96,
  height = 28,
  color = "var(--primary)",
  className,
}: {
  data: Array<number | null>;
  width?: number;
  height?: number;
  color?: string;
  className?: string;
}) {
  const { line, area, last } = React.useMemo(() => {
    const nums = data.filter((d): d is number => d != null);
    if (nums.length < 2) return { line: "", area: "", last: null as null | [number, number] };

    const min = Math.min(...nums);
    const max = Math.max(...nums);
    const span = max - min || 1;
    const pad = 2;
    const innerH = height - pad * 2;
    const stepX = data.length > 1 ? width / (data.length - 1) : width;

    const xy = (v: number, i: number): [number, number] => [
      i * stepX,
      pad + innerH - ((v - min) / span) * innerH,
    ];

    // Build line segments, breaking on nulls so gaps aren't bridged.
    const segments: Array<Array<[number, number]>> = [];
    let current: Array<[number, number]> = [];
    data.forEach((v, i) => {
      if (v == null) {
        if (current.length) segments.push(current);
        current = [];
      } else {
        current.push(xy(v, i));
      }
    });
    if (current.length) segments.push(current);

    const line = segments
      .map((seg) => "M" + seg.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join("L"))
      .join(" ");

    // A filled area under the longest segment gives the chart a little body.
    const longest = segments.reduce((a, b) => (b.length > a.length ? b : a), segments[0] ?? []);
    const area =
      longest.length > 1
        ? `M${longest[0][0].toFixed(1)},${height} ` +
          longest.map(([x, y]) => `L${x.toFixed(1)},${y.toFixed(1)}`).join(" ") +
          ` L${longest[longest.length - 1][0].toFixed(1)},${height} Z`
        : "";

    const lastNum = [...data].reverse().findIndex((d) => d != null);
    const lastIdx = lastNum === -1 ? -1 : data.length - 1 - lastNum;
    const last = lastIdx === -1 ? null : xy(data[lastIdx] as number, lastIdx);

    return { line, area, last };
  }, [data, width, height]);

  if (!line) {
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
      {area ? <path d={area} fill="currentColor" fillOpacity={0.12} stroke="none" /> : null}
      <path
        d={line}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {last ? <circle cx={last[0]} cy={last[1]} r={2} fill="currentColor" /> : null}
    </svg>
  );
}
