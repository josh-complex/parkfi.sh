"use client";

import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";

import { PAGE_WIDTH } from "#/components/page-container.tsx";
import { CarouselArrows } from "#/components/ui/carousel.tsx";
import { Image } from "#/components/ui/image.tsx";
import {
  RAIL_CARD,
  RailItem,
  RailShelf,
  RailTrack,
  SHELF_VIEWPORT,
} from "#/components/ui/rail.tsx";
import { useTRPC } from "#/integrations/trpc/react.ts";
import { formatHourRange, todayInTz } from "#/lib/park-hours.ts";
import { cn } from "#/lib/utils.ts";

import { BandHeading } from "#/components/detail/band.tsx";
import { isHauntedHouse } from "./lightning-lane.ts";
import type { BoardItem } from "./types.ts";

/**
 * How wide one house card is at each breakpoint.
 *
 * Far wider than the shared `RAIL_ITEM_BASIS` ladder, because the art is far
 * wider (see {@link HOUSE_MEDIA_ASPECT}): at the shelf ladder's `2xl:1/6` a 7:3
 * banner is a 300×129 strip, which isn't a poster, it's a bumper sticker. Two
 * banners across from `lg`, three at `2xl`, and below `lg` one card plus a
 * slice of the next — the only affordance a touch reader gets that the row
 * scrolls. From `lg` these are exact fractions of the contained track, so the
 * arrows page by whole screenfuls and no sliver hangs in the gutter.
 *
 * Every breakpoint `RAIL_ITEM_BASIS` names has to be named here too, even where
 * the width doesn't change: this overrides `RailItem`'s default through
 * `cn`/twMerge, which resolves each variant independently — leave `xl` out and
 * the default's `xl:basis-1/5` survives and one breakpoint shows five slivers.
 */
const HOUSE_ITEM_BASIS =
  "basis-[92%] sm:basis-[80%] md:basis-[62%] lg:basis-1/2 xl:basis-1/2 2xl:basis-1/3";

/**
 * The card's art box — the master's own 7:3, and the one number in this file
 * that actually matters.
 *
 * Universal publishes each house's key art as a **2800×1200 banner** (verified
 * across all ten of the 2026 houses), and it is composed for exactly that
 * frame. Roughly half are centred lockups; the other half — every licensed
 * title, Hellraiser and Evil Dead Burn among them — are art on one side and the
 * logo on the other, edge to edge. The band used to show them in a 3:4 portrait
 * tile, i.e. the middle *third* of the frame, so the centred ones came out
 * sliced mid-word and the split ones showed the empty gutter *between* the art
 * and the logo: Evil Dead Burn rendered as a black rectangle. There is no crop
 * that survives both layouts, which is why this is the native ratio and the art
 * is never cropped at all — the card is shaped like the banner, rather than the
 * banner being hacked into the shape of a card.
 */
const HOUSE_MEDIA_ASPECT = "aspect-[7/3]";
const HOUSE_MEDIA_RATIO = 7 / 3;

/**
 * What the card's `<Image>` asks Cloudflare for, mirroring `HOUSE_ITEM_BASIS`.
 * Without it every card would be re-encoded at the tile default (448px) and the
 * type in the lockup — the entire point of this art — would go mushy on a
 * desktop card that renders 480px across.
 */
const HOUSE_IMAGE_SIZES =
  "(max-width: 639px) 92vw, (max-width: 767px) 80vw, (max-width: 1023px) 62vw, (max-width: 1535px) 50vw, 33vw";

/** Key art is a title lockup on a dark field; the shared tile quality (44) is
 *  tuned for photographs and visibly softens lettering at this size. */
const HOUSE_IMAGE_QUALITY = 62;

/**
 * The park's hard-ticket event houses — Halloween Horror Nights and whatever
 * follows it — as their own full-bleed band.
 *
 * They're ordinary `ATTRACTION` rows carrying the `Haunted House` tag, but they
 * only run on event nights behind a separate ticket, so they can't sit in
 * today's board: all day they'd be ten dead rows in the middle of an operating
 * park, and on an event night they're the only rows posting a wait and they'd
 * take the whole table. The board shelves them for that reason; this band is
 * where they get to be the subject instead.
 *
 * Built on the shared shelf primitives, so **every** house is here — the band
 * used to poster five and count the rest into a "+5 more" box that went
 * nowhere, on a page whose whole job is to be the complete list of what's
 * running. A carousel holds all ten without the band eating half the page, and
 * it flicks and pages exactly like every other shelf in the app.
 *
 * On its own dark field, in the event's own colour, because a band that reads
 * as a different *night* from the rest of the page is exactly what it's
 * selling. The event's name comes from today's ticketed-event schedule row when
 * the park posts one, so the band says "Halloween Horror Nights" in season and
 * falls back to a plain description when the feed doesn't.
 */
