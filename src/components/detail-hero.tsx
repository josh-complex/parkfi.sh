"use client";

import * as React from "react";
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
import { disneyResizeUrl, HERO_IMAGE, imageFocusClass } from "#/lib/image.ts";
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

/**
 * Desktop only: run the hero up *behind* the floating nav capsule, so the photo
 * is the first thing on the page rather than a card parked below the chrome —
 * the same trick the Waits band plays with its navy field.
 *
 * The pull has to clear three things, not two: the capsule's slab
 * (`--floating-nav-height`), the pinned stripe (`--site-header-height`), *and*
 * the page's own top padding, which is what `HERO_PAGE_PADDING` puts between
 * the container and its first child. Miss that last term and the photo starts a
 * pad below the viewport top while the stripe is only ~20px tall in the app's
 * floating layout (no ticker there), so the difference shows as a white line
 * ruled across the page under the masthead. Hence the breakpoint pair: the pad
 * is `1rem` at `md` and `1.5rem` from `lg`, so the pull is too.
 *
 * Half a rem of overlap on top of that, for the same reason the Waits band
 * overshoots: `--site-header-height` is a live measurement and the pad is a
 * round number, and two values that are only *supposed* to meet will miss on a
 * subpixel and show the miss as that same hairline. An overlap cannot miss.
 *
 * The box grows by the whole pull, so the photo visible *below* the capsule
 * keeps the 25rem it was designed at plus the pad it has absorbed — i.e. the
 * page's vertical rhythm is unchanged, the photo has simply eaten the chrome.
 *
 * Every variable here is `0px` wherever this chrome isn't (mobile, the
 * marketing layout), which makes the whole thing a no-op rather than a special
 * case. The phone needs none of it: `HERO_BLEED` already takes the photo to the
 * top edge there, under a header that floats over it.
 *
 * The hero's top corners square off for this (see the corner classes in
 * `DetailHero`): rounded ones would hold two crescents of page background
 * against the pinned stripe.
 */
export const HERO_UNDER_NAV = [
  // Phone and tablet: `HERO_CREASE_ALIGNED`'s heights (16 / 20rem), a fifth
  // taller, a tenth taller again, and then a tenth back off — the phone was
  // giving more of a short screen to the photo than the desktop gives of a tall
  // one. Restated in full rather than composed, because these have to *win* the
  // Tailwind merge against the ones it sets, which they do by being later in
  // the class list rather than by being cleverer.
  "h-[calc(19rem_+_var(--safe-top)_+_var(--app-header-h)_+_0.5rem_+_var(--crease,6.5rem)_-_2.75rem)]",
  "sm:h-[calc(23.75rem_+_var(--safe-top)_+_var(--app-header-h)_+_0.5rem_+_var(--crease,6.5rem)_-_2.75rem)]",
  // Desktop: 25rem of visible photo became 33rem by the same two steps, plus
  // the pad it absorbs and the half-rem overlap (see above).
  "md:mt-[calc((var(--floating-nav-height)_+_var(--site-header-height)_+_1.5rem)*-1)]",
  "md:h-[calc(34.5rem_+_var(--floating-nav-height)_+_var(--site-header-height))]",
  "lg:mt-[calc((var(--floating-nav-height)_+_var(--site-header-height)_+_2rem)*-1)]",
  "lg:h-[calc(35rem_+_var(--floating-nav-height)_+_var(--site-header-height))]",
].join(" ");

/**
 * The gap the gallery dots keep from the ticket stub's edge when the photo's
 * own centre isn't clear of it — the same 1rem they keep from the hero's
 * bottom edge.
 */
const DOTS_GAP = 16;

/** Top-pinned hero overlays, dropped clear of the floating search pill. */
export const HERO_OVERLAY_TOP = "top-[calc(var(--safe-top)_+_var(--app-header-h))] md:top-4";

/** The same, on a `underNav` hero — where `md:top-4` would park the chip behind
 *  the glass capsule. The phone half is unchanged: nothing moved there. */
export const HERO_OVERLAY_TOP_UNDER_NAV = [
  "top-[calc(var(--safe-top)_+_var(--app-header-h))]",
  "md:top-[calc(var(--site-header-height)_+_var(--floating-nav-height)_+_0.5rem)]",
].join(" ");

