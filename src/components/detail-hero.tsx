"use client";

import type { CSSProperties, ReactNode } from "react";

import { AmbientHeroVideo, HeroCrossfade } from "#/components/hero-media.tsx";
import { Image } from "#/components/ui/image.tsx";
import { disneyResizeUrl, HERO_IMAGE } from "#/lib/image.ts";
import { cn } from "#/lib/utils.ts";

/**
 * Mobile full-bleed hero: the photo runs to the device's top and side edges,
 * under the floating search header. The upward pull is exactly the header's
 * locked height (`--safe-top + --app-header-h` — see SiteHeader) plus this
 * page's own `pt-2`, so it provably reaches the top edge on every device; the
 * box grows by the identical amount so the photo *below* the header keeps its
 * designed height. Gated on `md` (not `sm`), because the floating header mounts
 * below 768px. Desktop keeps the rounded card nested in the content column.
 */
export const HERO_BLEED = [
  // The width must be stated, not implied: negative margins only *shift* a
  // `w-full` box (it stays pinned to the container's content width and hangs off
  // one side), so the box has to claim the gutters back explicitly.
  "-mx-4 w-[calc(100%_+_2rem)] md:mx-0 md:w-full",
  "-mt-[calc(var(--safe-top)_+_var(--app-header-h)_+_0.5rem)] rounded-none",
  "h-[calc(16rem_+_var(--safe-top)_+_var(--app-header-h)_+_0.5rem)]",
  "sm:h-[calc(20rem_+_var(--safe-top)_+_var(--app-header-h)_+_0.5rem)]",
  "md:mt-0 md:h-80 md:rounded-2xl",
].join(" ");

/** Top-pinned hero overlays, dropped clear of the floating search pill. */
export const HERO_OVERLAY_TOP = "top-[calc(var(--safe-top)_+_var(--app-header-h))] md:top-4";

/** What the hero hands its `overlays` render prop — the entrance stagger and
 *  the landing-target hider, so a page's own chips join the same choreography
 *  the hero runs for its photo and title. */
export type HeroOverlayFx = {
  /**
   * Entrance for overlay chips that *aren't* flight landing targets. Arriving
   * from a map card they hold invisible while the clones are in the air, then
   * stagger in top-first with a short fade-down once the flight settles; `i` is
   * the chip's slot in that cascade. Delay and fill-mode ride inline so each
   * chip waits its turn unseen; chips the query adds later simply join the
   * cascade at their own slot when they mount.
   */
  chipFx: (i: number) => { className?: string; style?: CSSProperties };
  /** Inline style for a flight *landing target*: transparent but laid out (so
   *  the flight can measure it), and `visibility: hidden` too, because Chrome
   *  paints backdrop-filter even at opacity 0. Undefined once nothing flies. */
  hidden?: CSSProperties;
};

/**
 * The identity hero every detail page shares — full-bleed photo (or gradient),
 * scrim, and the overlaid title/subtitle — shared by each page's loaded state
 * and its loading state.
 *
 * Both render it in the *same* configuration — same bleed, same overlay
 * positions, same type — because arriving from a map card lands flown clones on
 * it (see `card-flight.ts`) and they need real boxes to land on. The loading
 * state fills it from the card's own seed rather than grey blocks, so data
 * landing changes no geometry at all; only the parts the card couldn't know
 * (hours, gallery, ambient loop) fade in afterwards.
 *
 * `flying` means those clones are still in the air: the landing targets stay
 * transparent (but laid out, so they can be measured) and the flight reveals
 * them itself when it settles. The tags it stamps (`data-hero`,
 * `data-hero-image`, `data-hero-scrim`, `data-hero-title` — plus
 * `data-hero-wait` if a page renders one in `overlays`) are the flight's
 * landing contract.
 */
