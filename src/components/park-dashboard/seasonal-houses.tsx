"use client";

import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";

import { PAGE_WIDTH } from "#/components/page-container.tsx";
import { Image } from "#/components/ui/image.tsx";
import { useTRPC } from "#/integrations/trpc/react.ts";
import { disneyResizeUrl } from "#/lib/image.ts";
import { formatHourRange, todayInTz } from "#/lib/park-hours.ts";
import { cn } from "#/lib/utils.ts";

import { BandHeading } from "./band.tsx";
import { isHauntedHouse } from "./lightning-lane.ts";
import type { BoardItem } from "./types.ts";

/** How many houses the band posters before it counts the rest. */
const TILES = 6;

/**
 * The park's hard-ticket event houses — Halloween Horror Nights and whatever
 * follows it — as their own full-bleed band.
 *
 * They're ordinary `ATTRACTION` rows carrying the `Haunted House` tag, but they
 * only run on event nights behind a separate ticket, so they can't sit in
 * today's board: all day they'd be ten dead rows in the middle of an operating
 * park, and on an event night they're the only rows posting a wait and they'd
 * take the whole table. The board shelves them for that reason; this band is
 * where they get to be the subject instead.
 *
 * Built like the Waits band and for the same reason: the houses are dark, lurid,
 * art-directed posters, and on the page's pale field they read as six bright
 * rectangles inside a seventh. On their own field they are the only lit thing on
 * the row — and a band in the event's own colour reads as a different *night*
 * from the rest of the page, which is exactly what it's selling.
 *
 * The event's own name comes from today's ticketed-event schedule row when the
 * park posts one, so the band reads "Halloween Horror Nights" in season and
 * falls back to a plain description when the feed doesn't say.
 */
export function SeasonalHouses({
  board,
  parkSlug,
  className,
}: {
  board: Array<BoardItem> | undefined;
  parkSlug: string | null;
  className?: string;
}) {
  const trpc = useTRPC();
  // Same query key the hours card uses, so this costs no extra round trip.
  const hoursQ = useQuery({
    ...trpc.parks.hours.queryOptions({ parkSlug: parkSlug ?? "" }),
    enabled: !!parkSlug,
  });

  const houses = (board ?? []).filter(isHauntedHouse);
  if (!parkSlug || houses.length === 0) return null;

  const tz = hoursQ.data?.timezone ?? "America/New_York";
  const todayRow = hoursQ.data?.days.find((d) => d.date === todayInTz(tz)) ?? null;
  const event = todayRow?.extras.find((ex) => ex.type === "TICKETED_EVENT") ?? null;
  const eventRange = event ? formatHourRange(event.open, event.close, tz) : null;

  // The "+N more" tile takes a slot of its own, so it replaces the last house
  // rather than pushing the row onto a second line.
  const shown = houses.length > TILES ? houses.slice(0, TILES - 1) : houses;
  const rest = houses.length - shown.length;

  return (
    <section className={cn("band-fright band-tints py-8 text-white md:py-12", className)}>
      <div className={cn(PAGE_WIDTH, "flex flex-col gap-5")}>
        <BandHeading
          tone="invert"
          kicker="Tonight, separate ticket"
          title={event?.description ?? "Haunted houses"}
          meta={[
            `${houses.length} ${houses.length === 1 ? "house" : "houses"}`,
            eventRange,
            "waits post once the event opens",
          ]
            .filter(Boolean)
            .join(" · ")}
        />

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6 lg:gap-4">
          {shown.map((h) => {
            const hero = h.meta?.imageThumbUrl ?? h.meta?.imageHeroUrl ?? null;
            const open = h.status === "OPERATING";
            return (
              <Link
                key={h.id}
                to="/park/$slug/ride/$rideSlug"
                params={{ slug: parkSlug, rideSlug: h.slug }}
                className="group relative isolate block aspect-[3/4] overflow-hidden rounded-2xl bg-black/50 shadow-lg ring-1 ring-white/15 transition-transform duration-200 hover:-translate-y-1"
              >
                {hero ? (
                  <Image
                    src={disneyResizeUrl(hero, 500)}
                    alt={h.meta?.imageAlt ?? h.name}
                    loading="lazy"
                    aspect={3 / 4}
                    placeholder={h.meta?.imageThumbhash ?? undefined}
                    className="absolute inset-0 size-full object-cover transition-transform duration-500 group-hover:scale-105"
                  />
                ) : null}
                {/* The poster art is busy edge to edge, so the name needs a
                    floor of its own rather than a drop shadow. */}
                <span className="absolute inset-x-0 bottom-0 h-3/5 bg-gradient-to-t from-black via-black/70 to-transparent" />
                {/* A live wait only ever appears on an event night — the one
                    time this tile is a thing you act on rather than read. */}
                {open && h.standbyWait != null && (
                  <span className="absolute top-2 right-2 rounded-lg bg-brand-yellow px-2 py-0.5 text-[13px] font-extrabold text-ink-on-yellow tabular-nums">
                    {h.standbyWait}
                  </span>
                )}
                <span className="absolute inset-x-0 bottom-0 flex flex-col gap-0.5 p-3">
                  <span className="line-clamp-2 text-[13.5px] leading-tight font-extrabold text-white">
                    {h.name}
                  </span>
                  {h.meta?.land && (
                    <span className="line-clamp-1 text-[11px] font-semibold text-white/70">
                      {h.meta.land}
                    </span>
                  )}
                </span>
              </Link>
            );
          })}

          {rest > 0 && (
            <div className="flex aspect-[3/4] flex-col items-center justify-center gap-1 rounded-2xl bg-white/10 ring-1 ring-white/20">
              <span className="text-[30px] leading-none font-black text-white">+{rest}</span>
              <span className="text-[13px] font-semibold text-white/75">more houses</span>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
