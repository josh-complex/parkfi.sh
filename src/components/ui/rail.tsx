"use client";

import * as React from "react";

import {
  Carousel,
  CarouselArrows,
  CarouselContent,
  CarouselItem,
} from "#/components/ui/carousel.tsx";
import { cn } from "#/lib/utils.ts";

/**
 * Side-scrolling rails — the one place the app's horizontal-scroll patterns are
 * defined, so a new page can't quietly invent another variant of any of them.
 *
 * 1. `ChipRail` + `RailChip` — the quick-filter pill row that tucks under a
 *    header (cuisine on Eats, area on Stays, resort on Tickets, category on
 *    Waits, jump-to-section on a menu).
 * 2. `RailShelf` + `RailShelfHeader` + `RailTrack` + `RailItem` — the shelf
 *    itself: the full-bleed carousel, its title/subtitle/arrows row, the track,
 *    and the per-card width ladder. Split into parts rather than one closed
 *    component because a couple of shelves put something else in the section
 *    (the Waits board swaps the track for a list view; a badge family adds a
 *    progress bar under it).
 * 3. `RailCard` and friends — the card that rides in one of those shelves:
 *    4:3 art with badges over it, then a title and a line or two of meta. Every
 *    shelf in the app (rides, resorts, restaurants, shows, tickets, menu items)
 *    was hand-rolling this identical shell.
 *
 * None of them mask their trailing edge any more. The chip rows and shelves used
 * to carry a `mask-image` fade at the edges; on the small screens they mostly run
 * on it read as an out-of-focus blur over card art and chip labels rather than as
 * an affordance, so the rails now simply run to the gutter and let the clipped
 * next item signal that there's more. Don't reintroduce the mask per-call-site.
 */

/** Padding for a full-bleed carousel shelf's viewport: page gutter on mobile,
 *  the wider dashboard gutter from `lg` up. Pass as `viewportClassName`. */
export const SHELF_VIEWPORT = "px-4 lg:px-6";

/**
 * How wide one shelf card is at each breakpoint: every step is exactly 1.125× the
 * width shelves used to use (42% → 47.25% on a phone, 1/3 → 37.5% at `md`, and so
 * on). Wide enough to read a restaurant or a ride from, and still narrow enough
 * that the next card peeks past the gutter and says "this scrolls".
 *
 * That 1.125 is why the art is `RAIL_MEDIA_RATIO` (3:2) rather than the 4:3 it
 * was: 4/3 × 1.125 = 3/2 exactly, so the card got wider without the art getting
 * one pixel taller. Change one of these two and you must change the other, or
 * every shelf in the app grows or shrinks vertically.
 *
 * Exported raw for the handful of shelves whose loading state lays the same cards
 * out in a plain flex row rather than a carousel; anything in a carousel should
 * use `RailItem`, which adds the track's `pl-4` gutter.
 */
export const RAIL_ITEM_BASIS =
  "basis-[47.25%] md:basis-[37.5%] lg:basis-[28.125%] xl:basis-[22.5%] 2xl:basis-[18.75%]";

/**
 * Column counts for the placeholder grid a shelf shows while it loads — the grid
 * equivalent of `RAIL_ITEM_BASIS`, so the ghost holds roughly the space the real
 * shelf will take rather than laying out a denser grid that visibly reflows.
 */
export const RAIL_GHOST_GRID =
  "grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-5";

/**
 * The horizontally scrolling quick-filter row. Owns the scroll behaviour (snap,
 * hidden scrollbar, gutter padding that keeps the first chip aligned with the
 * page's content); callers supply `RailChip` children and the group semantics.
 *
 * Mobile-only surfaces pass `md:hidden` via `className` — the rail itself makes
 * no breakpoint assumption, since the menu sheet's rails show at every width.
 */
export function ChipRail({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="chip-rail"
      className={cn(
        "flex snap-x scroll-px-4 gap-1.5 overflow-x-auto px-4 py-2",
        "[scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
        className,
      )}
      {...props}
    />
  );
}

/** One pill in a `ChipRail`. `active` is the selected state — a filled chip that
 *  inverts foreground/background, matching the filter drawers' chips. Toggle
 *  rails add their own `aria-pressed`; jump-to-section rails (which navigate
 *  rather than toggle) leave it off, so the base component stays neutral. */
export function RailChip({
  active,
  className,
  ...props
}: React.ComponentProps<"button"> & { active?: boolean }) {
  return (
    <button
      type="button"
      data-slot="rail-chip"
      className={cn(
        "flex shrink-0 snap-start items-center gap-1 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
        active
          ? "border-foreground bg-foreground text-background"
          : "border-border text-muted-foreground hover:border-foreground/40 hover:text-foreground",
        className,
      )}
      {...props}
    />
  );
}

/**
 * A full-bleed shelf: the carousel that bleeds past the page gutter, wrapping a
 * `<section>` that holds a `RailShelfHeader`, a `RailTrack`, and whatever else
 * the shelf needs. Embla options are fixed here (`align: "start"`, `dragFree`) so
 * every shelf in the app flicks identically.
 *
 * `className` styles the section — the thing callers actually tweak (extra top
 * padding, say). `carouselClassName` is the escape hatch for the bleeding outer
 * element, which only wants touching to add outer margin.
 */
