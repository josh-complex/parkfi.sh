"use client";

import { ImageIcon } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { useCfImagesEnabled } from "#/integrations/posthog/feature-flags.ts";
import { cfImageSrcSet, cfImageUrl } from "#/lib/image.ts";
import { cn } from "#/lib/utils.ts";

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
   * which suits list tiles; pass a higher value (~88–90) on detail-page heroes
   * that are viewed large. Only applies when the `cf-images` flag is on.
   */
  quality?: number;
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
  className,
  onLoad,
  onError,
  ...props
}: ImageProps) {
  // Cloudflare's `/cdn-cgi/image/` transforms only exist behind CF's edge, so on
  // localhost the path 404s. Gate on the dev flag so `vp dev` always serves
  // origin URLs regardless of the (user-targeted) `cf-images` flag, which would
  // otherwise follow your account into local dev and break every image.
  const cfImages = useCfImagesEnabled() && !import.meta.env.DEV;
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

  if (!src || erroredSrc === src) {
    // `undefined` (prop omitted) → default placeholder; an explicit `null` (or
    // any node) is respected as-is, so callers can still opt out of a box.
    return fallback === undefined ? <ImageFallback className={className} /> : <>{fallback}</>;
  }

  const instant = instantSrc === src;
  const loaded = instant || fadedSrc === src;

  // Route remote images through Cloudflare when enabled: a width-descriptor
  // `srcSet` (+ a mid-size `src` fallback) when the caller declared `sizes`, or
  // an at-source-size re-encode (AVIF/WebP, our cache) otherwise. `cfImageUrl`
  // no-ops on local/`data:` sources, so both paths are safe to apply blindly.
  const resolvedSrc = cfImages ? cfImageUrl(src, { quality, width: sizes ? 640 : undefined }) : src;
  const resolvedSrcSet = cfImages && sizes ? cfImageSrcSet(src, widths, { quality }) : undefined;

  return (
    <img
      ref={ref}
      src={resolvedSrc}
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
