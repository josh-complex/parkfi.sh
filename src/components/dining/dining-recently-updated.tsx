"use client";

import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { formatDistanceToNowStrict } from "date-fns";
import { ReceiptTextIcon } from "lucide-react";

import { menuItemAnchorId } from "#/components/dining/menu-content.tsx";
import { Badge } from "#/components/ui/badge.tsx";
import { Image } from "#/components/ui/image.tsx";
import { Skeleton } from "#/components/ui/skeleton.tsx";
import { cn } from "#/lib/utils.ts";
import {
  RAIL_ITEM_BASIS,
  SHELF_VIEWPORT,
  RAIL_MEDIA_ASPECT,
  RAIL_MEDIA_RATIO,
  RailCard,
  RailCardBody,
  RailCardMedia,
  RailCardMeta,
  RailCardTitle,
  RailItem,
  RailShelf,
  RailShelfHeader,
  RailTrack,
} from "#/components/ui/rail.tsx";
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

/**
 * Placeholder shelf shown while `dining.recentlyUpdated` loads, so the section
 * holds its space instead of popping in once data arrives.
 */
function RecentlyUpdatedSkeleton() {
  return (
    <section className="flex flex-col gap-3">
      <RailShelfHeader
        title="Recently updated menus"
        subtitle="Fresh prices & items in the last 30 days"
        arrows={false}
      />
      <div className={cn("flex gap-4 overflow-hidden", SHELF_VIEWPORT)}>
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className={cn("flex shrink-0 flex-col gap-2", RAIL_ITEM_BASIS)}>
            <Skeleton className={cn(RAIL_MEDIA_ASPECT, "w-full rounded-2xl")} />
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
      <RailCard>
        <RailCardMedia>
          {v.imageUrl ? (
            <Image
              src={v.imageUrl}
              alt={v.name}
              loading="lazy"
              aspect={RAIL_MEDIA_RATIO}
              placeholder={v.imageThumbhash}
              className="size-full object-cover group-hover:scale-105"
            />
          ) : null}
          <Badge className="absolute top-2 left-2 gap-1 bg-black/60 text-white text-xs font-normal border-0 shadow-none backdrop-blur-sm">
            <ReceiptTextIcon className="size-3" />
            {v.changeCount} {v.changeCount === 1 ? "update" : "updates"}
          </Badge>
        </RailCardMedia>
        <RailCardBody>
          <RailCardTitle>{v.name}</RailCardTitle>
          {v.parkResort && <RailCardMeta>{v.parkResort}</RailCardMeta>}
          <span className="text-muted-foreground/70 text-xs">
            Updated {formatDistanceToNowStrict(new Date(v.lastChangedAt))} ago
          </span>
        </RailCardBody>
      </RailCard>
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
    <RailShelf>
      <RailShelfHeader title={title} subtitle={subtitle} />
      <RailTrack>
        {venues.map((v) => (
          <RailItem key={v.facilityId}>
            <UpdatedCard v={v} />
          </RailItem>
        ))}
      </RailTrack>
    </RailShelf>
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
      {/* Second shelf stays eager: two shelves fill the first viewport so a
          navigation lands on real content, and the picks shelves below are the
          ones that defer. */}
      <UpdatedShelf
        title="Recently updated quick service"
        subtitle="What's new at snack carts, kiosks & quick-service spots"
        venues={carts}
      />
    </div>
  );
}
