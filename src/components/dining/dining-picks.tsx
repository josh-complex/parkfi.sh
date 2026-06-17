"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { useStore } from "@tanstack/react-store";
import { CalendarDaysIcon } from "lucide-react";

import { priceTier } from "#/components/dining/dining-filters.ts";
import {
  OPEN_STATUS_LABELS,
  openStatus,
  openStatusDetail,
  parkNowMinutes,
  type ScheduleEntry,
} from "#/components/dining/dining-hours.ts";
import { diningStore } from "#/components/dining/dining-store.ts";
import { cn } from "#/lib/utils.ts";
import { Badge } from "#/components/ui/badge.tsx";
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

/** "YYYY-MM-DD" → "Today" / "Tomorrow" / "Jun 21" relative to the reference day. */
function formatNextAvail(date: string, referenceDate: string): string {
  const ref = new Date(`${referenceDate}T00:00:00`);
  const d = new Date(`${date}T00:00:00`);
  const dayDiff = Math.round((d.getTime() - ref.getTime()) / 86_400_000);
  if (dayDiff <= 0) return "Today";
  if (dayDiff === 1) return "Tomorrow";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function PickCard({
  venue,
  nextAvail,
  schedules,
  nowMin,
}: {
  venue: PickVenue;
  nextAvail: string | undefined;
  schedules: Array<ScheduleEntry> | undefined;
  nowMin: number;
}) {
  const tier = priceTier(venue.priceRange);
  const status = schedules ? openStatus(schedules, nowMin) : "closed";
  const statusDetail = schedules ? openStatusDetail(schedules, nowMin) : "Closed today";
  const body = (
    <div className="group flex flex-col gap-2 outline-none">
      <div className="bg-muted relative aspect-[4/3] w-full overflow-hidden rounded-2xl">
        {venue.imageUrl ? (
          <img
            src={venue.imageUrl}
            alt={venue.name}
            loading="lazy"
            className="size-full object-cover transition-transform duration-300 group-hover:scale-105"
          />
        ) : null}
        {tier && (
          <Badge className="absolute top-2 left-2 bg-black/60 text-white text-xs font-normal border-0 shadow-none backdrop-blur-sm">
            {tier}
          </Badge>
        )}
        <Badge
          title={statusDetail}
          className={cn(
            "absolute top-2 right-2 text-xs font-normal border-0 shadow",
            status === "open" && "bg-emerald-500 text-white",
            status === "closes-soon" && "bg-amber-500 text-white",
            status === "opens-soon" && "bg-sky-500 text-white",
            status === "closed" && "bg-black/60 text-white backdrop-blur-sm",
          )}
        >
          {OPEN_STATUS_LABELS[status]}
        </Badge>
        {nextAvail && (
          <Badge className="absolute bottom-2 left-2 gap-1 bg-emerald-500 text-white text-xs font-normal border-0 shadow">
            <CalendarDaysIcon className="size-3" />
            Available {nextAvail}
          </Badge>
        )}
      </div>
      <div className="flex flex-col gap-0.5 px-0.5">
        <span className="line-clamp-1 text-sm font-medium group-hover:underline">{venue.name}</span>
        {venue.parkResort && (
          <span className="text-muted-foreground line-clamp-1 text-xs">{venue.parkResort}</span>
        )}
        {venue.cuisine && (
          <span className="text-muted-foreground line-clamp-1 text-xs">{venue.cuisine}</span>
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
  const partySize = useStore(diningStore, (s) => s.partySize);
  const picksQ = useQuery(trpc.dining.picks.queryOptions());

  // Soonest open service date per facility, for the availability chip. Shares the
  // query key with the board's post-search sweep, so committing a search reuses
  // this cache rather than refetching.
  const availabilityQ = useQuery(
    trpc.dining.availability.queryOptions({ partySize: Number(partySize), days: 30 }),
  );
  const referenceDate = new Date().toISOString().slice(0, 10);
  const nextAvail = React.useMemo(() => {
    const m = new Map<string, string>();
    for (const entry of availabilityQ.data ?? []) {
      const day = entry.days.find((d) => d.available);
      if (day) m.set(entry.facilityId, formatNextAvail(day.date, referenceDate));
    }
    return m;
  }, [availabilityQ.data, referenceDate]);

  // Today's operating hours, for the open / closes-soon / closed status chip.
  const hoursQ = useQuery(trpc.dining.hours.queryOptions({}));
  const hoursMap = React.useMemo(() => {
    const m = new Map<string, Array<ScheduleEntry>>();
    for (const entry of hoursQ.data ?? []) m.set(entry.facilityId, entry.schedules);
    return m;
  }, [hoursQ.data]);
  const nowMin = parkNowMinutes();

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
                  className="basis-[42%] pl-4 md:basis-1/3 lg:basis-1/4 xl:basis-1/5"
                >
                  <PickCard
                    venue={v}
                    nextAvail={nextAvail.get(v.facilityId)}
                    schedules={hoursMap.get(v.facilityId)}
                    nowMin={nowMin}
                  />
                </CarouselItem>
              ))}
            </CarouselContent>
          </section>
        </Carousel>
      ))}
    </div>
  );
}
