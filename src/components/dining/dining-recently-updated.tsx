"use client";

import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { formatDistanceToNowStrict } from "date-fns";
import { ReceiptTextIcon } from "lucide-react";

import { menuItemAnchorId } from "#/components/dining/menu-content.tsx";
import { Badge } from "#/components/ui/badge.tsx";
import {
  Carousel,
  CarouselArrows,
  CarouselContent,
  CarouselItem,
} from "#/components/ui/carousel.tsx";
import { Skeleton } from "#/components/ui/skeleton.tsx";
import { useTRPC } from "#/integrations/trpc/react.ts";

/**
 * "Recently updated menus" shelf — venues from `dining.recentlyUpdated` (the
 * price-change log rolled up per restaurant), newest activity first. Cards deep
 * link to the most recently updated menu item (`#menu-<slug>`) so the detail
 * page scrolls to and highlights that price, falling back to the menu section
 * (`#menu`) when no item title is available. Renders nothing until at least one
 * price change has been observed, so it stays invisible during cold start.
 */
/**
 * Section header, shared by the loaded shelf and its loading skeleton. The
 * carousel arrows only render inside a `<Carousel>` (they read its context), so
 * the skeleton omits them.
 */
function ShelfHeader({ withArrows }: { withArrows?: boolean }) {
  return (
    <div className="flex items-end justify-between gap-4 px-4 lg:px-6">
      <div className="flex flex-col gap-0.5">
        <h3 className="text-lg font-semibold tracking-tight">Recently updated menus</h3>
        <p className="text-muted-foreground text-sm">
          Fresh prices &amp; items spotted in the last 30 days
        </p>
      </div>
      {withArrows && <CarouselArrows className="hidden md:flex" />}
    </div>
  );
}

/**
 * Placeholder shelf shown while `dining.recentlyUpdated` loads, so the section
 * holds its space instead of popping in once data arrives. Mirrors the real
 * card layout (image tile + text lines) and the carousel basis widths.
 */
function RecentlyUpdatedSkeleton() {
  return (
    <section className="flex flex-col gap-3">
      <ShelfHeader />
      <div className="flex gap-4 overflow-hidden px-4 lg:px-6">
        {Array.from({ length: 6 }).map((_, i) => (
          <div
            key={i}
            className="flex shrink-0 basis-[42%] flex-col gap-2 md:basis-1/3 lg:basis-1/4 xl:basis-1/5"
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

export function DiningRecentlyUpdated() {
  const trpc = useTRPC();
  const updatedQ = useQuery(trpc.dining.recentlyUpdated.queryOptions({ sinceDays: 30, limit: 12 }));
  const venues = updatedQ.data ?? [];
  if (updatedQ.isLoading) return <RecentlyUpdatedSkeleton />;
  if (!venues.length) return null;

  return (
    <Carousel opts={{ align: "start", dragFree: true }} className="-mx-4 lg:-mx-6">
      <section className="flex flex-col gap-3">
        <ShelfHeader withArrows />
        <CarouselContent
          className="-ml-4"
          viewportClassName="px-4 lg:px-6 [mask-image:linear-gradient(to_right,transparent,#000_1.5rem,#000_calc(100%_-_1.5rem),transparent)]"
        >
          {venues.map((v) => {
            // Compact activity breakdown for the card, most-notable first.
            const segments = [
              v.addedCount > 0 && `${v.addedCount} new`,
              v.removedCount > 0 && `${v.removedCount} removed`,
              v.priceCount > 0 && `${v.priceCount} price`,
              v.renamedCount > 0 && `${v.renamedCount} renamed`,
            ].filter(Boolean) as Array<string>;
            return (
              <CarouselItem
                key={v.facilityId}
                className="basis-[42%] pl-4 md:basis-1/3 lg:basis-1/4 xl:basis-1/5"
              >
                <Link
                  to="/dining/$facilityId"
                  params={{ facilityId: v.facilityId }}
                  hash={v.sampleTitles[0] ? menuItemAnchorId(v.sampleTitles[0]) : "menu"}
                  className="block"
                >
                  <div className="group flex flex-col gap-2 outline-none">
                    <div className="bg-muted relative aspect-[4/3] w-full overflow-hidden rounded-2xl">
                      {v.imageUrl ? (
                        <img
                          src={v.imageUrl}
                          alt={v.name}
                          loading="lazy"
                          className="size-full object-cover transition-transform duration-300 group-hover:scale-105"
                        />
                      ) : null}
                      <Badge className="absolute top-2 left-2 gap-1 bg-black/60 text-white text-xs font-normal border-0 shadow-none backdrop-blur-sm">
                        <ReceiptTextIcon className="size-3" />
                        {v.changeCount} {v.changeCount === 1 ? "update" : "updates"}
                      </Badge>
                    </div>
                    <div className="flex flex-col gap-0.5 px-0.5">
                      <span className="line-clamp-1 text-sm font-medium group-hover:underline">
                        {v.name}
                      </span>
                      {v.parkResort && (
                        <span className="text-muted-foreground line-clamp-1 text-xs">
                          {v.parkResort}
                        </span>
                      )}
                      {segments.length > 0 && (
                        <span className="line-clamp-1 text-xs font-medium text-foreground/70">
                          {segments.join(" · ")}
                        </span>
                      )}
                      {v.sampleTitles.length > 0 && (
                        <span className="text-muted-foreground line-clamp-1 text-xs">
                          {v.sampleTitles.join(" · ")}
                        </span>
                      )}
                      <span className="text-muted-foreground/70 text-xs">
                        Updated {formatDistanceToNowStrict(new Date(v.lastChangedAt))} ago
                      </span>
                    </div>
                  </div>
                </Link>
              </CarouselItem>
            );
          })}
        </CarouselContent>
      </section>
    </Carousel>
  );
}
