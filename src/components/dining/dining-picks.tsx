"use client";

import { useQuery } from "@tanstack/react-query";

import { Card } from "#/components/ui/card.tsx";
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
    <Card className="@container/pick group h-full w-44 shrink-0 overflow-hidden p-0 transition-shadow hover:shadow-md">
      <div className="bg-muted h-24 w-full overflow-hidden">
        {venue.imageUrl ? (
          <img
            src={venue.imageUrl}
            alt={venue.name}
            loading="lazy"
            className="size-full object-cover transition-transform group-hover:scale-105"
          />
        ) : null}
      </div>
      <div className="flex flex-col gap-0.5 p-3">
        <span className="line-clamp-1 text-sm font-medium">{venue.name}</span>
        {meta && <span className="text-muted-foreground line-clamp-1 text-xs">{meta}</span>}
        {venue.priceRange && (
          <span className="text-muted-foreground text-xs">{venue.priceRange}</span>
        )}
      </div>
    </Card>
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
 * Curated "Disney Picks" shelves — horizontally scrolling rows grouped by the
 * finder taxonomy (character dining, signature, franchises…). Pure catalog data
 * (`dining.picks`), independent of the availability sweep, shown only while the
 * board is unfiltered.
 */
export function DiningPicks() {
  const trpc = useTRPC();
  const picksQ = useQuery(trpc.dining.picks.queryOptions());

  if (picksQ.isLoading) {
    return (
      <div className="flex flex-col gap-3">
        <Skeleton className="h-5 w-40" />
        <div className="flex gap-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-[164px] w-44 shrink-0 rounded-2xl" />
          ))}
        </div>
      </div>
    );
  }

  const shelves = picksQ.data ?? [];
  if (!shelves.length) return null;

  return (
    <div className="flex flex-col gap-6">
      {shelves.map((shelf) => (
        <section key={shelf.key} className="flex flex-col gap-2">
          <div className="flex items-baseline gap-2">
            <h3 className="text-base font-semibold tracking-tight">{shelf.title}</h3>
            <span className="text-muted-foreground text-xs">{shelf.subtitle}</span>
          </div>
          <div className="-mx-1 flex gap-3 overflow-x-auto px-1 pb-1">
            {shelf.venues.map((v) => (
              <PickCard key={v.facilityId} venue={v} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
