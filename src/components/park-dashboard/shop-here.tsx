"use client";

import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ShoppingBagIcon } from "lucide-react";

import { Image } from "#/components/ui/image.tsx";
import { Skeleton } from "#/components/ui/skeleton.tsx";
import { useTRPC } from "#/integrations/trpc/react.ts";
import { disneyResizeUrl } from "#/lib/image.ts";
import { cn } from "#/lib/utils.ts";

/**
 * Tiles in the grid. Six, and the same six `EatHere` draws, for the same
 * reason: it divides two ways, so the card reads as a grid whether it is
 * sitting in a detail page's narrow column or spanning a tablet.
 */
const TILES = 6;

/** "apparel-accessories" → "Apparel & Accessories". */
export function humanizeFacet(facet: string): string {
  return facet
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ")
    .replace(/\band\b/gi, "&");
}

function ShopHereSkeleton({ title, className }: { title: string; className?: string }) {
  return (
    <section
      className={cn(
        "@container/shop flex flex-col overflow-hidden rounded-[22px] border border-card-edge bg-card",
        className,
      )}
    >
      <div className="flex items-center justify-between gap-3 px-4 pt-4 pb-1 @md/shop:px-5 @md/shop:pt-5">
        <h2 className="flex min-w-0 items-center gap-2 text-[19px] font-extrabold tracking-[-0.01em]">
          <ShoppingBagIcon className="size-4 shrink-0 text-muted-foreground" />
          {title}
        </h2>
      </div>
      <Skeleton className="mx-4 mt-2 h-3 w-40 rounded @md/shop:mx-5" />
      <div className="grid grid-cols-2 gap-2 p-2 @md/shop:gap-4 @md/shop:p-4 @3xl/shop:grid-cols-3">
        {Array.from({ length: TILES }).map((_, i) => (
          <Skeleton key={i} className="aspect-[4/3] w-full rounded-2xl" />
        ))}
      </div>
    </section>
  );
}

/**
 * "Shop here" — the rest of the shops in this shop's park, as a grid of
 * photographs. `EatHere`'s card over merchandise rather than menus, and
 * deliberately the same card: a tile should mean the same thing wherever the
 * app draws one.
 *
 * What it does *not* carry is the change flag its dining sibling leads with.
 * We track menus; we don't track stock, so there is no "3 new items" to say
 * about a shop, and inventing a flag to fill the slot would be the one thing
 * the grid can't afford — a badge nobody can trust.
 *
 * Self-hides when the park has no other linkable shop.
 */
export function ShopHere({
  parkResort,
  land,
  excludeId,
  title = "Shop here",
  className,
}: {
  /** The finder's location name, as `shop_dim` spells it. */
  parkResort: string | null;
  /**
   * Float this land's shops to the front of the grid. Pass a *real* land only —
   * Disney's `shop_dim.land` is the park's own name on two thirds of rows, and
   * "6 more in Magic Kingdom Park" is not a thing to say about a park page.
   */
  land?: string | null;
  /** The shop the reader is already on. */
  excludeId?: string | null;
  title?: string;
  className?: string;
}) {
  const trpc = useTRPC();
  const q = useQuery({
    ...trpc.parks.shopsNear.queryOptions({
      parkResort: parkResort ?? "",
      land: land ?? null,
      excludeId: excludeId ?? null,
      limit: TILES,
    }),
    enabled: !!parkResort,
  });

  // Reserve the card's box while the query is out, and test the *data* rather
  // than `isLoading` — on the server the query never fetches, so `isLoading` is
  // false there and true on the client's first render, which is a hydration
  // mismatch. "No data yet" is true in both. (Same guard as `ParkNews`.)
  if (!parkResort) return null;
  if (!q.data) return <ShopHereSkeleton title={title} className={className} />;

  // An odd tile leaves a half-empty final row and the grid is the whole point,
  // so trim to a pair boundary once there is more than one row.
  const rows = q.data;
  const tiles = rows.length > 2 ? rows.slice(0, rows.length - (rows.length % 2)) : rows;
  if (tiles.length === 0) return null;

  const sameLand = land ? rows.filter((s) => s.land === land).length : 0;

  return (
    <section
      className={cn(
        "@container/shop flex flex-col overflow-hidden rounded-[22px] border border-card-edge bg-card",
        className,
      )}
    >
      <div className="flex items-center justify-between gap-3 px-4 pt-4 pb-1 @md/shop:px-5 @md/shop:pt-5">
        <h2 className="flex min-w-0 items-center gap-2 text-[19px] font-extrabold tracking-[-0.01em]">
          <ShoppingBagIcon className="size-4 shrink-0 text-muted-foreground" />
          {title}
        </h2>
      </div>
      <p className="px-4 pb-1 text-xs text-muted-foreground @md/shop:px-5">
        {sameLand > 0
          ? `${sameLand} more in ${land}, then the rest of the park`
          : "More stores around the park"}
      </p>

      <div className="grid grid-cols-2 gap-2 p-2 @md/shop:gap-4 @md/shop:p-4 @3xl/shop:grid-cols-3">
        {tiles.map((s) => (
          <Link
            key={s.id}
            to="/shop/$slug"
            params={{ slug: s.slug }}
            className="group relative isolate block aspect-[4/3] overflow-hidden rounded-2xl bg-muted"
          >
            {s.imageUrl && (
              <Image
                src={disneyResizeUrl(s.imageUrl, 400)}
                alt={s.name}
                loading="lazy"
                aspect={4 / 3}
                placeholder={s.imageThumbhash ?? undefined}
                className="size-full object-cover transition-transform duration-500 group-hover:scale-[1.05]"
              />
            )}
            <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/25 to-transparent" />
            <div className="absolute inset-x-0 bottom-0 flex flex-col gap-0.5 p-2.5">
              <span className="line-clamp-2 text-[13px] leading-tight font-bold text-white">
                {s.name}
              </span>
              {/* The land when it is one, otherwise what the store sells.
                  Disney's finder writes the park's own name into `land`, and a
                  grid of six tiles all captioned "Magic Kingdom Park" under a
                  heading that already says Magic Kingdom Park is six wasted
                  lines — so `parkResort` is filtered out here the same way the
                  detail page filters it (see its `land`). */}
              <span className="line-clamp-1 text-[11px] text-white/70">
                {(s.land && s.land !== parkResort ? s.land : null) ??
                  (s.merchandise[0] ? humanizeFacet(s.merchandise[0]) : "")}
              </span>
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}