/**
 * The headline blob — a ride's standby, a venue's walk-up list, a resort's
 * nightly rate. Top-left on a phone, clear of the floating header; **bottom-
 * right from `md`** (2026-09-17, Josh). On desktop the top-left corner is where
 * the eye lands first, and spending it on a number the page states again a few
 * hundred pixels down (in the ticket, and in the job block's own heading) meant
 * the photo opened on a restatement. Bottom-right it reads as a caption on the
 * picture instead: last thing seen, nothing blocked.
 *
 * *How far* down depends on where the stub is (2026-09-17, Josh). From `wide`
 * it is a card in the left column and the bottom-right corner is simply free.
 * Below that it is centred and up to 34rem across, so at the narrow end of the
 * band its right edge reaches past where this blob starts — at 768px the two
 * overlap by ~60px — and the blob has to ride above the stub's crease the way
 * the gallery dots do, rather than under it.
 */
export const HERO_OVERLAY_HEADLINE = [
  "left-4 top-[calc(var(--safe-top)_+_var(--app-header-h))]",
  // `*-auto` has to come after the phone values: these are one class list, and
  // the merge resolves `md:top-*` / `md:left-*` last-wins.
  "md:top-auto md:bottom-[calc(var(--crease,6.5rem)_+_0.5rem)] md:left-auto md:right-5",
  "wide:bottom-4",
].join(" ");

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
  crease,
  titleless,
  underNav,
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
   * Where the ticket's crease meets this hero.
   *
   * `"phone"` — the phone hangs the stub's crease on the hero's bottom edge
   * (so the stub's die-cut notches and perforation are the only tear line on
   * screen) and the desktop keeps the scalloped cut with its fixed 48px
   * overlap. The page publishes the ticket's measured top-half height as
   * `--crease` (see `Ticket`) and the hero grows by however much that exceeds
   * the old 44px overlap, so the visible photo above the crease keeps the
   * height it was designed at.
   *
   * `"always"` — the same alignment at every width, and no scallop anywhere.
   * The desktop scallop put a row of bites across the photo *and* left the
   * crease floating in the middle of it: one tear line, on the photo's own
   * edge, reads as one object; two read as decoration.
   */
  crease?: "phone" | "always";
  /**
   * Suppress the overlaid name + subtitle — the ticket carries them. The map
   * flight then lands on the ticket's title instead (`card-flight.ts` looks
   * outside the hero for a `data-hero-title` tagged with this flight's key).
   */
  titleless?: boolean;
  /** Run the photo up behind the desktop floating nav — see `HERO_UNDER_NAV`. */
  underNav?: boolean;
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
   * Where the dots sit along a crease-aligned hero's bottom edge, in px from
   * its left edge: the photo's own centre when the pill clears the stub
   * overlapping the bottom-left corner, and one `DOTS_GAP` to the right of the
   * stub when it doesn't — which is what happens as the window narrows and the
   * left column's stub grows towards the middle of the photo.
   *
   * Measured rather than derived: the pill's width is a function of how many
   * slides this entity has, and the stub's of a grid track, a pair of negative
   * margins and the breakpoint. Published as `--dots-left` and read by a
   * `wide:` class, so everything below it — where the dots hang a whole crease
   * above a stub that owns the middle of the edge — never sees it, and so the
   * server and the first client render agree (there is no variable until a
   * layout effect sets one).
   */
  const heroRef = React.useRef<HTMLDivElement>(null);
  const [dotsLeft, setDotsLeft] = React.useState<string>();
  React.useLayoutEffect(() => {
    const hero = heroRef.current;
    if (!hero || !gallerable || crease !== "always") return;
    const pill = hero.querySelector<HTMLElement>("[data-hero-dots]");
    if (!pill) return;
    const measure = () => {
      // Looked up live: the stub mounts with the page's query, which may land
      // after the slides that made this hero gallerable in the first place.
      const ticket = document.querySelector<HTMLElement>("[data-ticket]");
      if (!ticket) return;
      const h = hero.getBoundingClientRect();
      const t = ticket.getBoundingClientRect();
      const w = pill.getBoundingClientRect().width;
      setDotsLeft(`${Math.max(h.width / 2, t.right - h.left + DOTS_GAP + w / 2)}px`);
    };
    measure();
    // The hero's box covers the stub's too — they share a page container, so
    // nothing resizes one without resizing the other — and the hero's *height*
    // rides `--crease`, which is how a stub mounting late gets measured.
    const ro = new ResizeObserver(measure);
    ro.observe(hero);
    ro.observe(pill);
    // Plus the window, for the breakpoints that move the stub's column without
    // moving the hero: past the container's max width the photo stops growing,
    // but `xl` still widens the left track from 30rem to 34rem under it.
    window.addEventListener("resize", measure);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [gallerable, crease, gallery.total]);

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
      ref={heroRef}
      data-hero={heroKey}
      style={dotsLeft ? ({ "--dots-left": dotsLeft } as CSSProperties) : undefined}
      {...(gallerable ? swipe.handlers : null)}
      className={cn(
        "relative isolate overflow-hidden md:shadow-sm",
        // Vertical stays the page's; horizontal is the gallery's (see
        // `useHeroSwipe`). Without this the browser would claim the gesture
        // as an overscroll and the preview would never see it.
        gallerable && "touch-pan-y",
        HERO_BLEED,
        // A torn hero is taller on desktop and drops the card shadow — the
        // ticket below it carries the lift. Only the scalloped variant squares
        // off its bottom corners (the scallops run edge to edge and a radius
        // would clip them); a crease-aligned hero keeps a rounded card, with
        // the ticket overlapping its bottom-left corner.
        tear && "md:h-100 md:shadow-none",
        tear && crease !== "always" && "md:rounded-t-3xl md:rounded-b-none",
        tear &&
          crease === "always" &&
          // Square at the top when the photo runs up behind the nav, rounded
          // all round when it doesn't.
          (underNav ? "md:rounded-t-none md:rounded-b-3xl" : "md:rounded-3xl"),
        crease && HERO_CREASE_ALIGNED,
        // Last of the sizing classes, so its `md:h-*` and `md:mt-*` win the
        // merge against the `md:h-100` a torn hero asks for above and the
        // `md:mt-0` in HERO_BLEED.
        underNav && HERO_UNDER_NAV,
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
            className={cn("absolute inset-0 size-full object-cover", imageFocusClass(underlay))}
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

      {/* A second, local scrim for the strip the floating nav sits on. The main
          gradient tops out at 40% black, which is enough for a chip with its own
          backdrop but not enough to guarantee white nav links over a bright sky
          — and the masthead has switched to its dark ink by then (see
          `darkField` in site-header-desktop), so it is committed to light type
          whatever the photo does. Not part of `data-hero-scrim`: the card flight
          copies that gradient onto the flying photo, and this one belongs to the
          page's chrome rather than to the picture. */}
      {underNav && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 hidden h-[calc(var(--site-header-height)_+_var(--floating-nav-height)_+_2rem)] bg-gradient-to-b from-black/60 via-black/35 to-transparent md:block"
        />
      )}

      {/* Gallery indicators, centred on the ticket hero's free bottom edge,
          just clear of the stub that overlaps it. A hero that draws its own
          title puts them above it instead (see `dots`). */}
      {titleless &&
        dots(
          cn(
            "absolute left-1/2 z-10 -translate-x-1/2",
            // Below `wide` the stub is the width of the page (a phone) or a
            // 34rem card centred on it (a tablet), so either way it owns the
            // middle of the hero's bottom edge and the dots have to clear its
            // top — which hangs `--crease` above the hero's own bottom
            // wherever the crease is aligned.
            //
            // From `wide` a `crease="always"` page lays the stub out as a
            // narrow card in the *left column*, so the bottom edge is free to
            // the right of it and that is where the dots belong: floating them
            // a whole crease up left them stranded in the middle of the photo,
            // pointing at nothing (2026-09-16, Josh).
            //
            // `wide`, not `md` (2026-09-17, Josh): that left-column premise
            // only holds once the two columns exist. In between, the dots were
            // shoved past the right edge of a *centred* stub and into the
            // hero's own corner. A scalloped desktop still clears its fixed
            // -48px overlap instead.
            crease === "always"
              ? "bottom-[calc(var(--crease,6.5rem)_+_0.5rem)] wide:bottom-4 wide:left-[var(--dots-left,50%)]"
              : crease === "phone"
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
      {tear && crease !== "always" && (
        <>
          {crease !== "phone" && <HeroTear radius={13} step={30} className="md:hidden" />}
          <HeroTear radius={14} step={34} className="hidden md:block" />
        </>
      )}
    </div>
  );
}
