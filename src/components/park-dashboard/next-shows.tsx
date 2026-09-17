"use client";

import * as React from "react";
import { Link } from "@tanstack/react-router";

import { TicketBlock, TicketRow } from "#/components/detail/ticket.tsx";
import { cn } from "#/lib/utils.ts";
import {
  nextShowtime,
  parseShowtimes,
  showClock,
  untilLabel,
  type ParsedShowtime,
} from "#/lib/showtimes.ts";

import type { BoardItem } from "./types.ts";

/** How many shows the card lists before it hands over to the board. */
const ROWS = 5;

/** The same list, shortened, when it is riding on the ticket's lower half —
 *  the stub carries the park's identity, and six rows of times turns it into a
 *  schedule board. */
const TICKET_ROWS = 4;

/**
 * "Next shows" — the park's timed entertainment as a clock-ordered list: the
 * next performance of each show that still has one today, soonest first.
 *
 * A list, not the photo carousel it replaced: the question is "what starts soon
 * and can I still make it", and four rows of times answer that in the space one
 * card of artwork took. Shows already done for the day drop out entirely — a
 * row that can't be acted on is only in the way.
 *
 * `variant="ticket"` drops the card chrome and inks the list for the stub's own
 * lower half, where the park page now carries it: on the ticket it reads as one
 * more fact about this park right now, next to the longest wait, rather than as
 * a separate card making a separate claim on the page.
 *
 * Renders nothing when the park posts no showtimes, so it's safe to mount
 * always. Ticks each minute to keep the countdown honest.
 */
export function NextShows({
  board,
  parkSlug,
  timezone,
  variant = "card",
  className,
}: {
  board: Array<BoardItem> | undefined;
  parkSlug: string | null;
  timezone: string | undefined;
  /** `"ticket"` renders bare, in the stub's ink — see above. */
  variant?: "card" | "ticket";
  className?: string;
}) {
  const [nowMs, setNowMs] = React.useState(() => Date.now());
  React.useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  const tz = timezone ?? "America/New_York";

  const rows = React.useMemo(() => {
    const out: Array<{ item: BoardItem; next: ParsedShowtime; total: number }> = [];
    for (const item of board ?? []) {
      if (item.entityType !== "SHOW" || item.showtimes.length === 0) continue;
      const times = parseShowtimes(item.showtimes);
      const next = nextShowtime(times, nowMs);
      if (!next) continue;
      out.push({ item, next, total: times.length });
    }
    out.sort((a, b) => a.next.ms - b.next.ms);
    return out;
  }, [board, nowMs]);

  const ticket = variant === "ticket";

  if (!parkSlug) return null;
  if (rows.length === 0) {
    // On the ticket the frame is decided by the page before this renders (it
    // has to be, or the frame's existence would depend on the clock and break
    // hydration — see `postsShowtimes` in park-dashboard). So a park that has
    // simply run the last of its shows gets a closing line rather than an empty
    // box with a rule above it. Everywhere else, no rows means no card.
    const postsAny = (board ?? []).some((b) => b.entityType === "SHOW" && b.showtimes.length > 0);
    if (!ticket || !postsAny) return null;
    return (
      <TicketBlock title="Next shows" className={className}>
        <p className="text-[13px] font-semibold text-ink-on-yellow/70">
          That&rsquo;s every show for today.
        </p>
      </TicketBlock>
    );
  }

  const shown = rows.slice(0, ticket ? TICKET_ROWS : ROWS);
  const remaining = rows.length - shown.length;
  const note =
    remaining > 0 ? `${remaining} more ${remaining === 1 ? "show" : "shows"} later today.` : null;

  // On the stub: the shared ticket list, so this block and the hours above it
  // are printed from one set of rules (see `TicketBlock`).
  if (ticket) {
    return (
      <TicketBlock
        title="Next shows"
        meta={`${rows.length} still to come`}
        note={note}
        className={className}
      >
        {shown.map(({ item, next }) => {
          const minutes = Math.round((next.ms - nowMs) / 60_000);
          return (
            <TicketRow
              key={item.id}
              pressable
              lead={
                <span className="font-extrabold text-ink-on-yellow">{showClock(next.iso, tz)}</span>
              }
              tail={
                minutes >= 0 &&
                minutes <= 90 && (
                  <span className="rounded-full border border-ink-on-yellow/25 px-2.5 py-0.5 text-[11px] font-semibold text-ink-on-yellow/75">
                    {untilLabel(minutes)}
                  </span>
                )
              }
              render={
                <Link
                  to="/park/$slug/ride/$rideSlug"
                  params={{ slug: parkSlug, rideSlug: item.slug }}
                />
              }
            >
              <span className="line-clamp-1 font-semibold">{item.name}</span>
            </TicketRow>
          );
        })}
      </TicketBlock>
    );
  }

  return (
    <div
      className={cn(
        "flex flex-col gap-3 rounded-[22px] border border-card-edge bg-card p-4 md:p-5",
        className,
      )}
    >
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-[19px] font-extrabold tracking-[-0.01em]">Next shows</h2>
        <span className="shrink-0 text-xs text-muted-foreground">{rows.length} still to come</span>
      </div>
      <div className="flex flex-col gap-2">
        {shown.map(({ item, next }) => {
          const minutes = Math.round((next.ms - nowMs) / 60_000);
          return (
            <Link
              key={item.id}
              to="/park/$slug/ride/$rideSlug"
              params={{ slug: parkSlug, rideSlug: item.slug }}
              className="flex items-center gap-3 rounded-xl px-1 py-0.5 hover:bg-muted"
            >
              <span className="w-[62px] shrink-0 text-[13.5px] font-extrabold tabular-nums text-wash-fg">
                {showClock(next.iso, tz)}
              </span>
              <span className="line-clamp-1 flex-1 text-[13.5px] font-semibold">{item.name}</span>
              {minutes >= 0 && minutes <= 90 && (
                <span className="shrink-0 rounded-full border border-card-edge px-2.5 py-0.5 text-[11px] font-semibold text-muted-foreground">
                  {untilLabel(minutes)}
                </span>
              )}
            </Link>
          );
        })}
      </div>
      {note && <p className="text-xs text-muted-foreground">{note}</p>}
    </div>
  );
}
