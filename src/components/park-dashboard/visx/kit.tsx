"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { ParentSize } from "@visx/responsive";

import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "#/components/ui/card.tsx";
import { ChartErrorBoundary } from "#/components/chart-error-boundary.tsx";
import { useIsMobile } from "#/hooks/use-mobile.ts";
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

/** Tick label size to pass on mobile — the 11px desktop default reads too small
 * at phone widths. Callers opt in: `tickLabelProps({...}, MOBILE_TICK)`. */
export const MOBILE_TICK = 12;

/** Standard SVG text props for axis tick labels. `fontSize` defaults to 11 so
 * desktop is untouched; pass `MOBILE_TICK` (12) on narrow screens. */
export const tickLabelProps = (extra?: Record<string, unknown>, fontSize = 11) =>
  ({
    fill: AXIS_INK,
    fontSize,
    fontVariantNumeric: "tabular-nums",
    ...extra,
  }) as const;

/**
 * Tighter horizontal plot margins on narrow screens so charts don't waste width
 * on axis gutters. Returns just the `left`/`right` pair — callers keep their own
 * `top`/`bottom` (which vary with the axis they draw). Desktop values match what
 * the charts hand-rolled before.
 */
export function chartMargin(width: number): { left: number; right: number } {
  const narrow = width < 480;
  return { left: narrow ? 4 : 8, right: narrow ? 26 : 30 };
}

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
  /** Fixed height, or a `{ base, md }` pair to shrink the body below `md`
   * (768px) without a wrapper — e.g. `{ base: 180, md: 220 }`. */
  height: number | { base: number; md: number };
  className?: string;
  children: (dims: { width: number; height: number }) => React.ReactNode;
}) {
  const isMobile = useIsMobile();
  const h = typeof height === "number" ? height : isMobile ? height.base : height.md;
  return (
    <div className={cn("w-full", className)} style={{ height: h }}>
      <ParentSize debounceTime={16} className="!h-full">
        {({ width }) => (width < 8 ? null : children({ width, height: h }))}
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
 * Positions the tooltip card at (x, y), then measures itself in a layout effect
 * and clamps into the viewport — flipping to the pointer's other side and never
 * letting an edge cross the 12px gutter. Correct at any width (the earlier
 * transform-only flip could push a wide card off the left edge on phones).
 */
function TooltipPositioner({
  x,
  y,
  children,
}: {
  x: number;
  y: number;
  children: React.ReactNode;
}) {
  const ref = React.useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = React.useState<{ left: number; top: number }>({ left: x, top: y });

  React.useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const pad = 12;
    const gap = 14;
    // Prefer to the right / below; flip when it would overflow that edge.
    let left = x + gap + w > vw - pad ? x - gap - w : x + gap;
    let top = y + gap + h > vh - pad ? y - gap - h : y + gap;
    left = Math.min(Math.max(pad, left), Math.max(pad, vw - pad - w));
    top = Math.min(Math.max(pad, top), Math.max(pad, vh - pad - h));
    setPos({ left, top });
  }, [x, y, children]);

  return (
    <div
      ref={ref}
      className="pointer-events-none fixed z-50"
      style={{
        left: pos.left,
        top: pos.top,
        width: "max-content",
        maxWidth: "min(16rem, calc(100vw - 24px))",
      }}
    >
      <TooltipCard>{children}</TooltipCard>
    </div>
  );
}

/**
 * A simple, robust chart tooltip. Positions a card at the pointer and renders it
 * through a portal to `document.body`, so it escapes the chart cards'
 * `overflow-hidden` clipping. `show(data, e)` on hover/touch, `hide()` on leave;
 * the `Tooltip` render-prop only runs its children when there's data, so call
 * sites never null-check.
 *
 * Touch pins: a touch `show()` latches the tooltip open (so it survives the
 * synthesized `mouseleave` that would otherwise kill it the instant the finger
 * lifts) and stays until the next tap — on another point it repositions, on
 * empty space it dismisses. Mouse hover is unchanged.
 */
