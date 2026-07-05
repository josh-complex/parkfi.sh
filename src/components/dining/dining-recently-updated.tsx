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
import { useTRPC } from "#/integrations/trpc/react.ts";

/**
 * "Recently updated menus" shelf — venues from `dining.recentlyUpdated` (the
 * price-change log rolled up per restaurant), newest activity first. Cards deep
 * link to the most recently updated menu item (`#menu-<slug>`) so the detail
 * page scrolls to and highlights that price, falling back to the menu section
 * (`#menu`) when no item title is available. Renders nothing until at least one
 * price change has been observed, so it stays invisible during cold start.
 */
export function DiningRecentlyUpdated() {
  const trpc = useTRPC();
  const updatedQ = useQuery(trpc.dining.recentlyUpdated.queryOptions({ sinceDays: 30, limit: 12 }));
  const venues = updatedQ.data ?? [];
  if (!venues.length) return null;

  return (
    <Carousel opts={{ align: "start", dragFree: true }} className="-mx-4 lg:-mx-6">
      <section className="flex flex-col gap-3">
        <div className="flex items-end justify-between gap-4 px-4 lg:px-6">
          <div className="flex flex-col gap-0.5">
            <h3 className="text-lg font-semibold tracking-tight">Recently updated menus</h3>
            <p className="text-muted-foreground text-sm">
              Fresh prices &amp; items spotted in the last 30 days
            </p>
          </div>
          <CarouselArrows className="hidden md:flex" />
        </div>
        <CarouselContent
          className="-ml-4"
          viewportClassName="px-4 lg:px-6 [mask-image:linear-gradient(to_right,transparent,#000_1.5rem,#000_calc(100%_-_1.5rem),transparent)]"
        >
          {venues.map((v) => (
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
          ))}
        </CarouselContent>
      </section>
    </Carousel>
  );
}
