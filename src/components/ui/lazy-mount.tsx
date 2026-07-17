import * as React from "react";
import { isServer } from "@tanstack/react-query";

// Flips after the first client commit that contains a LazyMount. The render
// pass that hydrates a server-rendered document must mount children eagerly —
// the SSR'd HTML carries SEO content and hydration would otherwise mismatch —
// so deferral only kicks in for renders after that first commit, i.e. client-
// side navigations. (On the native SPA build there's no SSR; the boot page
// mounts eagerly once and every navigation after that defers.)
let appCommitted = false;

// Idle-reveal queue: deferred sections also mount one at a time shortly after
// navigation, top-down, without waiting to be scrolled to — so the page below
// the fold fills in behind its skeletons instead of sitting empty until the
// IntersectionObserver fires. One reveal per callback keeps each commit small;
// scrolling still wins because the observer reveals a section the moment it
// comes near, regardless of its queue position.
const revealQueue: Array<() => void> = [];
let draining = false;

function scheduleStep(fn: () => void) {
  // WebKit has no requestIdleCallback; a spaced timeout leaves paint/input a
  // window between mounts either way.
  if (typeof requestIdleCallback === "function") requestIdleCallback(fn, { timeout: 500 });
  else setTimeout(fn, 120);
}

function drainQueue() {
  if (draining) return;
  draining = true;
  const step = () => {
    revealQueue.shift()?.();
    if (revealQueue.length > 0) scheduleStep(step);
    else draining = false;
  };
  scheduleStep(step);
}

/**
 * Defers mounting `children` until the section scrolls near the viewport or
 * its turn comes up in the idle-reveal queue, then keeps them mounted. Use it
 * around below-fold sections (shelves, park groups) so navigating to a page
 * commits only what's visible instead of every card on the page in one
 * synchronous render. Pass a `fallback` skeleton so the reserved space reads
 * as loading rather than flashing empty.
 */
export function LazyMount({
  estimatedHeight,
  rootMargin = "800px 0px",
  className,
  fallback,
  children,
}: {
  /**
   * Placeholder height in px, roughly the section's mounted size — close is
   * good enough; it only has to keep the scrollbar from jumping while sections
   * stream in ahead of the viewport.
   */
  estimatedHeight: number;
  rootMargin?: string;
  className?: string;
  /** Skeleton shown inside the reserved space until the section mounts. */
  fallback?: React.ReactNode;
  children: React.ReactNode;
}) {
  const ref = React.useRef<HTMLDivElement>(null);
  const [shown, setShown] = React.useState(() => isServer || !appCommitted);

  React.useEffect(() => {
    appCommitted = true;
    if (shown) return;
    const el = ref.current;
    if (!el) return;
    const reveal = () => setShown(true);
    revealQueue.push(reveal);
    drainQueue();
    const obs = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) reveal();
      },
      { rootMargin },
    );
    obs.observe(el);
    return () => {
      obs.disconnect();
      const i = revealQueue.indexOf(reveal);
      if (i >= 0) revealQueue.splice(i, 1);
    };
  }, [shown, rootMargin]);

  if (shown) return <>{children}</>;
  return (
    <div ref={ref} aria-hidden style={{ minHeight: estimatedHeight }} className={className}>
      {fallback}
    </div>
  );
}