export function SeasonalHouses({
  board,
  parkSlug,
  className,
}: {
  board: Array<BoardItem> | undefined;
  parkSlug: string | null;
  className?: string;
}) {
  const trpc = useTRPC();
  // Same query key the hours card uses, so this costs no extra round trip.
  const hoursQ = useQuery({
    ...trpc.parks.hours.queryOptions({ parkSlug: parkSlug ?? "" }),
    enabled: !!parkSlug,
  });

  const houses = (board ?? []).filter(isHauntedHouse);
  if (!parkSlug || houses.length === 0) return null;

  const tz = hoursQ.data?.timezone ?? "America/New_York";
  const todayRow = hoursQ.data?.days.find((d) => d.date === todayInTz(tz)) ?? null;
  const event = todayRow?.extras.find((ex) => ex.type === "TICKETED_EVENT") ?? null;
  const eventRange = event ? formatHourRange(event.open, event.close, tz) : null;
  const meta = [
    `${houses.length} ${houses.length === 1 ? "house" : "houses"}`,
    eventRange,
    "waits post once the event opens",
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <section className={cn("band-fright band-tints py-8 text-white md:py-12", className)}>
      <div className={cn(PAGE_WIDTH, "flex flex-col")}>
        <RailShelf className="gap-5" aria-label={event?.description ?? "Haunted houses"}>
          <BandHeading
            tone="invert"
            kicker="Tonight, separate ticket"
            title={event?.description ?? "Haunted houses"}
            // The shelf bleeds to the screen edge below `lg`; the heading has to
            // put the page gutter back or it sits flush against the bezel.
            className={SHELF_VIEWPORT}
            controls={
              <div className="flex items-center gap-4">
                <span className="hidden text-[13px] text-white/75 md:block">{meta}</span>
                <CarouselArrows tone="invert" className="hidden shrink-0 md:flex" />
              </div>
            }
          />

          <RailTrack>
            {houses.map((h) => (
              <RailItem key={h.id} className={HOUSE_ITEM_BASIS}>
                <HouseCard house={h} parkSlug={parkSlug} />
              </RailItem>
            ))}
          </RailTrack>
        </RailShelf>
      </div>
    </section>
  );
}

/**
 * One house: its key art, then its name, where it is, and what it's about.
 *
 * The name sits *under* the art rather than over it. The art already carries
 * the house's own title lockup — laying our type over that meant a black
 * gradient up three-fifths of the frame, hiding the artwork to re-print a name
 * the artwork was already saying. Below the art, the lockup stays whole and the
 * text does the jobs the lockup can't: which land to walk to, and what the
 * house actually is.
 */
function HouseCard({ house, parkSlug }: { house: BoardItem; parkSlug: string }) {
  const hero = house.meta?.imageHeroUrl ?? house.meta?.imageThumbUrl ?? null;
  const wait = house.status === "OPERATING" ? house.standbyWait : null;
  return (
    <Link
      to="/park/$slug/ride/$rideSlug"
      params={{ slug: parkSlug, rideSlug: house.slug }}
      // The shell goes on the anchor itself so the art can react to *focus* as
      // well as hover — `RAIL_CARD` kills the default outline, and a keyboard
      // reader on a dark band with no ring has no idea where they are.
      className={cn(RAIL_CARD, "gap-3")}
    >
      <div
        className={cn(
          HOUSE_MEDIA_ASPECT,
          "relative top-0 w-full overflow-hidden rounded-[18px] bg-neutral-900",
          // The chrome's ghost key, same as the Waits band's park strip and
          // pick posters: a faint light rim and a shallow shelf, both out of
          // `btn-3d-ghost`'s one variable. It lifts the poster off the band on
          // hover and presses it into the band on click — feedback the old
          // tiles' 4px nudge never gave.
          "btn-3d-ghost border-3d shadow-3d",
          "transition-[box-shadow,top,border-top-width,margin-top] duration-150 ease-out",
          "group-hover:-top-px group-hover:shadow-3d-hover",
          "group-active:top-[3px] group-active:shadow-3d-active",
          "group-focus-visible:ring-3 group-focus-visible:ring-white/60",
        )}
      >
        {hero ? (
          <Image
            src={hero}
            alt={house.meta?.imageAlt ?? house.name}
            loading="lazy"
            aspect={HOUSE_MEDIA_RATIO}
            sizes={HOUSE_IMAGE_SIZES}
            quality={HOUSE_IMAGE_QUALITY}
            placeholder={house.meta?.imageThumbhash ?? undefined}
            // No `transition-*` here: `<Image>`'s own wrapper already carries
            // `transition-[scale]` for exactly this zoom, and `scale-*` in
            // Tailwind v4 animates the `scale` property — a `transition-transform`
            // added here would win the merge and the zoom would snap.
            className="size-full object-cover group-hover:scale-[1.04]"
          />
        ) : null}
        {/* A live wait only ever appears on an event night — the one time this
            card is a thing you act on rather than read. Top-left, where every
            shelf card in the app puts its wait, and the one corner no house's
            art uses: the split layouts put their logo on the right and their
            subject centre-left, and the centred ones vignette both corners. */}
        {wait != null && (
          <span className="absolute top-2.5 left-2.5 rounded-lg bg-brand-yellow px-2 py-0.5 text-[13px] font-extrabold text-ink-on-yellow tabular-nums shadow-sm">
            {wait}
            <span className="ml-0.5 text-[10px] font-bold">min</span>
          </span>
        )}
      </div>

      <div className="flex flex-col gap-1 px-0.5">
        <span className="line-clamp-2 text-[15px] leading-tight font-extrabold text-white group-hover:underline">
          {house.name}
        </span>
        {house.meta?.land && (
          <span className="line-clamp-1 text-[12px] font-semibold text-white/65">
            {house.meta.land}
          </span>
        )}
        {house.meta?.description && (
          <span className="mt-0.5 line-clamp-2 text-[13px] leading-snug text-white/75">
            {house.meta.description}
          </span>
        )}
      </div>
    </Link>
  );
}
