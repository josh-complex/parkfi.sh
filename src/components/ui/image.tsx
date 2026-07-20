"use client";

import { ImageIcon } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { thumbHashToDataURL } from "thumbhash";

import { useCfImagesEnabled } from "#/integrations/posthog/feature-flags.ts";
import { readDataSaver, subscribeConnection } from "#/lib/connection.ts";
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
 * True on a constrained connection (see `readDataSaver` in lib/connection.ts):
 * the user opted into data saving (Save-Data), or the network's effective type
 * is 2g/3g — the congested in-park LTE case. `<Image>` (and intent-preload
 * callers, which must resolve the *same* URL) trade image quality down ~20%
 * for roughly 30% fewer bytes, and speculative preloading stops entirely
 * (`preloadImage` checks the same reader). Live-updates on network changes
 * (wifi → cell); always false during SSR, so a constrained client re-resolves
 * after hydration.
 */
export function useDataSaver(): boolean {
  return useSyncExternalStore(subscribeConnection, readDataSaver, () => false);
}

/**
 * base64 ThumbHash → PNG data URL, memoized per hash. Boards repeat hashes
 * across renders/virtual rows, and decoding is pure JS (no canvas), so this is
 * SSR-safe — the placeholder is painted in the server HTML, before any JS.
 * Malformed hashes decode to `null` once and render as no placeholder.
 */
const thumbhashCache = new Map<string, string | null>();
export function thumbhashToUrl(hash: string | null | undefined): string | undefined {
  if (!hash) return undefined;
  let url = thumbhashCache.get(hash);
  if (url === undefined) {
    try {
      url = thumbHashToDataURL(Uint8Array.from(atob(hash), (c) => c.charCodeAt(0)));
    } catch {
      url = null;
    }
    thumbhashCache.set(hash, url);
  }
  return url ?? undefined;
}

/**
 * Split a caller's `className` for the ThumbHash wrapper path: `object-*`
 * utilities (any variant, e.g. `sm:object-contain`) belong to the inner
 * `<img>` — they control how the photo fills its box — while everything else
 * (sizing, rounding, borders, hover zoom) describes the box itself and moves
 * to the wrapper.
 */
function splitObjectClasses(className: string | undefined): {
  box: string | undefined;
  fit: string | undefined;
} {
  if (!className || !/(^|[\s:])object-/.test(className)) return { box: className, fit: undefined };
  const parts = className.split(/\s+/).filter(Boolean);
  const isFit = (c: string) => /(^|:)object-/.test(c);
  return {
    box: parts.filter((c) => !isFit(c)).join(" "),
    fit: parts.filter(isFit).join(" "),
  };
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
   * Display box ratio (width / height, e.g. `4 / 3` or `1`). With the
   * `cf-images` flag on, makes Cloudflare crop to the box so a mismatched
   * source — a square master in a 4:3 tile, a 16:9 hero in a short banner —
   * doesn't ship pixels that `object-cover` would discard. Works on both the
   * tile path and the `sizes`/srcSet path (each rung gets a matching height).
   * Only pass a ratio the box holds at every viewport: for a fixed-height,
   * fluid-width hero, use the *narrowest* (tallest) ratio the layout reaches.
   */
  aspect?: number;
  /**
   * The display box's CSS width in px, for small fixed-size thumbs (e.g. `44`
   * for a `size-11` avatar). Caps the CF request at `boxWidth × 3` instead of
   * the tile-wide {@link DEFAULT_TILE_WIDTH} default — a 44px thumb drops from
   * ~21 kB to ~3 kB. Ignored when `sizes` is set.
   */
  boxWidth?: number;
  /**
   * base64 ThumbHash of the image (e.g. `attraction_meta.image_thumbhash`).
   * Painted instantly — including in SSR HTML — as a blurry, color-accurate
   * preview behind the loading image, so the tile is never a blank box; the
   * real photo cross-fades in over it, and on error the normal fallback
   * replaces it.
   *
   * Layout contract: with a placeholder (and the fade on), `<Image>` renders a
   * wrapper `<span>` that takes the caller's box classes — `className` (and
   * `style`) must size the box, which is already true anywhere a placeholder
   * makes sense: the hash needs a reserved box to paint into before the photo
   * exists. `object-*` utilities are forwarded to the inner `<img>`.
   */
  placeholder?: string | null;
};

