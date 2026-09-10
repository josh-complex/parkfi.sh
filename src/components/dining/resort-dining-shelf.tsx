"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { useStore } from "@tanstack/react-store";

import { PickCard, type PickVenue } from "#/components/dining/dining-picks.tsx";
import { diningStore } from "#/components/dining/dining-store.ts";
import { parkNowMinutes, type ScheduleEntry } from "#/components/dining/dining-hours.ts";
import { Skeleton } from "#/components/ui/skeleton.tsx";
import { cn } from "#/lib/utils.ts";
import {
  RAIL_GHOST_GRID,
  RAIL_MEDIA_ASPECT,
  RailItem,
  RailShelf,
  RailShelfHeader,
  RailTrack,
} from "#/components/ui/rail.tsx";
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
    <RailShelf>
      <RailShelfHeader title={title} subtitle={subtitle} />
      <RailTrack>
        {venues.map((v) => (
          <RailItem key={v.facilityId}>
            <PickCard
              venue={v}
              nextAvail={nextAvail.get(v.facilityId)}
              schedules={hoursMap.get(v.facilityId)}
              nowMin={nowMin}
            />
          </RailItem>
        ))}
      </RailTrack>
    </RailShelf>
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
        <div className={RAIL_GHOST_GRID}>
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className={cn(RAIL_MEDIA_ASPECT, "rounded-2xl")} />
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
