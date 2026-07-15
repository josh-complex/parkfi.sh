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

const warmed = new Set<string>();

/**
 * Warm the HTTP cache for an image at low priority so a subsequent `<img>` of
 * the same URL (or `srcSet` candidate) renders instantly. Deduped per session;
 * no-op on the server or for empty input. Pass the *resolved* url/srcSet/sizes
 * (post-Cloudflare) so the warmed bytes match what the real `<img>` will fetch.
 */
export function preloadImage(
  src: string | null | undefined,
  opts: { srcSet?: string; sizes?: string } = {},
): void {
  if (!src || typeof window === "undefined") return;
  const key = opts.srcSet ?? src;
  if (warmed.has(key)) return;
  warmed.add(key);

  const img = new Image();
  img.decoding = "async";
  // Never let a warm compete with paint-critical work.
  img.fetchPriority = "low";
  // srcSet + sizes are evaluated against the viewport (not element box), so the
  // detached image picks the same candidate the real one will — a clean cache hit.
  if (opts.sizes) img.sizes = opts.sizes;
  if (opts.srcSet) img.srcset = opts.srcSet;
  img.src = src;
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
