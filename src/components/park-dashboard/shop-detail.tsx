"use client";

import * as React from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useLayoutEffect } from "react";
import { ExternalLinkIcon } from "lucide-react";

import { ACTION_BAR_PAGE_PAD, DetailActionBar } from "#/components/detail/action-bar.tsx";
import { TintPanel, WashPanel } from "#/components/detail/panels.tsx";
import {
  TICKET_DEFAULT_CREASE,
  Ticket,
  TicketChip,
  type TicketFact,
} from "#/components/detail/ticket.tsx";
import { DetailHero, HERO_PAGE_PADDING } from "#/components/detail-hero.tsx";
import { LocationMap } from "#/components/maps/location-map.tsx";
import { PAGE_WIDTH } from "#/components/page-container.tsx";
import { ParkNews } from "#/components/park-dashboard/park-news.tsx";
import { ShopHere, humanizeFacet } from "#/components/park-dashboard/shop-here.tsx";
import {
  heroFlightKey,
  launchHeroReturn,
  releaseHeroFlight,
  useHeroFlight,
} from "#/components/park-map/card-flight.ts";
import { WalkThereButton } from "#/components/park-map/walk-there-button.tsx";
import { RemovalRequestDialog } from "#/components/removal-request-dialog.tsx";
import { Button } from "#/components/ui/button.tsx";
import { useTRPC } from "#/integrations/trpc/react.ts";
import { formatParkName, samePark } from "#/lib/parks.ts";
import { cn } from "#/lib/utils.ts";

