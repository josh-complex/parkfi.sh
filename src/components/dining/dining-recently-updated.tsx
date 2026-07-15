"use client";

import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { formatDistanceToNowStrict } from "date-fns";
import { ReceiptTextIcon } from "lucide-react";

import { menuItemAnchorId } from "#/components/dining/menu-content.tsx";
import { Badge } from "#/components/ui/badge.tsx";
import { Image } from "#/components/ui/image.tsx";
import {
  Carousel,
  CarouselArrows,
  CarouselContent,
  CarouselItem,
} from "#/components/ui/carousel.tsx";
import { Skeleton } from "#/components/ui/skeleton.tsx";
import { useTRPC } from "#/integrations/trpc/react.ts";

type UpdatedVenue = {
  facilityId: string;
  name: string;
  cuisine: string | null;
  parkResort: string | null;
  priceRange: string | null;
  imageUrl: string | null;
  imageThumbhash: string | null;
  bookable: boolean;
  changeCount: number;
  addedCount: number;
  removedCount: number;
  priceCount: number;
  lastChangedAt: string;
  sampleTitles: string[];
};

/**
 * "Recently updated menus" shelves — venues from `dining.recentlyUpdated` (the
 * price-change + item-lifecycle logs rolled up per venue), newest activity
 * first, split into two shelves so reservable restaurants read separately from
 * quick-service spots & snack carts (Aloha Isle, popcorn carts, kiosks…). Cards
 * deep link to the most recently updated menu item (`#menu-<slug>`), falling
 * back to the menu section. Renders nothing until at least one change has been
 * observed, so it stays invisible during cold start.
 */
function ShelfHeader({
  title,
  subtitle,
  withArrows,
}: {
  title: string;
  subtitle: string;
  withArrows?: boolean;
}) {
  return (
    <div className="flex items-end justify-between gap-4 px-4 lg:px-6">
      <div className="flex flex-col gap-0.5">
        <h3 className="text-lg font-semibold tracking-tight">{title}</h3>
        <p className="text-muted-foreground text-sm">{subtitle}</p>
      </div>
      {withArrows && <CarouselArrows className="hidden md:flex" />}
    </div>
  );
}

/**
 * Placeholder shelf shown while `dining.recentlyUpdated` loads, so the section
 * holds its space instead of popping in once data arrives.
 */
function RecentlyUpdatedSkeleton() {
  return (
    <section className="flex flex-col gap-3">
      <ShelfHeader
        title="Recently updated menus"
        subtitle="Fresh prices & items in the last 30 days"
      />
      <div className="flex gap-4 overflow-hidden px-4 lg:px-6">
        {Array.from({ length: 6 }).map((_, i) => (
          <div
            key={i}
            className="flex shrink-0 basis-[42%] flex-col gap-2 md:basis-1/3 lg:basis-1/4 xl:basis-1/5 2xl:basis-1/6"
          >
            <Skeleton className="aspect-[4/3] w-full rounded-2xl" />
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-3 w-1/2" />
            <Skeleton className="h-3 w-2/3" />
          </div>
        ))}
      </div>
    </section>
  );
}

function UpdatedCard({ v }: { v: UpdatedVenue }) {
  return (
    <Link
      to="/dining/$facilityId"
      params={{ facilityId: v.facilityId }}
      hash={v.sampleTitles[0] ? menuItemAnchorId(v.sampleTitles[0]) : "menu"}
      className="block"
    >
      <div className="group flex flex-col gap-2 outline-none">
        <div className="bg-muted relative aspect-[4/3] w-full overflow-hidden rounded-2xl">
          {v.imageUrl ? (
            <Image
              src={v.imageUrl}
              alt={v.name}
              loading="lazy"
              aspect={4 / 3}
              placeholder={v.imageThumbhash}
              className="size-full object-cover group-hover:scale-105"
            />
          ) : null}
          <Badge className="absolute top-2 left-2 gap-1 bg-black/60 text-white text-xs font-normal border-0 shadow-none backdrop-blur-sm">
            <ReceiptTextIcon className="size-3" />
            {v.changeCount} {v.changeCount === 1 ? "update" : "updates"}
          </Badge>
        </div>
        <div className="flex flex-col gap-0.5 px-0.5">
          <span className="line-clamp-1 text-sm font-medium group-hover:underline">{v.name}</span>
          {v.parkResort && (
            <span className="text-muted-foreground line-clamp-1 text-xs">{v.parkResort}</span>
          )}
          <span className="text-muted-foreground/70 text-xs">
            Updated {formatDistanceToNowStrict(new Date(v.lastChangedAt))} ago
          </span>
        </div>
      </div>
    </Link>
  );
}

function UpdatedShelf({
  title,
  subtitle,
  venues,
}: {
  title: string;
  subtitle: string;
  venues: Array<UpdatedVenue>;
}) {
  if (!venues.length) return null;
  return (
    <Carousel opts={{ align: "start", dragFree: true }} className="-mx-4 lg:-mx-6">
      <section className="flex flex-col gap-3">
        <ShelfHeader title={title} subtitle={subtitle} withArrows />
        <CarouselContent
          className="-ml-4"
          viewportClassName="px-4 lg:px-6 [mask-image:linear-gradient(to_right,transparent,#000_1.5rem,#000_calc(100%_-_1.5rem),transparent)]"
        >
          {venues.map((v) => (
            <CarouselItem
              key={v.facilityId}
              className="basis-[42%] pl-4 md:basis-1/3 lg:basis-1/4 xl:basis-1/5 2xl:basis-1/6"
            >
              <UpdatedCard v={v} />
            </CarouselItem>
          ))}
        </CarouselContent>
      </section>
    </Carousel>
  );
}

export function DiningRecentlyUpdated() {
  const trpc = useTRPC();
  // Fetch each shelf independently so table-service restaurants and
  // quick-service/carts each get their own `limit`, rather than competing for a
  // single shared budget where the more active carts crowd restaurants out.
  const restaurantsQ = useQuery(
    trpc.dining.recentlyUpdated.queryOptions({ sinceDays: 30, limit: 18, bookable: true }),
  );
  const cartsQ = useQuery(
    trpc.dining.recentlyUpdated.queryOptions({ sinceDays: 30, limit: 18, bookable: false }),
  );
  const restaurants = (restaurantsQ.data ?? []) as Array<UpdatedVenue>;
  const carts = (cartsQ.data ?? []) as Array<UpdatedVenue>;

  if (restaurantsQ.isLoading || cartsQ.isLoading) return <RecentlyUpdatedSkeleton />;
  if (!restaurants.length && !carts.length) return null;

  return (
    <div className="flex flex-col gap-4">
      <UpdatedShelf
        title="Recently updated restaurants"
        subtitle="Fresh updates at restaurants in the last 30 days"
        venues={restaurants}
      />
      <UpdatedShelf
        title="Recently updated quick service"
        subtitle="What's new at snack carts, kiosks & quick-service spots"
        venues={carts}
      />
    </div>
  );
}