export function DetailHero({
  heroKey,
  name,
  subtitle,
  image,
  underlay,
  imageAlt,
  thumbhash,
  video,
  slides,
  flying,
  entrance,
  overlays,
}: {
  heroKey: string;
  name: string;
  subtitle: string | null;
  image: string | null;
  /** The hero-crop preview the flight fades to in mid-air — see the layer below. */
  underlay?: string | null;
  imageAlt?: string | null;
  thumbhash?: string | null;
  video?: { url: string; poster?: string | null } | null;
  slides?: Array<{ url: string; alt: string | null }>;
  flying: boolean;
  /** Opened via a map-card flight (whether or not clones are still airborne):
   *  the overlay chips that aren't landing targets stagger in after touchdown. */
  entrance: boolean;
  /** The page's overlay chips (wait block, status, hours…), positioned by the
   *  page itself (`HERO_OVERLAY_TOP` etc.) and choreographed via the fx arg. */
  overlays?: (fx: HeroOverlayFx) => ReactNode;
}) {
  // Transparent, not unmounted: the flight measures these boxes to land on.
  // `visibility` as well as opacity, because Chrome paints an element's
  // backdrop-filter even at opacity 0 — a wait chip that's merely transparent
  // still blits its blur rectangle at the landing spot mid-flight.
  const hidden = flying ? ({ opacity: 0, visibility: "hidden" } as CSSProperties) : undefined;
  const chipFx = (i: number): { className?: string; style?: CSSProperties } => {
    if (!entrance) return {};
    if (flying) return { style: { opacity: 0, visibility: "hidden" } };
    return {
      className: "animate-in fade-in slide-in-from-top-2 duration-300 motion-reduce:animate-none",
      style: { animationDelay: `${i * 70}ms`, animationFillMode: "backwards" },
    };
  };
  return (
    <div
      data-hero={heroKey}
      className={cn(
        "relative isolate overflow-hidden md:shadow-sm",
        HERO_BLEED,
        image || video ? "bg-muted" : "bg-gradient-to-br from-slate-600 via-slate-800 to-slate-900",
      )}
    >
      {/* The photo, its ambient loop and its gallery crossfade travel together
          as one layer — that whole stack is what the card's header flies into,
          so it hides and reveals as a unit. */}
      <div data-hero-image className="absolute inset-0" style={hidden}>
        {/* A light copy of the photo in the hero's *own* crop, held underneath
            for the life of the page — the same rendition the flight fades to in
            mid-air, so it's already decoded when it gets here. It gives the
            <Image> above something correctly-framed to fade in over: anything
            that makes that element replay its fade (a src resolving differently
            once the query lands, or the thumbhash arriving and restructuring it)
            becomes a crossfade between two identical framings rather than a
            blink through an empty box. */}
        {underlay && (
          <img
            src={underlay}
            alt=""
            aria-hidden
            className="absolute inset-0 size-full object-cover"
          />
        )}
        {image && (
          <Image
            src={disneyResizeUrl(image, HERO_IMAGE.resizeWidth)}
            alt={imageAlt ?? name}
            className="size-full object-cover"
            loading="eager"
            fetchPriority="high"
            sizes={HERO_IMAGE.sizes}
            widths={HERO_IMAGE.widths}
            quality={HERO_IMAGE.quality}
            // A thumbhash placeholder switches `Image` to its wrapper-span
            // structure, so passing one only *after* the query lands would
            // remount the <img> and replay its blur/scale fade-in — the shift
            // this underlay exists to remove. With a real photo already beneath,
            // the hash has nothing left to stand in for.
            placeholder={underlay ? undefined : (thumbhash ?? undefined)}
          />
        )}
        {/* Ambient hero loop (plan item 1.9): fades in over the still once it
            can play; never mounts under prefers-reduced-motion. Video-less
            entities crossfade their gallery stills instead. */}
        {video ? (
          <AmbientHeroVideo src={video.url} poster={video.poster ?? null} />
        ) : (
          <HeroCrossfade slides={slides ?? []} />
        )}
      </div>
      {/* Scrim: heavy at the bottom for the title, light at the top so the
          overlay chips keep their contrast without flattening the photo.
          Tagged so the card flight can copy this exact gradient onto the
          flying photo and fade it in en route (see `flyPhoto`). */}
      <div
        data-hero-scrim
        className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-black/40"
      />

      {overlays?.({ chipFx, hidden })}

      <div className="absolute inset-x-0 bottom-0 flex flex-col gap-1 p-4 sm:p-6">
        <h1
          data-hero-title
          style={hidden}
          className="truncate text-2xl font-bold tracking-tight text-white drop-shadow-md sm:whitespace-normal sm:text-3xl"
        >
          {name}
        </h1>
        {/* Always one line, even before the identity query lands: the title's
            box is a landing target, and a subtitle that appeared later would
            shift it up out from under the clone that just landed on it. */}
        <p className="truncate text-sm text-white/85 sm:whitespace-normal">{subtitle || " "}</p>
      </div>
    </div>
  );
}
