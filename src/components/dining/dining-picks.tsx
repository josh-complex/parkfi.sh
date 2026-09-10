"use client";

import * as React from "react";
import { Link } from "@tanstack/react-router";
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
import { Image } from "#/components/ui/image.tsx";
import { LazyMount } from "#/components/ui/lazy-mount.tsx";
import { ShelfGhost } from "#/components/skeletons.tsx";
import { Skeleton } from "#/components/ui/skeleton.tsx";
import {
  RAIL_GHOST_GRID,
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

export interface PickVenue {
  facilityId: string;
  name: string;
  cuisine: string | null;
  parkResort: string | null;
  priceRange: string | null;
  imageUrl: string | null;
  imageThumbhash: string | null;
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

export function PickCard({
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
  // No schedule rows means hours are UNKNOWN (UOR venues have no
  // `dining_schedule` ingestion), not closed — omit the chip entirely.
  const status = schedules ? openStatus(schedules, nowMin) : null;
  const statusDetail = schedules ? openStatusDetail(schedules, nowMin) : null;
  const body = (
    <RailCard>
      <RailCardMedia>
        {venue.imageUrl ? (
          <Image
            src={venue.imageUrl}
            alt={venue.name}
            loading="lazy"
            aspect={RAIL_MEDIA_RATIO}
            placeholder={venue.imageThumbhash}
            className="size-full object-cover group-hover:scale-105"
          />
        ) : null}
        {tier && (
          <Badge className="absolute top-2 left-2 bg-black/60 text-white text-xs font-normal border-0 shadow-none backdrop-blur-sm">
            {tier}
          </Badge>
        )}
        {status && (
          <Badge
            title={statusDetail ?? undefined}
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
        )}
        {nextAvail && (
          <Badge className="absolute bottom-2 left-2 gap-1 bg-emerald-500 text-white text-xs font-normal border-0 shadow">
            <CalendarDaysIcon className="size-3" />
            {nextAvail}
          </Badge>
        )}
      </RailCardMedia>
      <RailCardBody>
        <RailCardTitle>{venue.name}</RailCardTitle>
        {venue.parkResort && <RailCardMeta>{venue.parkResort}</RailCardMeta>}
        {venue.cuisine && <RailCardMeta>{venue.cuisine}</RailCardMeta>}
      </RailCardBody>
    </RailCard>
  );
  // Always open our own detail page first; the external reservation link lives there.
  return (
    <Link to="/dining/$facilityId" params={{ facilityId: venue.facilityId }} className="block">
      {body}
    </Link>
  );
}

/**
 * Curated "Disney Picks" shelves — click-to-scroll carousels (arrows on desktop,
 * drag on mobile) grouped by the finder taxonomy (character dining, signature,
 * franchises…). Pure catalog data (`dining.picks`), independent of the
 * availability sweep, shown only while the board is pre-search.
 */
/**
 * @param include Render only these shelf keys, in the given order (for slotting
 *   a single shelf — e.g. "character" — into a specific place in the browse
 *   flow). @param exclude Render every shelf except these keys. When both are
 *   omitted, all shelves render. The targeted (`include`) instances stay quiet
 *   while the shared picks query loads so only the primary instance holds space
 *   with a skeleton.
 */
export function DiningPicks({
  include,
  exclude,
}: {
  include?: Array<string>;
  exclude?: Array<string>;
} = {}) {
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
    // Only the primary instance holds space with a skeleton; the small targeted
    // (include) instances stay quiet until the shared query resolves.
    if (include) return null;
    return (
      <div className="flex flex-col gap-4">
        {Array.from({ length: 3 }).map((_, g) => (
          <div key={g} className="flex flex-col gap-4">
            <Skeleton className="h-6 w-56" />
            <div className={RAIL_GHOST_GRID}>
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className={cn(RAIL_MEDIA_ASPECT, "rounded-2xl")} />
              ))}
            </div>
          </div>
        ))}
      </div>
    );
  }

  const all = picksQ.data ?? [];
  let shelves = all;
  if (include) {
    const byKey = new Map(all.map((s) => [s.key, s]));
    shelves = include.map((k) => byKey.get(k)).filter((s): s is (typeof all)[number] => !!s);
  } else if (exclude) {
    shelves = all.filter((s) => !exclude.includes(s.key));
  }
  if (!shelves.length) return null;

  return (
    <div className="flex flex-col gap-4">
      {shelves.map((shelf) => (
        // Each shelf mounts ~24 image cards plus an Embla instance — deferring
        // below-fold shelves keeps the navigation commit to what's on screen.
        <LazyMount
          key={shelf.key}
          estimatedHeight={290}
          fallback={
            <ShelfGhost
              title={shelf.title}
              subtitle={shelf.subtitle}
              items={shelf.venues.map((v) => ({
                thumbhash: v.imageThumbhash,
                name: v.name,
                sub: v.parkResort,
                sub2: v.cuisine,
              }))}
            />
          }
        >
          <RailShelf>
            <RailShelfHeader title={shelf.title} subtitle={shelf.subtitle} />
            <RailTrack>
              {shelf.venues.map((v) => (
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
        </LazyMount>
      ))}
    </div>
  );
}
