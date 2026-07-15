/**
 * Low-priority image warming — the "preload" layer that sits *beside* rendering,
 * never in front of it.
 *
 * Everything here is deliberately non-blocking and progressive:
 *  - warms fetch at `fetchpriority="low"`, so they yield to the LCP hero, fonts,
 *    scripts and any `loading="eager"` above-the-fold image;
 *  - the shared IntersectionObserver only fires as a target nears the viewport,
 *    so nothing is warmed until the user is plausibly about to reach it;
 *  - callers invoke this from effects (post-paint) and on intent (hover/focus),
 *    never during the render that produces paint-needed markup.
 *
 * A later `<img>` for the same URL is a cache hit → it appears without the
 * network round-trip that causes pop-in. All no-ops on the server.
 */
import { readDataSaver } from "#/lib/connection.ts";

const warmed = new Set<string>();

/**
 * Concurrency gate. `fetchPriority="low"` orders requests but doesn't cap how
 * many run at once — on a content-heavy board the wide preload horizon can
 * kick off dozens of warms in one scroll, and on a narrow pipe (park LTE)
 * those in-flight bytes saturate the connection and the image the user is
 * *looking at* queues behind them. Cap the warms instead: a few in flight,
 * the rest FIFO. On any healthy connection the queue still stays ahead of the
 * user's thumb; on a slow one, visible images always find bandwidth headroom.
 */
const MAX_INFLIGHT = 4;
/** Safety valve: a warm whose load/error event never fires (rare — e.g. the
 *  request dies without an error event) frees its slot after this long. */
const WARM_TIMEOUT_MS = 30_000;
let inflight = 0;
const queue: Array<() => void> = [];

function pump(): void {
  while (inflight < MAX_INFLIGHT && queue.length > 0) queue.shift()!();
}

function startWarm(src: string, opts: { srcSet?: string; sizes?: string }): void {
  inflight++;
  let settled = false;
  const done = () => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    inflight--;
    pump();
  };
  const timer = setTimeout(done, WARM_TIMEOUT_MS);
  const img = new Image();
  img.onload = done;
  img.onerror = done;
  img.decoding = "async";
  // Never let a warm compete with paint-critical work.
  img.fetchPriority = "low";
  // srcSet + sizes are evaluated against the viewport (not element box), so the
  // detached image picks the same candidate the real one will — a clean cache hit.
  if (opts.sizes) img.sizes = opts.sizes;
  if (opts.srcSet) img.srcset = opts.srcSet;
  img.src = src;
}

/**
 * Warm the HTTP cache for an image at low priority so a subsequent `<img>` of
 * the same URL (or `srcSet` candidate) renders instantly. Deduped per session
 * and gated to {@link MAX_INFLIGHT} concurrent fetches; no-op on the server,
 * for empty input, or on a constrained connection (Save-Data / 2g / 3g —
 * speculative bytes are exactly what that user asked us not to spend). Pass
 * the *resolved* url/srcSet/sizes (post-Cloudflare) so the warmed bytes match
 * what the real `<img>` will fetch.
 */
export function preloadImage(
  src: string | null | undefined,
  opts: { srcSet?: string; sizes?: string } = {},
): void {
  if (!src || typeof window === "undefined") return;
  if (readDataSaver()) return;
  const key = opts.srcSet ?? src;
  if (warmed.has(key)) return;
  warmed.add(key);
  queue.push(() => startWarm(src, opts));
  pump();
}

type WarmFn = () => void;

const targets = new WeakMap<Element, WarmFn>();
let observer: IntersectionObserver | null = null;

function getObserver(): IntersectionObserver | null {
  if (typeof window === "undefined" || typeof IntersectionObserver === "undefined") return null;
  observer ??= new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const warm = targets.get(entry.target);
        observer?.unobserve(entry.target);
        targets.delete(entry.target);
        warm?.();
      }
    },
    // Warm 150% of the viewport ahead of the element — earlier than we can ask
    // native lazy-loading for, and reliable for horizontal carousels where
    // native lazy is not. A percentage (not px) so phones get ~1.5 screens of
    // headroom in *both* axes: a fast flick downward and the next few carousel
    // cards sideways are already warm when they arrive. (The old 600px was
    // under one mobile screen — decisive scrolls outran it, landing on blanks.)
    { rootMargin: "150%" },
  );
  return observer;
}

/**
 * Fire `warm` once, when `el` comes within ~600px of the viewport, via a single
 * shared observer. Returns a cleanup fn (safe to call after it has fired).
 * No-op / no observer on the server.
 */
export function observeForPreload(el: Element, warm: WarmFn): () => void {
  const io = getObserver();
  if (!io) return () => {};
  targets.set(el, warm);
  io.observe(el);
  return () => {
    io.unobserve(el);
    targets.delete(el);
  };
}
