"use client";

import type { CSSProperties, ReactNode } from "react";

import { HeroTear } from "#/components/detail/hero-tear.tsx";
import {
  AmbientHeroVideo,
  HeroCrossfade,
  HeroSlideDots,
  useHeroSlides,
  useHeroSwipe,
} from "#/components/hero-media.tsx";
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

/**
 * Page padding for a detail page that opens with a `HERO_BLEED` hero. The
 * mobile top pad has to be exactly the `0.5rem` HERO_BLEED folds into its
 * pull-up (above): the hero reaches the top edge by cancelling the header plus
 * *that* much padding, so a page padded `p-4` instead stops 0.5rem short and
 * shows a strip of page background above the photo.
 *
 * Spelled out in longhand at every breakpoint on purpose — a later `p-*`
 * shorthand loses to a `pt-*` longhand in Tailwind's ordering, so mixing the
 * two (`p-4 pt-2 lg:p-6`) silently keeps the mobile value at `lg` and puts the
 * gap back.
 */
export const HERO_PAGE_PADDING = "px-4 pb-4 pt-2 md:pt-4 lg:px-6 lg:pb-6 lg:pt-6";

/**
 * The phone height of a `creaseAligned` hero (see `DetailHero`): the designed
 * photo height plus however much of the ticket's top half hangs over it.
 * Exported so a page's loading skeleton can reserve the very same box — a
 * skeleton at the plain `HERO_BLEED` height leaves the ticket's crease floating
 * off the photo's edge until the query lands.
 */
export const HERO_CREASE_ALIGNED = [
  "h-[calc(16rem_+_var(--safe-top)_+_var(--app-header-h)_+_0.5rem_+_var(--crease,6.5rem)_-_2.75rem)]",
  "sm:h-[calc(20rem_+_var(--safe-top)_+_var(--app-header-h)_+_0.5rem_+_var(--crease,6.5rem)_-_2.75rem)]",
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
  tear,
  creaseAligned,
  titleless,
}: {
  heroKey: string;
  name: string;
  /** One line under the title. A node is allowed (the park page appends its
   *  "Updated x ago" span) but must stay a single line — see the <p> below. */
  subtitle: ReactNode;
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
  /**
   * Ticket-stub pages (docs/plans/dining-redesign): bite a scalloped tear out
   * of the hero's bottom edge for the ticket to overlap, and square off the
   * desktop card's bottom corners so the tear runs edge to edge.
   */
  tear?: boolean;
  /**
   * Phone layout for a ticket page: no scalloped cut of its own — the hero's
   * bottom edge *is* the ticket's crease, so the stub's own die-cut notches and
   * perforation are the only tear line on screen. The page publishes the
   * ticket's measured top-half height as `--crease` (see `Ticket`), and the
   * hero grows by however much that exceeds the old 44px overlap, so the
   * visible photo above the crease keeps the height it was designed at.
   * Desktop is unaffected and keeps the scallop.
   */
  creaseAligned?: boolean;
  /**
   * Suppress the overlaid name + subtitle — the ticket carries them. The map
   * flight then lands on the ticket's title instead (`card-flight.ts` looks
   * outside the hero for a `data-hero-title` tagged with this flight's key).
   */
  titleless?: boolean;
}) {
  // Transparent, not unmounted: the flight measures these boxes to land on.
  // `visibility` as well as opacity, because Chrome paints an element's
  // backdrop-filter even at opacity 0 — a wait chip that's merely transparent
  // still blits its blur rectangle at the landing spot mid-flight.
  const hidden = flying ? ({ opacity: 0, visibility: "hidden" } as CSSProperties) : undefined;
  // The gallery's rotation, owned here so the indicator row below can read it —
  // and so tapping a dot drives the same crossfade. A hero running its ambient
  // loop has no stills to rotate.
  const gallery = useHeroSlides(video ? 0 : (slides?.length ?? 0));
  // A gallery to move through, and the layout to show it in: the ticket pages'
  // `titleless` hero, whose bottom edge is free for the indicator row. (A hero
  // carrying its own title has that seat taken; ride and park pages get both
  // when they get their tickets.)
  const gallerable = !video && gallery.total > 1;
  // Swipe it. Off while a map-card flight is still in the air — the photo layer
  // is hidden and mid-flight, so there is nothing to drag.
  const swipe = useHeroSwipe({
    total: gallery.total,
    active: gallery.active,
    select: gallery.select,
    hold: gallery.hold,
    enabled: gallerable && !flying,
  });
  /**
   * The indicator row, wherever this hero has room for it: centred on the free
   * bottom edge of a ticket hero, or stacked above the title on a hero that
   * draws its own (where the title block is bottom-anchored, so the dots grow
   * the block upward and leave the `data-hero-title` landing pad exactly where
   * a flight measured it).
   */
  const dots = (className: string) =>
    gallerable ? (
      <HeroSlideDots
        total={gallery.total}
        active={gallery.active}
        onSelect={gallery.select}
        rotating={gallery.rotating}
        paused={!!swipe.drag}
        style={hidden}
        className={className}
      />
    ) : null;

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
      {...(gallerable ? swipe.handlers : null)}
      className={cn(
        "relative isolate overflow-hidden md:shadow-sm",
        // Vertical stays the page's; horizontal is the gallery's (see
        // `useHeroSwipe`). Without this the browser would claim the gesture
        // as an overscroll and the preview would never see it.
        gallerable && "touch-pan-y",
        HERO_BLEED,
        // A torn hero is taller on desktop, keeps only its top corners, and
        // drops the card shadow — the ticket below it carries the lift.
        tear && "md:h-100 md:rounded-t-3xl md:rounded-b-none md:shadow-none",
        creaseAligned && HERO_CREASE_ALIGNED,
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
          <HeroCrossfade
            slides={slides ?? []}
            active={gallery.active}
            drag={swipe.drag}
            fast={gallery.manual}
          />
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

      {/* Gallery indicators, centred on the ticket hero's free bottom edge,
          just clear of the stub that overlaps it. A hero that draws its own
          title puts them above it instead (see `dots`). */}
      {titleless &&
        dots(
          cn(
            "absolute left-1/2 z-10 -translate-x-1/2",
            // Phone: above the ticket's top edge, which hangs `--crease` above
            // the hero's own bottom. Desktop: above the ticket's -48px overlap
            // of the scalloped tear.
            creaseAligned
              ? "bottom-[calc(var(--crease,6.5rem)_+_0.5rem)] md:bottom-16"
              : "bottom-4 md:bottom-16",
          ),
        )}

      {overlays?.({ chipFx, hidden })}

      {!titleless && (
        <div className="absolute inset-x-0 bottom-0 flex flex-col gap-1 p-4 sm:p-6">
          {dots("mb-1 self-start")}
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
      )}

      {/* Last, so the scallops bite through the scrim as well as the photo. Two
          instances rather than one responsive path: the bumps are drawn at a
          real radius per breakpoint (13/30 phone, 14/34 desktop), not scaled. */}
      {tear && (
        <>
          {!creaseAligned && <HeroTear radius={13} step={30} className="md:hidden" />}
          <HeroTear radius={14} step={34} className="hidden md:block" />
        </>
      )}
    </div>
  );
}