/**
 * Drop-in `<img>` that fades and de-blurs as the bytes arrive instead of hard
 * popping into place. Pair it with a parent box that reserves space and paints
 * a `bg-muted` (or similar) placeholder so there's something to fade over —
 * or pass a ThumbHash `placeholder`, which paints a color-accurate preview the
 * photo cross-fades in over (see the `placeholder` prop for its layout
 * contract: the box classes move to a wrapper `<span>`).
 *
 * Notes for callers:
 * - The fade uses `transition-[opacity,filter,scale]`, so add hover zoom as
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
  boxWidth,
  placeholder,
  loading,
  className,
  style,
  onLoad,
  onError,
  ...props
}: ImageProps) {
  const cfImages = useCfImages();
  const dataSaver = useDataSaver();
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

  // `settled` — the fade-in has finished, so the ThumbHash underlay can be
  // dropped (keeping transparent sources honest). Timer-based (600ms, just past
  // the 500ms transition) rather than `transitionend` so motion-reduce and
  // interrupted transitions still settle. Reset whenever `src` changes so a
  // reused element re-arms its underlay.
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    setSettled(false);
    if (!loaded) return;
    const t = setTimeout(() => setSettled(true), 600);
    return () => clearTimeout(t);
  }, [loaded, src]);

  // Resolve the URLs the <img> will request. Computed above the early return so
  // the preload effect below reuses the exact same ones (a warm only helps if it
  // matches what the <img> fetches). `resolveImageUrls` no-ops on local/`data:`
  // sources and when CF is off.
  const { src: resolvedSrc, srcSet: resolvedSrcSet } = src
    ? resolveImageUrls(src, { cf: cfImages, sizes, quality, widths, aspect, boxWidth, dataSaver })
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

  // ThumbHash underlay. A true cross-fade needs two layers — animating the
  // <img>'s own opacity would take an element-background placeholder down with
  // it — so with a hash (and the fade on) the component renders a wrapper
  // <span> that paints the hash as its background while the photo runs the
  // normal fade on top. The wrapper takes the caller's box classes (sizing,
  // rounding, hover zoom — see the `placeholder` prop's layout contract);
  // `object-*` utilities forward to the inner <img>, which fills the wrapper
  // absolutely. SSR still paints the hash pre-JS, and `overflow-hidden` clips
  // the fade's blur/scale bleed. With `noFade` the hash stays where it was
  // before: the bare <img>'s own background while loading.
  const placeholderUrl = thumbhashToUrl(placeholder);
  const underlay = placeholderUrl !== undefined && !noFade;
  // Keep the underlay painted until the fade finishes, then drop it to keep
  // transparent sources honest. Instant images never fade, so theirs drops on
  // the first client paint.
  const showUnderlay = !loaded || (!instant && !settled);
  const { box, fit } = underlay
    ? splitObjectClasses(className)
    : { box: className, fit: undefined };

  const image = (
    <img
      ref={ref}
      src={resolvedSrc ?? undefined}
      loading={loading}
      srcSet={resolvedSrcSet}
      sizes={sizes}
      alt={alt}
      style={
        !underlay && placeholderUrl && !loaded
          ? {
              backgroundImage: `url(${placeholderUrl})`,
              backgroundSize: "cover",
              backgroundPosition: "center",
              ...style,
            }
          : underlay
            ? undefined
            : style
      }
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
        underlay ? cn("absolute inset-0 size-full", fit) : box,
      )}
      {...props}
    />
  );

  if (!underlay) return image;

  return (
    <span
      className={cn(
        // The caller's `group-hover:scale-*` zoom now lands on the wrapper, so
        // it carries the scale transition the <img> used to provide.
        "relative block overflow-hidden transition-[scale] duration-500 ease-out motion-reduce:transition-none",
        box,
      )}
      style={
        showUnderlay
          ? {
              backgroundImage: `url(${placeholderUrl})`,
              backgroundSize: "cover",
              backgroundPosition: "center",
              ...style,
            }
          : style
      }
    >
      {image}
    </span>
  );
}