/** "gateway-gifts" -> "Gateway Gifts" for a readable, indexable fallback title. */
export function titleizeSlug(slug: string): string {
  return slug
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

/**
 * How many merchandise categories ride on the stub as chips, over and above the
 * one the "Sells" fact already names. Four, so the chip row never takes a
 * second line on a phone-width ticket.
 */
const TICKET_CHIPS = 4;

/**
 * Past this many categories the stub stops being the whole answer and the wash
 * panel lists them all — which is also what gives the "+N" fold somewhere to
 * fold *to*. One fact plus four chips is five; the sixth is the first one the
 * reader can't see.
 */
const WASH_AT = TICKET_CHIPS + 2;

/**
 * The `/shop/$slug` page, on the ticket-stub system (docs/plans/dining-redesign
 * §4.5). This is the **minimum** page in that system, and it is worth naming
 * why: a shop publishes a name, a place, a paragraph of marketing copy, a pin
 * on the map and a list of merchandise categories. There is no live number, no
 * booking, no history — no *job* for the wash panel to do.
 *
 * So the page is the skeleton and little else — hero, ticket, prose, map — with
 * the wash panel appearing only when the categories outgrow the stub, and the
 * wide column carrying the neighbourhood (the park's other stores, and what
 * we've written about the park) rather than anything about this shop. That is
 * the system degrading on purpose, not a page half-built: a shop page that
 * invented a stat block would be inventing the stats.
 */
export function ShopDetail({ slug }: { slug: string }) {
  const trpc = useTRPC();
  const { data: shop } = useQuery(trpc.parks.shop.queryOptions({ slug }));

  // Set when this page was opened by tapping a map POI card: the card's own
  // name, subtitle and photo, plus whether its flown clones are still in the
  // air (see `card-flight.ts`).
  const heroKey = heroFlightKey("shop", slug);
  const flight = useHeroFlight(heroKey);
  // Heading back to a map view, pop the hero down into its marker — a layout
  // effect so the cleanup can still measure the hero (see the ride page).
  useLayoutEffect(() => () => launchHeroReturn(heroKey), [heroKey]);
  useEffect(() => () => releaseHeroFlight(heroKey), [heroKey]);

  // The phone layout hangs the ticket's crease on the hero's bottom edge, so
  // both boxes need the stub's top-half height — it varies with how many lines
  // the shop's name takes. The ticket measures it; the page publishes it.
  const [crease, setCrease] = React.useState(TICKET_DEFAULT_CREASE);

  // The park this shop stands in, matched on the finder's own location name
  // (`samePark`) — there is no park id on a shop row. It buys the wide column
  // its news card; a resort-hosted store simply doesn't have one.
  const parksQ = useQuery(trpc.parks.list.queryOptions());
  const park = React.useMemo(
    () =>
      shop?.parkResort
        ? (parksQ.data?.find((p) => samePark(shop.parkResort, p.name)) ?? null)
        : null,
    [parksQ.data, shop?.parkResort],
  );

  /**
   * The land, *when there is one*. Disney's finder writes the park's own name
   * into `shop_dim.land` (211 of the 302 active rows have `land = park_resort`);
   * only Universal's rows carry a real land like "San Francisco". So everything
   * on this page that speaks about a land — the place line, the ticket fact, the
   * map panel's title, which siblings the grid floats to the top — asks this
   * rather than the column, or the page ends up saying "Find it in Magic Kingdom
   * Park" on a page whose every other line already says Magic Kingdom Park.
   */
  const land = shop?.land && shop.land !== shop.parkResort ? shop.land : null;

  // Does the wide column have anything in it? `ShopHere` self-hides on an empty
  // park, which would leave a 1fr track beside a 30rem one rather than no grid
  // at all — so the page asks the identical query (same key, so it costs no
  // second round trip) and drops the column with it. Held open while the shop
  // itself is still loading, so the page can't open one-column and snap to two.
  const nearQ = useQuery({
    ...trpc.parks.shopsNear.queryOptions({
      parkResort: shop?.parkResort ?? "",
      land,
      excludeId: shop?.id ?? null,
      limit: 6,
    }),
    enabled: !!shop?.parkResort,
  });
  const hasWide = !shop || (!!shop.parkResort && (!nearQ.data || nearQ.data.length > 0));

  // Data → seed → titleized slug: the seeded values keep a map-launched hero
  // painted (and the flown clones honest) while the query is still in flight.
  const name = shop?.name ?? flight?.seed.name ?? titleizeSlug(slug);
  const placeLine = shop
    ? [shop.parkResort, land].filter(Boolean).join(" · ")
    : (flight?.seed.subtitle ?? null);

  const facets = shop?.merchandise ?? [];
  const chips = facets.slice(1, 1 + TICKET_CHIPS);
  const folded = facets.slice(1 + TICKET_CHIPS);

  // ── Ticket contents ────────────────────────────────────────────────────────
  // Up to three, filled in order of how much they tell you and skipping any the
  // page has no data for (plan §4.9). A shop has one genuine fact — what it
  // sells — so the rest is the stable metadata the rule calls for rather than a
  // guess dressed as a figure, and a Disney shop usually ends up with two.
  // Two honest cells beat three where the third restates the line above it.
  const facts: Array<TicketFact> = [];
  const candidates: Array<TicketFact | null> = [
    facets[0]
      ? {
          label: "Sells",
          value: humanizeFacet(facets[0]),
          hint: facets.length > 1 ? facets.map(humanizeFacet).join(" · ") : undefined,
        }
      : null,
    land ? { label: "Land", value: land } : null,
    facets.length > 1 ? { label: "Categories", value: String(facets.length) } : null,
    // Last, not third. On a Disney shop the place line under the title *is* the
    // park's name and nothing else (the finder writes it into `land` too), so a
    // "Park · Magic Kingdom Park" cell one line below it is the same words
    // twice. It is worth having only for the handful of rows that carry no
    // merchandise at all, where it is the one thing left to print.
    shop?.parkResort ? { label: "Park", value: shop.parkResort } : null,
  ];
  for (const f of candidates) {
    if (facts.length >= 3) break;
    if (f) facts.push(f);
  }

  const canWalk = shop?.latitude != null && shop.longitude != null;
  const hasBar = canWalk || !!shop?.detailUrl;

  return (
    <div
      style={{ "--crease": `${crease}px` } as React.CSSProperties}
      className={cn(
        PAGE_WIDTH,
        "flex flex-col",
        HERO_PAGE_PADDING,
        hasBar ? ACTION_BAR_PAGE_PAD : "pb-4 lg:pb-6",
      )}
    >
      {/* The hero. No overlay chip: the "Shop" pill this page used to print on
          the photograph says nothing a reader who tapped a shop needs told, and
          every other page in this system has moved its badges onto the stub. */}
      <DetailHero
        heroKey={heroKey}
        name={name}
        subtitle={placeLine}
        image={shop?.imageUrl ?? flight?.seed.imageUrl ?? null}
        // Identical across the seeded and loaded renders, so the underlay <img>
        // keeps its src (and stays decoded) across the query landing.
        underlay={flight ? (flight.seed.previewImageUrl ?? flight.seed.cardImageUrl) : null}
        thumbhash={shop?.imageThumbhash}
        flying={flight?.flying ?? false}
        entrance={!!flight}
        tear
        crease="always"
        titleless
        underNav
      />

      <div
        className={cn(
          "flex flex-col gap-5",
          hasWide
            ? "wide:grid wide:grid-cols-[minmax(0,30rem)_minmax(0,1fr)] wide:grid-rows-[auto_1fr] wide:items-start wide:gap-x-6 wide:gap-y-5 xl:grid-cols-[minmax(0,34rem)_minmax(0,1fr)]"
            : "md:max-w-[34rem]",
        )}
      >
        <Ticket
          onCreaseHeight={setCrease}
          // Pulled up by its own top half at every width, so the crease lands on
          // the hero's bottom edge, and nudged past the column's left edge on a
          // desktop so the stub reads as laid *on* the page rather than ruled
          // into the grid.
          className="mt-[calc(var(--crease)*-1)] md:mx-auto md:w-full md:max-w-[34rem] wide:col-start-1 wide:row-start-1 wide:-mx-4.5 wide:w-auto wide:max-w-none"
          heroKey={heroKey}
          titleHidden={flight?.flying ? { opacity: 0, visibility: "hidden" } : undefined}
          title={name}
          subtitle={
            <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
              {placeLine && <span>{placeLine}</span>}
              <TicketChip accent>Shopping</TicketChip>
            </span>
          }
          facts={facts}
          chips={
            chips.length > 0 ? (
              <>
                {chips.map((m) => (
                  <TicketChip key={m}>{humanizeFacet(m)}</TicketChip>
                ))}
                {folded.length > 0 && (
                  <TicketChip title={folded.map(humanizeFacet).join(" · ")}>
                    +{folded.length}
                  </TicketChip>
                )}
              </>
            ) : null
          }
          // The official page is the stub's one key, and it has to be here
          // rather than only in the floating bar: that bar is the *phone's*
          // (`md:hidden`), and without this the desktop page's one outbound
          // link would have nowhere to be pressed.
          keys={
            shop?.detailUrl ? (
              <Button
                variant="ticket"
                size="lg"
                className="w-full"
                render={<a href={shop.detailUrl} target="_blank" rel="noreferrer" />}
              >
                <span className="truncate">Official site</span>
                <ExternalLinkIcon />
              </Button>
            ) : null
          }
        />

        {/* The neighbourhood. It spans both of the grid's rows so it runs up
            beside the ticket into what would otherwise be dead space under the
            hero — the venue and resort pages' own arrangement. Last on a phone
            (`order-3`): it is about somewhere else. Neither card carries a band
            heading; both bring their own, and two stacked read as a heading
            about a heading. */}
        {hasWide && (
          <div className="order-3 flex flex-col gap-5 wide:col-start-2 wide:row-span-2 wide:row-start-1 wide:pt-4">
            <ShopHere
              parkResort={shop?.parkResort ?? null}
              land={land}
              excludeId={shop?.id ?? null}
              title={shop?.parkResort ? `More at ${formatParkName(shop.parkResort)}` : "Shop here"}
            />
            {park?.slug && (
              <ParkNews parkSlug={park.slug} title={`News from ${formatParkName(park.name)}`} />
            )}
          </div>
        )}

        {/* The rest of the narrow column, under the ticket. */}
        <div className="contents wide:col-start-1 wide:row-start-2 wide:flex wide:flex-col wide:gap-5">
          {/* The only thing resembling a job this page has: the full category
              list, once it has outgrown the stub. Under five categories the
              ticket has already said all of them and this would be a panel that
              repeats the block above it. */}
          {facets.length >= WASH_AT && (
            <WashPanel title="What's inside" meta={`${facets.length} categories`}>
              <div className="flex flex-wrap gap-1.5">
                {facets.map((m) => (
                  <span
                    key={m}
                    className="rounded-full bg-background/70 px-3 py-1.5 text-[13px] font-semibold text-wash-fg"
                  >
                    {humanizeFacet(m)}
                  </span>
                ))}
              </div>
            </WashPanel>
          )}

          <div className="order-2 flex flex-col gap-5 wide:contents">
            {/* The shop's own copy — official marketing text, never rewritten.
                UOR stores only until a WDW shop-detail fetch pass exists, so
                most Disney shops show nothing here. */}
            {shop?.description && (
              <p className="text-[15px] leading-[1.45] text-pretty text-muted-foreground md:text-base md:leading-[1.55]">
                {shop.description}
              </p>
            )}

            {/* The exit block. A fair number of carts and kiosks publish no
                coordinates, and the panel simply doesn't render for those. */}
            {canWalk && (
              <TintPanel
                tone="peach"
                pad="tight"
                title={land ? `Find it in ${land}` : "Find it"}
                meta={
                  <WalkThereButton
                    name={shop!.name}
                    latitude={shop!.latitude}
                    longitude={shop!.longitude}
                    variant="yellow"
                    className="h-9 font-bold"
                  />
                }
              >
                <LocationMap
                  latitude={shop!.latitude!}
                  longitude={shop!.longitude!}
                  label={shop!.name}
                  zoom={17}
                  caption={
                    [...new Set([land, shop!.parkResort].filter(Boolean))].join(", ") || undefined
                  }
                  className="h-48 w-full overflow-hidden rounded-[18px] sm:h-56 md:h-[15.5rem]"
                />
              </TintPanel>
            )}

            <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline" className="font-bold" render={<Link to="/map" />}>
                Open the park map
              </Button>
            </div>

            {/* Cast-member-only; renders nothing for everyone else. */}
            {shop && (
              <RemovalRequestDialog
                entityType="shop"
                entityId={shop.id}
                entityName={shop.name}
                className="w-fit"
              />
            )}
          </div>
        </div>
      </div>

      {/* The phone's one-line answer to "so what do I do here". A shop with
          neither coordinates nor an official page gets no bar at all — the
          system allows a page with no primary action (plan §4.9). */}
      {hasBar && (
        <DetailActionBar>
          {canWalk && (
            <WalkThereButton
              name={shop!.name}
              latitude={shop!.latitude}
              longitude={shop!.longitude}
              variant="yellow"
              className="h-12 min-w-0 flex-1 text-[15px] font-bold"
            />
          )}
          {shop?.detailUrl && (
            <Button
              variant={canWalk ? "outline" : "yellow"}
              size="lg"
              className={cn("h-12 text-[15px] font-bold", canWalk ? "shrink-0" : "min-w-0 flex-1")}
              render={<a href={shop.detailUrl} target="_blank" rel="noreferrer" />}
            >
              Official site
              <ExternalLinkIcon />
            </Button>
          )}
        </DetailActionBar>
      )}
    </div>
  );
}
