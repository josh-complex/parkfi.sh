"use client";

import * as React from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowRightIcon, UtensilsCrossedIcon } from "lucide-react";

import { Image } from "#/components/ui/image.tsx";
import { Skeleton } from "#/components/ui/skeleton.tsx";
import { useTRPC } from "#/integrations/trpc/react.ts";
import { disneyResizeUrl } from "#/lib/image.ts";
import { samePark } from "#/lib/parks.ts";
import { cn } from "#/lib/utils.ts";

/**
 * Tiles in the grid — three rows of two, or two rows of three once the card
 * itself is 48rem wide (`@3xl/eat`). Six is chosen to divide both ways: the
 * card runs at ~480px in a detail page's narrow column and at the full page
 * width on a tablet, and the grid answers to *its* box rather than to the
 * viewport, since those two widths sit on the same side of every `md:`.
 * Never four across — 6/4 leaves a widowed row.
 */
const TILES = 6;
/** "This week" — the window the card's change flags claim. */
const SINCE_DAYS = 7;
/**
 * Enough of the park's catalog to fill the grid after the changed venues.
 * Exported so a page that must know *whether* this card will render anything
 * can ask the identical query and hit the same cache entry — the resort page
 * withholds its whole wide column when a resort has no kitchens of its own.
 */
export const EAT_HERE_CATALOG_LIMIT = 24;

interface Counts {
  addedCount: number;
  removedCount: number;
  priceCount: number;
}

/**
 * One flag per changed venue, not three.
 *
 * The list this card replaced spelled out every count ("2 added, 3 removed, 6
 * price changes"), which is the right amount of detail for a row and far too
 * much for a chip sitting on a photograph. So the flag states the most
 * interesting thing that happened and the venue page carries the rest: a new
 * item is worth walking over for, a pulled one is worth knowing before you do,
 * and a price move is neither — which is exactly the order they're tested in.
 */
function changeFlag(counts: Counts): { label: string; className: string } | null {
  if (counts.addedCount > 0) {
    return {
      label: `${counts.addedCount} new ${counts.addedCount === 1 ? "item" : "items"}`,
      className: "bg-mint text-mint-fg",
    };
  }
  if (counts.removedCount > 0) {
    // A minus sign, not a hyphen: it sits on the digits' own baseline and width.
    return {
      label: `−${counts.removedCount} pulled`,
      className: "bg-peach text-peach-fg",
    };
  }
  if (counts.priceCount > 0) {
    return {
      label: `${counts.priceCount} repriced`,
      className: "bg-wash text-wash-fg",
    };
  }
  return null;
}

interface Tile {
  facilityId: string;
  name: string;
  imageUrl: string | null;
  imageThumbhash: string | null;
  /** The flag and the date, when this venue's menu moved inside the window. */
  flag: { label: string; className: string; at: string } | null;
  /** What the venue *is* — carried by the tiles that have no news to carry. */
  meta: string | null;
}

/** "Italian · $$" — whatever of the two the catalog actually holds. */
function venueMeta(cuisine: string | null, priceRange: string | null): string | null {
  return [cuisine, priceRange].filter(Boolean).join(" · ") || null;
}

/** The card's own shape in grey — see `ParkNewsSkeleton`. */
function EatHereSkeleton({ title, className }: { title: string; className?: string }) {
  return (
    <section
      className={cn(
        "@container/eat flex flex-col overflow-hidden rounded-[22px] border border-card-edge bg-card",
        className,
      )}
    >
      <div className="flex items-center justify-between gap-3 px-4 pt-4 pb-1 @md/eat:px-5 @md/eat:pt-5">
        <h2 className="flex min-w-0 items-center gap-2 text-[19px] font-extrabold tracking-[-0.01em]">
          <UtensilsCrossedIcon className="size-4 shrink-0 text-muted-foreground" />
          {title}
        </h2>
      </div>
      <Skeleton className="mx-4 mt-2 h-3 w-48 rounded @md/eat:mx-5" />
      <div className="grid grid-cols-2 gap-2 p-2 @md/eat:gap-4 @md/eat:p-4 @3xl/eat:grid-cols-3">
        {Array.from({ length: TILES }).map((_, i) => (
          <Skeleton key={i} className="aspect-[4/3] w-full rounded-2xl" />
        ))}
      </div>
    </section>
  );
}

/**
 * "Eat here" — the park's restaurants as a grid of photographs, with the ones
 * whose menus moved this week leading and flagged.
 *
 * Two deliberate departures from what this was (2026-09-16, Josh):
 *
 * **Media forward, not list forward.** It used to be four rows of 56px
 * thumbnails beside two lines of grey type. Restaurants are the one thing on a
 * park page that people choose with their eyes, and a thumbnail that small is a
 * bullet with a picture glued to it. The grid gives every venue a real frame.
 *
 * **It no longer shrinks to a stub.** Menu diffs are the card's *lead*, not its
 * contents: a park with one changed menu this week used to render a card with
 * one row in it, which reads as a broken feed rather than as a quiet week. The
 * changed venues fill what they fill and `dining.byPark` fills the rest, so the
 * card is the same size at Magic Kingdom on a busy week and at Islands of
 * Adventure on a dead one.
 *
 * Renders nothing only when we hold no venues for this park at all.
 *
 * Shared with the dining venue page, which runs it as "More here" over the same
 * park minus the venue you are standing on (`excludeFacilityId`) — one grid, so
 * a tile means the same thing on both pages.
 */