export function useChartTooltip<T>() {
  const [state, setState] = React.useState<{ data: T; x: number; y: number } | null>(null);
  const [pinned, setPinned] = React.useState(false);
  // Whether the active interaction is touch-driven, and a token bumped on every
  // show() so an outside-tap dismissal can tell "a point handled this gesture"
  // (token changed) from "empty space" (unchanged).
  const touchRef = React.useRef(false);
  const showTokenRef = React.useRef(0);

  React.useEffect(() => {
    if (typeof document === "undefined") return;
    const onTouch = () => (touchRef.current = true);
    const onMouse = () => (touchRef.current = false);
    document.addEventListener("touchstart", onTouch, true);
    document.addEventListener("mousemove", onMouse, true);
    return () => {
      document.removeEventListener("touchstart", onTouch, true);
      document.removeEventListener("mousemove", onMouse, true);
    };
  }, []);

  const show = React.useCallback((data: T, e: { clientX: number; clientY: number }) => {
    showTokenRef.current += 1;
    setState({ data, x: e.clientX, y: e.clientY });
    if (touchRef.current) setPinned(true);
  }, []);

  const hide = React.useCallback(() => {
    // Pinned (touch) tooltips ignore hover-out — an outside tap dismisses them.
    if (touchRef.current) return;
    setState(null);
    setPinned(false);
  }, []);

  // Dismiss a pinned tooltip when the viewer taps away from any chart point.
  React.useEffect(() => {
    if (!pinned || typeof document === "undefined") return;
    const onDown = () => {
      const token = showTokenRef.current;
      // Defer so a tap that lands on a chart point (which fires show() and bumps
      // the token) keeps the repositioned tooltip instead of dismissing it.
      setTimeout(() => {
        if (showTokenRef.current === token) {
          setState(null);
          setPinned(false);
        }
      }, 100);
    };
    document.addEventListener("touchstart", onDown);
    document.addEventListener("mousedown", onDown);
    return () => {
      document.removeEventListener("touchstart", onDown);
      document.removeEventListener("mousedown", onDown);
    };
  }, [pinned]);

  const Tooltip = React.useCallback(
    ({ children }: { children: (data: T) => React.ReactNode }) => {
      if (!state || typeof document === "undefined") return null;
      return createPortal(
        <TooltipPositioner x={state.x} y={state.y}>
          {children(state.data)}
        </TooltipPositioner>,
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

/** Standard body height for an analytics chart card. */
export const CHART_H = 220;

/** Short 12h label for an hour-of-day index (0–23): 0 -> "12a", 13 -> "1p". */
export function hourLabel(h: number): string {
  const period = h < 12 ? "a" : "p";
  const base = h % 12 === 0 ? 12 : h % 12;
  return `${base}${period}`;
}

/**
 * Shared "busy" ramp (green → amber → red), so wait intensity reads the same way
 * across every card — the crowd calendar, daily rhythm, treemap, and the
 * per-ride charts. `t` is clamped to 0–1.
 */
export function intensityColor(t: number): string {
  const c = Math.max(0, Math.min(1, t));
  return `hsl(${Math.round(140 - 140 * c)} 72% ${Math.round(52 - 8 * c)}%)`;
}

/**
 * The standard analytics card frame: title + description, an optional header
 * action (e.g. a toggle), and an error-isolated body. A crash in one chart
 * renders the fallback instead of taking down its neighbours, and the
 * `[CHART-CRASH:<title>]` log names the culprit.
 */
export function AnalyticsCard({
  title,
  description,
  action,
  children,
}: {
  title: string;
  description: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Card className="@container/analytics flex flex-col overflow-hidden">
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
        <CardDescription className="truncate">{description}</CardDescription>
        {action ? <CardAction className="self-center">{action}</CardAction> : null}
      </CardHeader>
      <CardContent className="flex min-h-0 flex-1 flex-col px-2 pb-4 sm:px-4">
        <ChartErrorBoundary label={title} fallback={<ChartEmpty label="Chart unavailable." />}>
          {children}
        </ChartErrorBoundary>
      </CardContent>
    </Card>
  );
}
