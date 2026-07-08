"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { useStore } from "@tanstack/react-store";

import { PickCard, type PickVenue } from "#/components/dining/dining-picks.tsx";
import { diningStore } from "#/components/dining/dining-store.ts";
import { parkNowMinutes, type ScheduleEntry } from "#/components/dining/dining-hours.ts";
import {
  Carousel,
  CarouselArrows,
  CarouselContent,
  CarouselItem,
} from "#/components/ui/carousel.tsx";
import { Skeleton } from "#/components/ui/skeleton.tsx";
import { useTRPC } from "#/integrations/trpc/react.ts";

/** "YYYY-MM-DD" → "Today" / "Tomorrow" / "Jun 21" relative to the reference day. */
function formatNextAvail(date: string, referenceDate: string): string {
  const ref = new Date(`${referenceDate}T00:00:00`);
  const d = new Date(`${date}T00:00:00`);
  const dayDiff = Math.round((d.getTime() - ref.getTime()) / 86_400_000);
  if (dayDiff <= 0) return "Today";
  if (dayDiff === 1) return "Tomorrow";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function Shelf({
  title,
  subtitle,
  venues,
  nextAvail,
  hoursMap,
  nowMin,
}: {
  title: string;
  subtitle: string;
  venues: Array<PickVenue>;
  nextAvail: Map<string, string>;
  hoursMap: Map<string, Array<ScheduleEntry>>;
  nowMin: number;
}) {
  if (!venues.length) return null;
  return (
    <Carousel opts={{ align: "start", dragFree: true }} className="-mx-4 lg:-mx-6">
      <section className="flex flex-col gap-3">
        <div className="flex items-end justify-between gap-4 px-4 lg:px-6">
          <div className="flex flex-col gap-0.5">
            <h3 className="text-lg font-semibold tracking-tight">{title}</h3>
            <p className="text-muted-foreground text-sm">{subtitle}</p>
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
  );
}

/**
 * "Eats here" shelves for a resort hotel's detail page — restaurants and
 * quick-service/snack spots located at the resort, in the exact carousel/card
 * design of the dining board's "Disney Picks" shelves. Split into two shelves
 * (table service vs. quick service) since resorts commonly have both.
 */
export function ResortDiningShelf({ resortName }: { resortName: string }) {
  const trpc = useTRPC();
  const partySize = useStore(diningStore, (s) => s.partySize);
  const venuesQ = useQuery(trpc.dining.byResort.queryOptions({ resortName }));

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

  const hoursQ = useQuery(trpc.dining.hours.queryOptions({}));
  const hoursMap = React.useMemo(() => {
    const m = new Map<string, Array<ScheduleEntry>>();
    for (const entry of hoursQ.data ?? []) m.set(entry.facilityId, entry.schedules);
    return m;
  }, [hoursQ.data]);
  const nowMin = parkNowMinutes();

  if (venuesQ.isLoading) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-6 w-56" />
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4 lg:grid-cols-5">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="aspect-[4/3] rounded-2xl" />
          ))}
        </div>
      </div>
    );
  }

  const venues = venuesQ.data ?? [];
  if (!venues.length) return null;

  const restaurants = venues.filter((v) => v.bookable);
  const quickService = venues.filter((v) => !v.bookable);

  return (
    <div className="flex flex-col gap-4">
      <Shelf
        title="Restaurants"
        subtitle="Table service at this resort"
        venues={restaurants}
        nextAvail={nextAvail}
        hoursMap={hoursMap}
        nowMin={nowMin}
      />
      <Shelf
        title="Quick Service & Snacks"
        subtitle="Grab-and-go options at this resort"
        venues={quickService}
        nextAvail={nextAvail}
        hoursMap={hoursMap}
        nowMin={nowMin}
      />
    </div>
  );
}
