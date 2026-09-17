"use client";

import { DayHeatGrid, WeekdayBars } from "#/components/detail/day-series.tsx";
import { DetailCard } from "#/components/detail/panels.tsx";
import { Skeleton } from "#/components/ui/skeleton.tsx";
import { cn } from "#/lib/utils.ts";

import type { ParkCrowd } from "./types.ts";

/**
 * The park page's crowd-calendar section (plan §4.3): how busy the park has
 * been day by day, and which weekday it rewards. Both read one payload — the
 * daily averages `parks.crowd` already computes for the wash panel's curve —
 * so the section costs no extra round trip.
 *
 * Renders nothing until there's enough history to say anything: a park we've
 * watched for four days can't have a five-week calendar, and drawing one with
 * two rows of grey is worse than drawing none.
 */
export function ParkCrowdCalendar({
  crowd,
  subject = "Park-wide",
  className,
}: {
  crowd: ParkCrowd | undefined;
  /** What the averages are of — the ride page hands it `parks.rideCrowd`,
   *  which is the identical payload measured over one attraction. */
  subject?: string;
  className?: string;
}) {
  const days = crowd?.days ?? [];
  // A park we've only watched for a few days can't have a five-week calendar,
  // and two rows of grey is worse than no card.
  // A calendar needs a week. Before the query lands there is nothing to say,
  // but there *will* be — so hold the box rather than letting a ~310px block
  // appear under the band heading and shove the analytics grid down.
  if (!crowd) {
    return <Skeleton className={cn("h-[309px] w-full rounded-[22px]", className)} />;
  }
  if (days.length < 7) return null;

  // The two charts are the shared day-scale pair (`detail/day-series.tsx`),
  // which the venue page's reservation band also draws — one calendar and one
  // weekday chart in the app, whatever the series behind them measures.
  const points = days.map((d) => ({ date: d.date, value: d.avgWait }));
  const minutes = (value: number) => `${value} min`;

  return (
    <div className="grid gap-4 md:grid-cols-[2fr_3fr] md:gap-6">
      <DetailCard title="Busiest days" description={`${subject} average standby · today outlined`}>
        <DayHeatGrid days={points} today={crowd?.date ?? null} unit={minutes} />
      </DetailCard>
      <DetailCard
        title="By day of week"
        description="Average standby per weekday · 5 weeks · quietest in green"
      >
        <WeekdayBars days={points} good="min" unit={minutes} />
      </DetailCard>
    </div>
  );
}
