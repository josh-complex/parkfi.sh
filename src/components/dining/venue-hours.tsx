"use client";

import { useQuery } from "@tanstack/react-query";

import { TicketBlock, TicketRow } from "#/components/detail/ticket.tsx";
import {
  clockLabel,
  hoursLabel,
  parkNowMinutes,
  parkToday,
  statusLabel,
  type ScheduleEntry,
} from "#/components/dining/dining-hours.ts";
import { Skeleton } from "#/components/ui/skeleton.tsx";
import { useTRPC } from "#/integrations/trpc/react.ts";
import { useHydrated } from "#/lib/use-hydrated.ts";

/**
 * Days of the posted window the stub lists, today included. Exported because
 * the route prefetches this exact query — a different `days` is a different
 * query key, and the prefetch would warm a cache entry nobody reads.
 */
export const VENUE_HOURS_DAYS = 4;

export interface VenueHours {
  /** Today's rows — what "is it open" and the walk-up panel read. */
  today: Array<ScheduleEntry>;
  /** "Open til 9 PM" / "Closed · Opens 11 AM". Null until hydration. */
  status: string | null;
  /** Open right now. Null until hydration — see `statusLabel`. */
  openNow: boolean | null;
  /** We hold a posted schedule for this venue at all. */
  hasSchedule: boolean;
  /** The query has answered, either way (it isn't SSR-prefetched). */
  ready: boolean;
}

/**
 * A venue's posted window, as the ticket reads it. Shares its query cache with
 * `VenueHours` below, so the page pays for one `dining.venueSchedule` round
 * trip — the dining twin of `useParkHoursToday`.
 */
export function useVenueHours(facilityId: string): VenueHours {
  const trpc = useTRPC();
  const q = useQuery(
    trpc.dining.venueSchedule.queryOptions({ facilityId, days: VENUE_HOURS_DAYS }),
  );
  const hydrated = useHydrated();

  const today = q.data?.find((d) => d.date === parkToday())?.schedules ?? [];
  // Both are readings of the clock, so they stay null until the client owns the
  // render: a server-rendered "Open" is wrong by however long the HTML sat in
  // the edge cache, and it trips a hydration mismatch on its way to being wrong.
  const status = hydrated && today.length > 0 ? statusLabel(today, parkNowMinutes()) : null;
  const openNow = hydrated && today.length > 0 ? (status?.startsWith("Open") ?? false) : null;

  return {
    today,
    status,
    openNow,
    hasSchedule: (q.data?.length ?? 0) > 0,
    ready: q.data != null,
  };
}

/** Anything the feeds file under a type that isn't the venue's normal service. */
function overlay(schedules: Array<ScheduleEntry>): ScheduleEntry | null {
  return schedules.find((s) => s.scheduleType !== "Operating") ?? null;
}

/**
 * "Hours" on the venue ticket's lower half — today's service picked out, then
 * the rest of the posted window.
 *
 * The same block the park page's stub carries, from the same primitives
 * (`TicketBlock` / `TicketRow`), over the dining feeds' schedule rows instead of
 * park hours. It's on the stub for the same reason: what time a place opens is
 * a fact about it, like its price band, not a card about it — and it was being
 * said three times over (a hero chip, a ticket fact, a walk-up tile) before it
 * had one home.
 *
 * Only dates we actually hold are listed. A venue whose operator has published
 * nothing past today gets a one-row block rather than three invented "Closed"s.
 */
export function VenueHours({ facilityId, className }: { facilityId: string; className?: string }) {
  const trpc = useTRPC();
  const q = useQuery(
    trpc.dining.venueSchedule.queryOptions({ facilityId, days: VENUE_HOURS_DAYS }),
  );

  // Same shape in grey rather than nothing: this block sits at the foot of the
  // stub with the whole left column under it, so arriving late moved all of it.
  // Keyed off the data, not `isLoading` — on the server the query never fetches,
  // so `isLoading` disagrees across hydration where "no data yet" doesn't.
  if (!q.data) {
    return (
      <TicketBlock title="Hours" gap="tight" className={className}>
        {Array.from({ length: 3 }).map((_, i) => (
          <TicketRow key={i} lead={<Skeleton className="h-3.5 w-14 rounded bg-ink-on-yellow/10" />}>
            <Skeleton className="h-3.5 w-28 rounded bg-ink-on-yellow/10" />
          </TicketRow>
        ))}
      </TicketBlock>
    );
  }

  const todayIso = parkToday();
  const days = q.data.filter((d) => d.date >= todayIso).slice(0, VENUE_HOURS_DAYS);
  if (days.length === 0) return null;

  return (
    <TicketBlock
      title="Hours"
      meta={days.length > 1 ? `Next ${days.length} days` : "Today"}
      gap="tight"
      className={className}
    >
      {days.map((d) => {
        const isToday = d.date === todayIso;
        const extra = overlay(d.schedules);
        return (
          <TicketRow
            key={d.date}
            highlight={isToday}
            lead={
              isToday
                ? "Today"
                : new Date(`${d.date}T00:00:00`).toLocaleDateString("en-US", {
                    weekday: "short",
                    day: "numeric",
                  })
            }
            tail={
              extra && (
                <span
                  className={isToday ? "font-bold text-ink-on-yellow/70" : "text-ink-on-yellow/60"}
                  title={`${extra.scheduleType} · ${clockLabel(extra.startTime)}–${clockLabel(extra.endTime)}`}
                >
                  {clockLabel(extra.startTime)}
                </span>
              )
            }
          >
            <span
              className={
                isToday
                  ? "font-semibold tabular-nums"
                  : "font-semibold tabular-nums text-ink-on-yellow/70"
              }
            >
              {hoursLabel(d.schedules) ?? "Closed"}
            </span>
          </TicketRow>
        );
      })}
    </TicketBlock>
  );
}
