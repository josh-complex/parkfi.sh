import * as React from "react";

const useIsoLayoutEffect =
  typeof document !== "undefined" ? React.useLayoutEffect : React.useEffect;

/**
 * Flips after the first client commit. The render that hydrates a server-
 * rendered document has to produce the *whole* list — the SSR'd HTML carries
 * every attraction name and link for crawlers, and hydration would mismatch if
 * the client rendered a window of it instead. So a full-list render happens
 * once, the layout effect below swaps the window in immediately after, and
 * every later mount (a client-side navigation) starts windowed.
 */
let appCommitted = false;

/**
 * True once this component may replace a full list with a virtual window.
 * `false` on the server and on the hydration render; `true` from the first
 * layout effect onward.
 */
function useWindowed(): boolean {
  const [windowed, setWindowed] = React.useState(
    () => typeof document !== "undefined" && appCommitted,
  );
  useIsoLayoutEffect(() => {
    appCommitted = true;
    if (!windowed) setWindowed(true);
  }, [windowed]);
  return windowed;
}

export interface WindowRange {
  /** Attach to the element whose first child is row 0. */
  ref: React.RefObject<HTMLElement | null>;
  /** First row index to render. */
  start: number;
  /** One past the last row index to render. */
  end: number;
  /** Height the whole list occupies, rows outside the window included. */
  totalSize: number;
  /** Distance from the top of the list to row `start`. */
  offsetTop: number;
  /** False for exactly one render (SSR and hydration): render the full list. */
  ready: boolean;
}

/**
 * Windowing for a uniform-height list that scrolls with the document.
 *
 * Deliberately arithmetic rather than a virtualizer. Every row here is the same
 * height by construction — a tile is art of a fixed ratio under a one-line
 * title, a table row is a fixed-size thumbnail in cells that never wrap — which
 * means the window is one subtraction and two divisions off the container's
 * position, recomputed from the live DOM on every scroll.
 *
 * A general virtualizer solves a harder problem: rows of unknown, changing
 * height, which forces it to cache measurements, cache the viewport rect, and
 * keep a separate `scrollMargin` for where the list sits in the document. Each
 * of those caches is a copy of something the DOM already knows, and a windowed
 * list renders blank the moment any copy goes stale — the window is drawn for a
 * part of the page you are not looking at. With uniform rows none of that
 * machinery buys anything, so none of it is here, and there is no cached
 * geometry left to go stale.
 */
export function useWindowList({
  count,
  rowHeight,
  overscan = 3,
}: {
  count: number;
  /** Every row's height, including whatever gap separates it from the next. */
  rowHeight: number;
  overscan?: number;
}): WindowRange {
  const ref = React.useRef<HTMLElement | null>(null);
  const windowed = useWindowed();
  const [range, setRange] = React.useState({ start: 0, end: 0 });

  useIsoLayoutEffect(() => {
    if (!windowed) return;
    const el = ref.current;
    if (!el) return;
    let frame = 0;

    const measure = () => {
      const height = Math.max(1, rowHeight);
      // Viewport-relative, straight from layout. Positive while the list still
      // starts below the fold, negative once it runs off the top.
      const top = el.getBoundingClientRect().top;
      const scrolledPast = Math.max(0, -top);
      const first = Math.floor(scrolledPast / height);
      // The whole viewport's worth, not the part of it below `top`. Costs a
      // row or two of extra DOM and removes an off-by-one at the boundary.
      const fits = Math.ceil(window.innerHeight / height);
      const start = Math.max(0, first - overscan);
      const end = Math.min(count, first + fits + overscan + 1);
      setRange((prev) => (prev.start === start && prev.end === end ? prev : { start, end }));
    };

    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    };

    measure();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    // Anything above the list changing height moves it without a scroll event:
    // filter chips appearing, a skeleton resolving, an image finally sizing.
    const ro = new ResizeObserver(schedule);
    ro.observe(el);
    ro.observe(document.body);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      ro.disconnect();
    };
  }, [windowed, count, rowHeight, overscan]);

  const start = windowed ? Math.min(range.start, Math.max(0, count - 1)) : 0;
  const end = windowed ? Math.min(range.end, count) : count;
  return {
    ref,
    start,
    end,
    totalSize: count * rowHeight,
    offsetTop: start * rowHeight,
    ready: windowed,
  };
}

/**
 * One row's real height, measured from a mounted row and then used for *every*
 * row — including the ones nobody has scrolled to.
 *
 * Both lists on this page are uniform, so there is nothing per-row to measure,
 * and measuring per row would be actively harmful: an estimate that is wrong by
 * even 20px is wrong by 20px × 200 rows of reserved space, and every row that
 * got measured would claw a little of that back underneath the reader. The page
 * would shorten as you scroll and the rows you were reading would slide up out
 * from under you.
 *
 * Attach the returned callback to every row; it adopts the first one it sees
 * and holds it until that row scrolls away, then adopts the next.
 */
export function useRowHeight(
  fallback: number,
): [height: number, measure: (el: HTMLElement | null) => void] {
  const [height, setHeight] = React.useState(fallback);
  const measured = React.useRef(false);
  const observed = React.useRef<HTMLElement | null>(null);
  const observer = React.useRef<ResizeObserver | null>(null);

  const measure = React.useCallback((el: HTMLElement | null) => {
    if (el == null) return;
    const held = observed.current;
    // Keep the row already being watched until it leaves the DOM; re-latching
    // onto whichever row mounted most recently would mean a layout read on
    // every row of every scroll.
    if (held != null && held !== el && held.isConnected) return;
    observed.current = el;
    observer.current?.disconnect();
    const read = () => {
      const next = el.getBoundingClientRect().height;
      if (next <= 0) return;
      measured.current = true;
      setHeight((prev) => (Math.abs(prev - next) > 0.5 ? next : prev));
    };
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    observer.current = ro;
  }, []);

  React.useEffect(() => () => observer.current?.disconnect(), []);
  // Until a real row has been seen, track the caller's arithmetic — it is the
  // better guess, and on the tiles it changes with the container's width.
  useIsoLayoutEffect(() => {
    if (!measured.current) setHeight(fallback);
  }, [fallback]);

  return [height, measure];
}

/** The viewport width, for picking a column count or a row height in JS. */
export function useViewportWidth(fallback = 1280): number {
  const [width, setWidth] = React.useState(() =>
    typeof window === "undefined" ? fallback : window.innerWidth,
  );
  useIsoLayoutEffect(() => {
    const read = () => setWidth(window.innerWidth);
    read();
    window.addEventListener("resize", read);
    return () => window.removeEventListener("resize", read);
  }, []);
  return width;
}

/** An element's content width, for sizing rows from the space they actually get. */
export function useElementWidth(ref: React.RefObject<HTMLElement | null>, fallback = 0): number {
  const [width, setWidth] = React.useState(fallback);
  useIsoLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const read = () => setWidth(el.getBoundingClientRect().width);
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return width;
}
