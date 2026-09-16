"use client";

import * as React from "react";

import { cn } from "#/lib/utils.ts";

/**
 * The scalloped "torn ticket" edge along the bottom of a detail-page hero: a
 * strip of page colour with a row of half-circle bites taken out of the photo
 * above it.
 *
 * Deliberately **one** `<path>` (strip + bumps, `fill-rule: nonzero`) rather
 * than a rect plus a row of circles — two shapes meeting on the same line leave
 * a hairline seam that the photo shows through at fractional device pixels.
 *
 * The width is measured rather than assumed: the bumps must stay circular at
 * every column width, and a fixed `viewBox` stretched with
 * `preserveAspectRatio="none"` would squash them into ellipses. Until the first
 * measurement lands the strip renders at a sane default, so SSR paints a real
 * edge instead of nothing.
 */
export function HeroTear({
  radius = 13,
  step = 30,
  className,
}: {
  /** Bump radius — 13 on a phone, 14 on desktop (as mocked). */
  radius?: number;
  /** Distance between bump centres — 30 on a phone, 34 on desktop. */
  step?: number;
  className?: string;
}) {
  const ref = React.useRef<HTMLDivElement>(null);
  const [width, setWidth] = React.useState(0);

  React.useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const w = entry?.contentRect.width ?? el.getBoundingClientRect().width;
      if (w > 0) setWidth(Math.ceil(w));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const w = width || 390;
  const h = radius + 14;
  // Bump centres at 0, step, 2·step … so the row starts and ends mid-bite,
  // which reads as a continuous tear rather than a scalloped border.
  const bumps = Array.from(
    { length: Math.ceil(w / step) + 1 },
    (_, i) =>
      `M${i * step - radius} ${radius} a${radius} ${radius} 0 1 1 ${2 * radius} 0 a${radius} ${radius} 0 1 1 ${-2 * radius} 0 Z`,
  ).join(" ");

  return (
    <div
      ref={ref}
      aria-hidden
      className={cn("pointer-events-none absolute inset-x-0 -bottom-px", className)}
    >
      <svg
        viewBox={`0 0 ${w} ${h}`}
        width={w}
        height={h}
        preserveAspectRatio="none"
        xmlns="http://www.w3.org/2000/svg"
        className="block h-auto w-full"
      >
        <path
          fillRule="nonzero"
          // The page colour, read from the token so dark mode follows.
          fill="var(--background)"
          d={`M0 ${radius} H${w} V${h} H0 Z ${bumps}`}
        />
      </svg>
    </div>
  );
}
