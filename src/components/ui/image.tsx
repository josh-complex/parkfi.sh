"use client";

import { ImageIcon } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { useCfImagesEnabled } from "#/integrations/posthog/feature-flags.ts";
import { observeForPreload, preloadImage } from "#/lib/image-preload.ts";
import { resolveImageUrls } from "#/lib/image.ts";
import { cn } from "#/lib/utils.ts";

/**
 * Whether `<Image>` should route through Cloudflare: the `cf-images` flag, minus
 * the dev guard (the `/cdn-cgi/image/` path 404s on localhost, so `vp dev`
 * always uses origin URLs regardless of the user-targeted flag). Exported so
 * intent-preload callers resolve the *same* URL the rendered `<Image>` will.
 */
export function useCfImages(): boolean {
  return useCfImagesEnabled() && !import.meta.env.DEV;
}

/**
 * The default placeholder shown when an image is missing or 404s: a muted box
 * with a dimmed icon, sized by the same `className` the `<img>` would get so it
 * occupies the exact same footprint (a hero, a 44px tile, a full-bleed fill).
 * `object-*`/`group-hover:scale-*` utilities are harmless no-ops on the box.
 */
function ImageFallback({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={cn("flex items-center justify-center bg-muted text-muted-foreground", className)}
    >
      <ImageIcon className="size-1/3 max-h-10 max-w-10 opacity-40" />
    </div>
  );
}

type ImageProps = Omit<React.ComponentProps<"img">, "src"> & {
  src: string | null | undefined;
  /**
   * Rendered in place of the image when `src` is missing or fails to load.
   * Omit for a default placeholder box; pass `null` to render nothing at all.
   */
  fallback?: React.ReactNode;
  /** Skip the blur/fade-in (e.g. tiny avatars where the transition is just noise). */
  noFade?: boolean;
  /**
   * Override the `srcSet` width ladder. Only used when `sizes` is set and the
   * `cf-images` flag is on for a remote source; defaults to a tiny-tile-to-hero
   * ladder (see {@link cfImageSrcSet}).
   */
  widths?: readonly number[];
  /**
   * CF AVIF/WebP quality (1–100). Defaults to {@link DEFAULT_IMAGE_QUALITY},
   * which suits list tiles; pass a higher value (~80, past which AVIF bytes
   * balloon with no visible gain) on detail-page heroes that are viewed large.
   * Only applies when the `cf-images` flag is on.
   */
  quality?: number;
  /**
   * Display box ratio (width / height, e.g. `4 / 3` or `1`). On a tile (no
   * `sizes`) with the `cf-images` flag on, makes Cloudflare crop to the box so a
   * mismatched source — a square master in a 4:3 tile — doesn't ship pixels that
   * `object-cover` would discard. Set it to the tile's own `aspect-*` ratio.
   */
  aspect?: number;
};

/**
 * Drop-in `<img>` that fades and de-blurs as the bytes arrive instead of hard
 * popping into place. Pair it with a parent box that reserves space and paints
 * a `bg-muted` (or similar) placeholder so there's something to fade over.
 *
 * Notes for callers:
 * - The fade uses `transition-[opacity,filter,transform]`, so add hover zoom as
 *   a plain `group-hover:scale-*` on `className` — do NOT also pass
 *   `transition-transform`, or Tailwind's last-wins merge drops the fade.
 * - Load state is keyed on `src`, so a changed source (carousel reuse, prop
 *   swap) re-arms the fade rather than flashing the new photo at full opacity.
 */
export function Image({
  src,
  alt = "",
  fallback,
  noFade,
  widths,
  sizes,
  quality,
  aspect,
  loading,
  className,
  onLoad,
  onError,
  ...props
}: ImageProps) {
  const cfImages = useCfImages();
  const ref = useRef<HTMLImageElement>(null);
  // `faded` — revealed via the load event, so it animates in.
  // `instant` — already complete on mount (cached / warm from SSR), so it's
  // shown at rest with NO transition; animating an image that's already there
  // is the jarring part we're trying to avoid.
  const [fadedSrc, setFadedSrc] = useState<string | null>(null);
  const [instantSrc, setInstantSrc] = useState<string | null>(null);
  const [erroredSrc, setErroredSrc] = useState<string | null>(null);
  // `armed` — enables the transition after the first paint. Instant images skip
  // the transition on their initial (resting) render so they don't animate into
  // place; arming it a frame later lets a later change — notably a caller's
  // `group-hover:scale-*` zoom — still transition instead of snapping.
  const [armed, setArmed] = useState(false);
  useEffect(() => setArmed(true), []);

  // A cached image can finish decoding before React attaches its `onLoad`
  // handler — notably right after SSR hydration. Reconcile against the DOM
  // before the next paint so a warm image resolves to its resting state without
  // ever flashing through (and animating) the fade.
  useLayoutEffect(() => {
    const img = ref.current;
    if (!img || !src) return;
    if (img.complete && img.currentSrc) {
      if (img.naturalWidth > 0) setInstantSrc(src);
      else setErroredSrc(src);
    }
  }, [src]);

  const instant = instantSrc === src;
  const loaded = instant || fadedSrc === src;

  // Resolve the URLs the <img> will request. Computed above the early return so
  // the preload effect below reuses the exact same ones (a warm only helps if it
  // matches what the <img> fetches). `resolveImageUrls` no-ops on local/`data:`
  // sources and when CF is off.
  const { src: resolvedSrc, srcSet: resolvedSrcSet } = src
    ? resolveImageUrls(src, { cf: cfImages, sizes, quality, widths, aspect })
    : { src, srcSet: undefined };

  // Scroll-preload: warm a lazy tile ~600px before it enters view, at low
  // priority, so it's cached (no pop-in) by the time it's revealed. Deliberately
  // non-blocking — a post-paint effect on an already-rendered element, gated to
  // `loading="lazy"` (eager heroes fetch immediately and need no warming) and to
  // images not already shown, so it never competes with paint-needed work.
  useEffect(() => {
    const el = ref.current;
    if (!el || !resolvedSrc || loaded || loading !== "lazy") return;
    return observeForPreload(el, () =>
      preloadImage(resolvedSrc, { srcSet: resolvedSrcSet, sizes }),
    );
  }, [resolvedSrc, resolvedSrcSet, sizes, loaded, loading]);

  if (!src || erroredSrc === src) {
    // `undefined` (prop omitted) → default placeholder; an explicit `null` (or
    // any node) is respected as-is, so callers can still opt out of a box.
    return fallback === undefined ? <ImageFallback className={className} /> : <>{fallback}</>;
  }

  return (
    <img
      ref={ref}
      src={resolvedSrc ?? undefined}
      loading={loading}
      srcSet={resolvedSrcSet}
      sizes={sizes}
      alt={alt}
      decoding="async"
      onLoad={(e) => {
        setFadedSrc(src);
        onLoad?.(e);
      }}
      onError={(e) => {
        setErroredSrc(src);
        onError?.(e);
      }}
      className={cn(
        // No transition on the instant path's first paint, so a cached image
        // just appears; re-armed a frame later so hover zoom still transitions.
        // `scale` (not `transform`) is the property Tailwind v4 animates for
        // `scale-*` utilities — including a caller's `group-hover:scale-*` — so
        // it must be in the list or the zoom snaps instead of transitioning.
        !noFade &&
          (!instant || armed) &&
          "transition-[opacity,filter,scale] duration-500 ease-out motion-reduce:transition-none",
        !noFade && (loaded ? "scale-100 opacity-100 blur-0" : "scale-105 opacity-0 blur-md"),
        className,
      )}
      {...props}
    />
  );
}
