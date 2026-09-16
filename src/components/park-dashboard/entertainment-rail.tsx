"use client";

import * as React from "react";
import { Link } from "@tanstack/react-router";

import { Badge } from "#/components/ui/badge.tsx";
import { Image } from "#/components/ui/image.tsx";
import { disneyResizeUrl } from "#/lib/image.ts";
import {
  RAIL_MEDIA_RATIO,
  RailCard,
  RailCardBody,
  RailCardMedia,
  RailCardMeta,
  RailCardTitle,
  RailItem,
  RailShelf,
  RailTrack,
} from "#/components/ui/rail.tsx";
import { TintMeta, TintPanel } from "#/components/detail/panels.tsx";
import {
  nextShowtime,
  parseShowtimes,
  showClock,
  untilLabel,
  type ParsedShowtime,
} from "#/lib/showtimes.ts";

import type { BoardItem } from "./types.ts";

interface ShowRow {
  item: BoardItem;
  times: Array<ParsedShowtime>;
  next: ParsedShowtime | null;
}

/**
 * One entertainment card, in the exact carousel-card design used by the dining
 * "Picks" / resort shelves: a 4:3 rounded photo carrying the next showtime, then
 * name + subline beneath. Deep-links to the show's detail page.
 */
function ShowCard({
  row,
  parkSlug,
  tz,
  nowMs,
}: {
  row: ShowRow;
  parkSlug: string;
  tz: string;
  nowMs: number;
}) {
  const { item, times, next } = row;
  const minutes = next ? Math.round((next.ms - nowMs) / 60_000) : null;
  const hero = item.meta?.imageThumbUrl ?? item.meta?.imageHeroUrl ?? null;
  return (
    <Link
      to="/park/$slug/ride/$rideSlug"
      params={{ slug: parkSlug, rideSlug: item.slug }}
      className="block"
    >
      <RailCard>
        <RailCardMedia>
          {hero ? (
            <Image
              src={disneyResizeUrl(hero, 400)}
              alt={item.meta?.imageAlt ?? item.name}
              loading="lazy"
              aspect={RAIL_MEDIA_RATIO}
              placeholder={item.meta?.imageThumbhash ?? undefined}
              className="size-full object-cover group-hover:scale-105"
            />
          ) : null}
          {next ? (
            <Badge className="absolute bottom-2 left-2 gap-1 border-0 bg-primary text-xs font-normal text-primary-foreground shadow">
              {showClock(next.iso, tz)}
            </Badge>
          ) : (
            <Badge className="absolute bottom-2 left-2 border-0 bg-black/60 text-xs font-normal text-white shadow backdrop-blur-sm">
              Done today
            </Badge>
          )}
        </RailCardMedia>
        <RailCardBody>
          <RailCardTitle>{item.name}</RailCardTitle>
          <RailCardMeta>
            {next && minutes != null
              ? `Next show ${untilLabel(minutes)}`
              : `${times.length} ${times.length === 1 ? "show" : "shows"} today`}
          </RailCardMeta>
          {item.meta?.land && <RailCardMeta>{item.meta.land}</RailCardMeta>}
        </RailCardBody>
      </RailCard>
    </Link>
  );
}

/**
 * "Entertainment today" — a mint panel (plan §4.3) whose body is the shared
 * shelf carousel (plan item 1.1): the park's SHOW entities that have
 * posted showtimes, ordered by their next upcoming performance (shows already
 * done for the day sink to the end). Uses the shared carousel/card design from
 * the Eats/Waits/Stays shelves. Renders nothing when the park has no timed
 * entertainment — so it's safe to always mount. Ticks each minute to keep the
 * "next / in N min" fresh.
 */
export function EntertainmentRail({
  board,
  parkSlug,
  timezone,
  className,
}: {
  board: Array<BoardItem> | undefined;
  parkSlug: string | null;
  timezone: string | undefined;
  className?: string;
}) {
  const [nowMs, setNowMs] = React.useState(() => Date.now());
  React.useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  const tz = timezone ?? "America/New_York";

  const shows = React.useMemo<Array<ShowRow>>(() => {
    const rows: Array<ShowRow> = [];
    for (const item of board ?? []) {
      if (item.entityType !== "SHOW" || item.showtimes.length === 0) continue;
      const times = parseShowtimes(item.showtimes);
      if (times.length === 0) continue;
      rows.push({ item, times, next: nextShowtime(times, nowMs) });
    }
    // Upcoming shows first (soonest next start); shows done for the day trail.
    rows.sort((a, b) => {
      if (a.next && b.next) return a.next.ms - b.next.ms;
      if (a.next) return -1;
      if (b.next) return 1;
      return a.item.name.localeCompare(b.item.name);
    });
    return rows;
  }, [board, nowMs]);

  if (!parkSlug || shows.length === 0) return null;

  return (
    <TintPanel
      tone="mint"
      title="Entertainment today"
      meta={
        <TintMeta tone="mint">
          {shows.length} {shows.length === 1 ? "show" : "shows"}
        </TintMeta>
      }
      className={className}
    >
      {/* The shelf normally bleeds to the screen edge and re-adds the page
          gutter; inside a panel the panel's own padding is the gutter, so both
          are cancelled and the track clips on the panel's edges. */}
      <RailShelf carouselClassName="mx-0 lg:mx-0">
        <RailTrack viewportClassName="px-0">
          {shows.map((row) => (
            <RailItem key={row.item.id}>
              <ShowCard row={row} parkSlug={parkSlug} tz={tz} nowMs={nowMs} />
            </RailItem>
          ))}
        </RailTrack>
      </RailShelf>
    </TintPanel>
  );
}
