"use client";

import { useQuery } from "@tanstack/react-query";

import {
  Carousel,
  CarouselArrows,
  CarouselContent,
  CarouselItem,
} from "#/components/ui/carousel.tsx";
import { Skeleton } from "#/components/ui/skeleton.tsx";
import { useTRPC } from "#/integrations/trpc/react.ts";

interface PickVenue {
  facilityId: string;
  name: string;
  cuisine: string | null;
  parkResort: string | null;
  priceRange: string | null;
  imageUrl: string | null;
  detailUrl: string | null;
}

function PickCard({ venue }: { venue: PickVenue }) {
  const meta = [venue.parkResort, venue.cuisine].filter(Boolean).join(" · ");
  const body = (
    <div className="group flex flex-col gap-2 outline-none">
      <div className="bg-muted aspect-[4/3] w-full overflow-hidden rounded-2xl">
        {venue.imageUrl ? (
          <img
            src={venue.imageUrl}
            alt={venue.name}
            loading="lazy"
            className="size-full object-cover transition-transform duration-300 group-hover:scale-105"
          />
        ) : null}
      </div>
      <div className="flex flex-col gap-0.5 px-0.5">
        <span className="line-clamp-1 text-sm font-medium group-hover:underline">{venue.name}</span>
        {meta && <span className="text-muted-foreground line-clamp-1 text-xs">{meta}</span>}
        {venue.priceRange && (
          <span className="text-muted-foreground text-xs">{venue.priceRange}</span>
        )}
      </div>
    </div>
  );
  return venue.detailUrl ? (
    <a href={venue.detailUrl} target="_blank" rel="noreferrer" className="block">
      {body}
    </a>
  ) : (
    body
  );
}

/**
 * Curated "Disney Picks" shelves — click-to-scroll carousels (arrows on desktop,
 * drag on mobile) grouped by the finder taxonomy (character dining, signature,
 * franchises…). Pure catalog data (`dining.picks`), independent of the
 * availability sweep, shown only while the board is pre-search.
 */
export function DiningPicks() {
  const trpc = useTRPC();
  const picksQ = useQuery(trpc.dining.picks.queryOptions());

  if (picksQ.isLoading) {
    return (
      <div className="flex flex-col gap-10">
        {Array.from({ length: 3 }).map((_, g) => (
          <div key={g} className="flex flex-col gap-4">
            <Skeleton className="h-6 w-56" />
            <div className="grid grid-cols-2 gap-4 md:grid-cols-4 lg:grid-cols-5">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="aspect-[4/3] rounded-2xl" />
              ))}
            </div>
          </div>
        ))}
      </div>
    );
  }

  const shelves = picksQ.data ?? [];
  if (!shelves.length) return null;

  return (
    <div className="flex flex-col gap-2">
      {shelves.map((shelf) => (
        <Carousel key={shelf.key} opts={{ align: "start", dragFree: true }} className="w-full">
          <section className="flex flex-col gap-3 py-4">
            <div className="flex items-end justify-between gap-4">
              <div className="flex flex-col gap-0.5">
                <h3 className="text-lg font-semibold tracking-tight">{shelf.title}</h3>
                <p className="text-muted-foreground text-sm">{shelf.subtitle}</p>
              </div>
              <CarouselArrows className="hidden md:flex" />
            </div>
            <CarouselContent className="-ml-4">
              {shelf.venues.map((v) => (
                <CarouselItem
                  key={v.facilityId}
                  className="basis-1/2 pl-4 md:basis-1/3 lg:basis-1/4 xl:basis-1/5"
                >
                  <PickCard venue={v} />
                </CarouselItem>
              ))}
            </CarouselContent>
          </section>
        </Carousel>
      ))}
    </div>
  );
}
