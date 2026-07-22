"use client";

import * as React from "react";

import { disneyResizeUrl } from "#/lib/image.ts";
import { cn } from "#/lib/utils.ts";

/**
 * Shared hero-media pieces (plan item 1.9) used by the park dashboard, ride
 * detail, and dining venue detail heroes. Both render as overlays above an
 * existing base `Image` (SSR'd, thumbhash placeholder) so the still always
 * paints first, and both sit out under prefers-reduced-motion.
 */

/**
 * Crossfading extra stills layered over the base hero image. The base stays
 * slide 0; the extra stills fade in above it on a slow rotation. Renders
 * nothing when there are no extra slides, and stays on the base image under
 * prefers-reduced-motion.
 */
export function HeroCrossfade({ slides }: { slides: Array<{ url: string; alt: string | null }> }) {
  const [active, setActive] = React.useState(0); // 0 = base image, 1..n = slides
  React.useEffect(() => {
    if (slides.length === 0) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const t = setInterval(() => setActive((i) => (i + 1) % (slides.length + 1)), 8000);
    return () => clearInterval(t);
  }, [slides.length]);
  if (slides.length === 0) return null;
  return (
    <>
      {slides.map((s, i) => (
        <img
          key={s.url}
          src={disneyResizeUrl(s.url, 1600)}
          alt={s.alt ?? ""}
          loading="lazy"
          aria-hidden={active !== i + 1}
          className="absolute inset-0 size-full object-cover transition-opacity duration-1000"
          style={{ opacity: active === i + 1 ? 1 : 0 }}
        />
      ))}
    </>
  );
}

/**
 * Ambient hero video: a muted, looping, inline-playing overlay above the base
 * hero still, faded in only once the video can actually play — so slow
 * connections never see a black box. Mounted client-side only, and not at all
 * when the user prefers reduced motion.
 */
export function AmbientHeroVideo({ src, poster }: { src: string; poster: string | null }) {
  const [enabled, setEnabled] = React.useState(false);
  const [ready, setReady] = React.useState(false);
  React.useEffect(() => {
    setEnabled(!window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  }, []);
  if (!enabled) return null;
  return (
    <video
      src={src}
      poster={poster ?? undefined}
      autoPlay
      muted
      loop
      playsInline
      preload="metadata"
      aria-hidden
      onCanPlay={() => setReady(true)}
      className={cn(
        "absolute inset-0 size-full object-cover transition-opacity duration-700",
        ready ? "opacity-100" : "opacity-0",
      )}
    />
  );
}