export function EatHere({
  parkName,
  excludeFacilityId,
  title = "Eat here",
  className,
}: {
  parkName: string | null;
  /** Drop one venue from the grid — the page you are already on. */
  excludeFacilityId?: string;
  /** The card's heading. The park page's default names the park you're in. */
  title?: string;
  className?: string;
}) {
  const trpc = useTRPC();
  const changedQ = useQuery(
    trpc.dining.recentlyUpdated.queryOptions({ sinceDays: SINCE_DAYS, limit: 50 }),
  );
  const catalogQ = useQuery({
    ...trpc.dining.byPark.queryOptions({ parkName: parkName ?? "", limit: EAT_HERE_CATALOG_LIMIT }),
    enabled: !!parkName,
  });

  const { tiles, changedCount } = React.useMemo(() => {
    if (!parkName) return { tiles: [] as Array<Tile>, changedCount: 0 };

    // The cross-resort rollup carries no park id, so it's matched by the
    // finder's own location name (see `samePark`).
    const changed = (changedQ.data ?? [])
      .filter((v) => samePark(v.parkResort, parkName))
      .filter((v) => v.facilityId !== excludeFacilityId);
    const out: Array<Tile> = [];
    // Seeded with the venue to drop, so neither pass can re-add it.
    const seen = new Set<string>(excludeFacilityId ? [excludeFacilityId] : []);

    for (const v of changed) {
      const flag = changeFlag(v);
      if (!flag) continue;
      seen.add(v.facilityId);
      out.push({
        facilityId: v.facilityId,
        name: v.name,
        imageUrl: v.imageUrl,
        imageThumbhash: v.imageThumbhash,
        flag: { ...flag, at: v.lastChangedAt },
        meta: venueMeta(v.cuisine, v.priceRange),
      });
    }

    // Fill the rest of the grid from the park's own catalog. `byPark` already
    // sorts photo-bearing, headline venues first, so this takes them in order.
    for (const v of catalogQ.data ?? []) {
      if (out.length >= TILES) break;
      if (seen.has(v.facilityId)) continue;
      seen.add(v.facilityId);
      out.push({
        facilityId: v.facilityId,
        name: v.name,
        imageUrl: v.imageUrl,
        imageThumbhash: v.imageThumbhash,
        flag: null,
        meta: venueMeta(v.cuisine, v.priceRange),
      });
    }

    // An odd tile would leave a half-empty final row, and the grid is the whole
    // point — so trim to a pair boundary once there is more than one row.
    const paired = out.length > 2 ? out.length - (out.length % 2) : out.length;
    return { tiles: out.slice(0, Math.min(paired, TILES)), changedCount: changed.length };
  }, [changedQ.data, catalogQ.data, parkName, excludeFacilityId]);

  // Reserve the grid while either query is out — see `ParkNewsSkeleton` for why
  // this tests the data rather than `isLoading`.
  if (!changedQ.data || (!!parkName && !catalogQ.data)) {
    return <EatHereSkeleton title={title} className={className} />;
  }
  if (tiles.length === 0) return null;

  return (
    <section
      className={cn(
        "@container/eat flex flex-col overflow-hidden rounded-[22px] border border-card-edge bg-card",
        className,
      )}
    >
      <div className="flex items-center justify-between gap-3 px-4 pt-4 pb-1 @md/eat:px-5 @md/eat:pt-5">
        <h2 className="flex min-w-0 items-center gap-2 text-[19px] font-extrabold tracking-[-0.01em]">
          <UtensilsCrossedIcon className="size-4 shrink-0 text-muted-foreground" />
          {title}
        </h2>
        {/* Mirrors Park news' "All posts" directly above it — the two cards
            close the column together, and a footer link on one and a header
            link on the other reads as two cards designed apart. */}
        <Link
          to="/dining"
          className="group flex shrink-0 items-center gap-1 text-xs font-bold text-wash-fg hover:underline"
        >
          All menus
          <ArrowRightIcon className="size-3.5 transition-transform group-hover:translate-x-0.5" />
        </Link>
      </div>
      <p className="px-4 pb-1 text-xs text-muted-foreground @md/eat:px-5">
        {changedCount > 0
          ? `${changedCount} ${changedCount === 1 ? "menu" : "menus"} moved here this week`
          : "No menu here has moved this week"}
      </p>

      <div className="grid grid-cols-2 gap-2 p-2 @md/eat:gap-4 @md/eat:p-4 @3xl/eat:grid-cols-3">
        {tiles.map((t) => (
          <Link
            key={t.facilityId}
            to="/dining/$facilityId"
            params={{ facilityId: t.facilityId }}
            className="group relative isolate block aspect-[4/3] overflow-hidden rounded-2xl bg-muted"
          >
            {t.imageUrl && (
              <Image
                src={disneyResizeUrl(t.imageUrl, 400)}
                alt={t.name}
                loading="lazy"
                aspect={4 / 3}
                placeholder={t.imageThumbhash ?? undefined}
                className="size-full object-cover transition-transform duration-500 group-hover:scale-[1.05]"
              />
            )}
            <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/25 to-transparent" />
            {t.flag && (
              <span
                className={cn(
                  "absolute top-2 left-2 rounded-full px-2 py-0.5 text-[10.5px] font-bold tabular-nums",
                  t.flag.className,
                )}
              >
                {t.flag.label}
              </span>
            )}
            <div className="absolute inset-x-0 bottom-0 flex flex-col gap-0.5 p-2.5">
              <span className="line-clamp-2 text-[13px] leading-tight font-bold text-white">
                {t.name}
              </span>
              <span className="line-clamp-1 text-[11px] text-white/70">
                {t.flag
                  ? `Updated ${new Date(t.flag.at).toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                    })}`
                  : t.meta}
              </span>
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}
