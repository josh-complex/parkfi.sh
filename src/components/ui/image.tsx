"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { cn } from "#/lib/utils.ts";

type ImageProps = Omit<React.ComponentProps<"img">, "src"> & {
  src: string | null | undefined;
  /** Rendered in place of the image when `src` is missing or fails to load. */
  fallback?: React.ReactNode;
  /** Skip the blur/fade-in (e.g. tiny avatars where the transition is just noise). */
  noFade?: boolean;
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
  className,
  onLoad,
  onError,
  ...props
}: ImageProps) {
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

  if (!src || erroredSrc === src) return <>{fallback ?? null}</>;

  const instant = instantSrc === src;
  const loaded = instant || fadedSrc === src;
  return (
    <img
      ref={ref}
      src={src}
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
