"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { ParentSize } from "@visx/responsive";

import { cn } from "#/lib/utils.ts";

/**
 * Shared visx building blocks for the park-dashboard charts.
 *
 * We moved off recharts after a minified `r is not a function` throw in the
 * analytics bundle aborted React's commit and bricked the whole park page in
 * production. visx is a thin set of d3-backed SVG primitives with no global
 * render pipeline, so a bad data path renders a quiet empty state instead of
 * taking down its neighbours — and it tree-shakes far better.
 */

// Axis / grid ink. CSS vars resolve in SVG `fill`/`stroke`, so the charts track
// the active theme without a JS theme lookup.
export const AXIS_INK = "var(--muted-foreground)";
export const GRID_INK = "var(--border)";
export const PRIMARY = "var(--primary)";

/** Standard SVG text props for axis tick labels. */
export const tickLabelProps = (extra?: Record<string, unknown>) =>
  ({
    fill: AXIS_INK,
    fontSize: 11,
    fontVariantNumeric: "tabular-nums",
    ...extra,
  }) as const;

/**
 * Width-measuring frame. The caller fixes the height (charts live in
 * fixed-height cards) and gets a measured width to draw against. Renders nothing
 * until it has a real width so scales never see a 0/NaN domain.
 */
export function ChartFrame({
  height,
  className,
  children,
}: {
  height: number;
  className?: string;
  children: (dims: { width: number; height: number }) => React.ReactNode;
}) {
  return (
    <div className={cn("w-full", className)} style={{ height }}>
      <ParentSize debounceTime={16} className="!h-full">
        {({ width }) => (width < 8 ? null : children({ width, height }))}
      </ParentSize>
    </div>
  );
}

/** The popover-styled surface used for every chart tooltip. */
export function TooltipCard({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "pointer-events-none rounded-xl bg-popover px-2.5 py-1.5 text-xs text-popover-foreground shadow-lg ring-1 ring-foreground/5 dark:ring-foreground/10",
        className,
      )}
    >
      {children}
    </div>
  );
}

/** Pull viewport (client) coordinates off a mouse or touch event. */
export function clientXY(e: React.MouseEvent | React.TouchEvent): {
  clientX: number;
  clientY: number;
} {
  if ("touches" in e) {
    const t = e.touches[0] ?? e.changedTouches[0];
    return { clientX: t?.clientX ?? 0, clientY: t?.clientY ?? 0 };
  }
  return { clientX: e.clientX, clientY: e.clientY };
}

/**
 * A simple, robust chart tooltip. Positions a `fixed` card at the pointer and
 * renders it through a portal to `document.body`, so it escapes the chart cards'
 * `overflow-hidden` clipping (the reason the earlier in-container portal didn't
 * show). `show(data, e)` on hover, `hide()` on leave; the `Tooltip` render-prop
 * only runs its children when there's data, so call sites never null-check.
 */
export function useChartTooltip<T>() {
  const [state, setState] = React.useState<{ data: T; x: number; y: number } | null>(null);

  const show = React.useCallback(
    (data: T, e: { clientX: number; clientY: number }) =>
      setState({ data, x: e.clientX, y: e.clientY }),
    [],
  );
  const hide = React.useCallback(() => setState(null), []);

  const Tooltip = React.useCallback(
    ({ children }: { children: (data: T) => React.ReactNode }) => {
      if (!state || typeof document === "undefined") return null;
      // Flip toward the inside near the viewport edges so the card stays on-screen.
      const flipX = state.x > window.innerWidth - 240;
      const flipY = state.y > window.innerHeight - 160;
      return createPortal(
        <div
          className="pointer-events-none fixed z-50"
          style={{
            left: state.x,
            top: state.y,
            // Size to content (capped), not to the space left of the viewport edge.
            // Without this, a `fixed` box with only `left` set shrink-to-fits the
            // remaining width, so the card narrows the further right the pointer is.
            width: "max-content",
            maxWidth: "16rem",
            transform: `translate(${flipX ? "calc(-100% - 14px)" : "14px"}, ${
              flipY ? "calc(-100% - 14px)" : "14px"
            })`,
          }}
        >
          <TooltipCard>{children(state.data)}</TooltipCard>
        </div>,
        document.body,
      );
    },
    [state],
  );

  return { data: state?.data ?? null, show, hide, Tooltip };
}

/** Shared empty / thin-data state sized to match a chart body. */
export function ChartEmpty({ label, height = 220 }: { label: string; height?: number }) {
  return (
    <div
      className="flex items-center justify-center px-6 text-center text-sm text-muted-foreground"
      style={{ height }}
    >
      {label}
    </div>
  );
}

/**
 * Empty state for character cards at parks that simply have no characters to
 * chart — the lost-map mascot plus friendly copy, rather than a terse
 * "no data" line that reads like a bug.
 */
export function ChartNoCharacters({ height = 220 }: { height?: number }) {
  return (
    <div
      className="flex flex-col items-center justify-center gap-1 px-6 text-center"
      style={{ height }}
    >
      <img
        src="/img/oops-map.png"
        alt=""
        aria-hidden
        className="-my-6 w-full max-w-[200px] select-none"
      />
      <p className="text-sm text-muted-foreground">
        It doesn&rsquo;t look like any characters roam around this park.
      </p>
    </div>
  );
}

/** Truncate a string to roughly `max` chars with an ellipsis. */
export function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, Math.max(1, max - 1))}…` : s;
}