export function RailShelf({
  className,
  carouselClassName,
  children,
  ...props
}: React.ComponentProps<"section"> & { carouselClassName?: string }) {
  return (
    <Carousel
      opts={{ align: "start", dragFree: true }}
      className={cn("-mx-4 lg:-mx-6", carouselClassName)}
    >
      <section data-slot="rail-shelf" className={cn("flex flex-col gap-3", className)} {...props}>
        {children}
      </section>
    </Carousel>
  );
}

/**
 * A shelf's title row: heading and blurb on the left, the desktop prev/next pair
 * on the right (they hide themselves when there's nothing to scroll). Both text
 * slots take nodes, so a shelf whose heading is a button — tapping a Stays tier
 * heading filters to it — passes that button as `title` and keeps the heading
 * semantics.
 *
 * The title/subtitle truncate rather than wrap, so a long park or resort name
 * can't push the arrows off the row; `titleClassName`/`subtitleClassName` are for
 * the one or two shelves with their own type treatment. `arrows={false}` for a
 * header outside a carousel — a loading ghost, which has nothing to scroll yet.
 */
export function RailShelfHeader({
  title,
  subtitle,
  arrows = true,
  className,
  titleClassName,
  subtitleClassName,
  ...props
}: Omit<React.ComponentProps<"div">, "title"> & {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  arrows?: boolean;
  titleClassName?: string;
  subtitleClassName?: string;
}) {
  return (
    <div
      data-slot="rail-shelf-header"
      className={cn("flex items-end justify-between gap-4", SHELF_VIEWPORT, className)}
      {...props}
    >
      <div className="flex min-w-0 flex-col gap-0.5">
        <h3 className={cn("truncate text-lg font-semibold tracking-tight", titleClassName)}>
          {title}
        </h3>
        {subtitle ? (
          <p className={cn("truncate text-sm text-muted-foreground", subtitleClassName)}>
            {subtitle}
          </p>
        ) : null}
      </div>
      {arrows ? <CarouselArrows className="hidden shrink-0 md:flex" /> : null}
    </div>
  );
}

/** A shelf's scrolling track. Holds `RailItem`s; the negative gutter that pairs
 *  with their `pl-4` is `CarouselContent`'s own default. */
export function RailTrack({ ...props }: React.ComponentProps<typeof CarouselContent>) {
  return <CarouselContent data-slot="rail-track" viewportClassName={SHELF_VIEWPORT} {...props} />;
}

/** One slot in a shelf's carousel track: the shared width ladder plus the track's
 *  4px-per-side gutter. Pass a `RailCard` (or a card built from one) as its child. */
export function RailItem({ className, ...props }: React.ComponentProps<typeof CarouselItem>) {
  return <CarouselItem className={cn(RAIL_ITEM_BASIS, "pl-4", className)} {...props} />;
}

/** The shell's classes on their own, for the cards that need the shell *on* the
 *  `Link`/`<a>` itself (a resort card dims the whole card when it's unavailable,
 *  which has to include the anchor). Everything else uses `RailCard`. */
export const RAIL_CARD = "group flex flex-col gap-2 outline-none";

/**
 * A shelf card's outer shell. It's the `group` the art's hover-zoom and the
 * title's hover-underline both key off, so a card that wraps this in a `Link`
 * should keep the link a plain `block` and let this stay the group.
 */
export function RailCard({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="rail-card" className={cn(RAIL_CARD, className)} {...props} />;
}

/** The art box's shape, as a class and as the number the `Image` transform wants
 *  (it crops server-side to this ratio, so the two must agree or `object-cover`
 *  throws away the difference). Skeletons standing in for a card use the class so
 *  the ghost is exactly as tall as the card that replaces it. */
export const RAIL_MEDIA_ASPECT = "aspect-[3/2]";
export const RAIL_MEDIA_RATIO = 3 / 2;

/**
 * The card's art box. Children are the `Image` (which should carry
 * `size-full object-cover group-hover:scale-105`) plus any absolutely-positioned
 * badges — wait time, price, availability, an "unavailable" scrim.
 */
export function RailCardMedia({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="rail-card-media"
      className={cn(
        RAIL_MEDIA_ASPECT,
        "relative w-full overflow-hidden rounded-2xl bg-muted",
        className,
      )}
      {...props}
    />
  );
}

/** The text block under the art: a `RailCardTitle` and any number of
 *  `RailCardMeta` lines. */
export function RailCardBody({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="rail-card-body"
      className={cn("flex flex-col gap-0.5 px-0.5", className)}
      {...props}
    />
  );
}

/** The card's name line. Underlines on hover when the card is a link — pass
 *  `interactive={false}` for a card that doesn't navigate. */
export function RailCardTitle({
  className,
  interactive = true,
  ...props
}: React.ComponentProps<"span"> & { interactive?: boolean }) {
  return (
    <span
      data-slot="rail-card-title"
      className={cn(
        "line-clamp-1 text-sm font-medium",
        interactive && "group-hover:underline",
        className,
      )}
      {...props}
    />
  );
}

/** A secondary line under the title — park/resort, land, cuisine, next showtime. */
export function RailCardMeta({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="rail-card-meta"
      className={cn("line-clamp-1 text-xs text-muted-foreground", className)}
      {...props}
    />
  );
}
