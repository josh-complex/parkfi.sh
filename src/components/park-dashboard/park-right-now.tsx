"use client";

import { Link } from "@tanstack/react-router";
import { BellIcon, ChevronDownIcon } from "lucide-react";

import { HourBars, hourLabel, type HourBar } from "#/components/detail/hour-bars.tsx";
import { WashPanel } from "#/components/detail/panels.tsx";
import { WaitPill } from "#/components/detail/wait-pill.tsx";
import { Button } from "#/components/ui/button.tsx";
import { Skeleton } from "#/components/ui/skeleton.tsx";
import { clockTight } from "#/lib/park-hours.ts";

import type { ParkHoursToday } from "./park-hours.tsx";
import { busiestRides, type ParkStats } from "./park-stats.ts";
import type { ParkCrowd } from "./types.ts";

/** How many rides the panel lists before handing over to the full board. */
const ROWS = 6;

/** "Sunday" for a park-local `YYYY-MM-DD`. Parsed as a local midnight (never
 *  `Date.parse("2026-09-13")`, which is UTC and lands on the day before west of
 *  Greenwich), so the label is the park's weekday, not the viewer's. */
function weekdayName(date: string | null): string | null {
  if (!date) return null;
  const d = new Date(`${date}T00:00:00`);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString("en-US", { weekday: "long" });
}

/**
 * The park page's job block (plan §4.3): what the park is doing this minute —
 * the day's curve with the current hour picked out, the queues to avoid, and
 * the two things a guest does next (open the whole board, or set an alert).
 *
 * The curve and the live figures come from different places on purpose. The
 * bars are `parks.crowd` (an hourly rollup, and for hours still ahead, what
 * this weekday usually does); the rows and the "now" figure are the same live
 * board the ticket counts, so the panel never disagrees with the stub above it
 * by a minute.
 *
 * Out of hours it keeps its job rather than emptying out: the same curve, all
 * of it typical, plus when the park picks up again and when it's busiest — the
 * two things worth knowing about a park you can't walk into yet.
 */
export function ParkRightNow({
  parkSlug,
  stats,
  crowd,
  hours,
  loading,
  /** Where the "All N rides" key sends the page — the board section's id. */
  boardId,
  className,
}: {
  parkSlug: string | null;
  stats: ParkStats;
  /** `parks.crowd` for this park; the page owns the query (the ticket stamps
   *  its date off the same payload). */
  crowd: ParkCrowd | undefined;
  hours: ParkHoursToday;
  loading: boolean;
  boardId: string;
  className?: string;
}) {
  const weekday = weekdayName(crowd?.date ?? null);
  const bars: Array<HourBar> = (crowd?.hours ?? []).map((h) => ({
    hour: h.hour,
    // An hour the park hasn't reached yet has no `actual` — that's the whole
    // reason `typical` travels with it.
    value: h.actual ?? h.typical,
    projected: h.actual == null,
    now: h.now,
  }));
  // A curve needs a shape: two bars is a pair of sticks, not a day.
  const drawn = bars.filter((b) => b.value != null);
  const hasCurve = drawn.length >= 3;
  // Nothing measured yet (the park is shut, or the day hasn't started): the
  // whole curve is the weekday's typical shape, and it has to say so.
  const allTypical = hasCurve && drawn.every((b) => b.projected);
  const peak = drawn.reduce<HourBar | null>(
    (best, b) => (!best || (b.value ?? 0) > (best.value ?? 0) ? b : best),
    null,
  );
  const rows = busiestRides(stats, ROWS);
  const closed = stats.closed || hours.openNow === false;

  return (
    <WashPanel
      title="Right now"
      meta={
        closed
          ? (hours.nextOpen ?? "Closed today")
          : weekday
            ? `Typical for a ${weekday}`
            : stats.avgWait != null
              ? `${stats.avgWait} min average`
              : undefined
      }
      className={className}
    >
      {loading ? (
        <div className="flex flex-col gap-3">
          <Skeleton className="h-18 w-full rounded-xl bg-wash-bar/60" />
          <div className="grid gap-1.5 md:grid-cols-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full rounded-2xl bg-wash-bar/60" />
            ))}
          </div>
        </div>
      ) : (
        <>
          {hasCurve && (
            <div className="flex flex-col gap-2">
              <HourBars
                hours={bars}
                nowValue={stats.avgWait}
                // The curve's own window, not the hours card's: `parks.crowd`
                // spans every window the park runs today (an event night keeps
                // posting waits long after the regular close), so labelling it
                // with the OPERATING row would mislabel half the bars.
                startLabel={crowd?.open ? clockTight(crowd.open, crowd.timezone) : null}
                endLabel={crowd?.close ? clockTight(crowd.close, crowd.timezone) : null}
              />
              {/* The curve is the only thing on the panel when the park is shut,
                  so it says what it is and where its peak falls. */}
              {allTypical && peak?.value != null && (
                <p className="text-[13px] font-medium text-wash-muted">
                  {weekday ? `A typical ${weekday}` : "A typical day"} — busiest around{" "}
                  <span className="font-bold text-wash-fg">{hourLabel(peak.hour)}</span> at about{" "}
                  {peak.value} min.
                </p>
              )}
            </div>
          )}

          {rows.length > 0 ? (
            <div className="flex flex-col gap-2">
              <span className="text-[11px] font-bold tracking-[0.06em] text-wash-muted uppercase">
                Longest lines
              </span>
              {/* Two columns from `md`: this panel owns the wide left column, and
                  six full-width rows down it leave the stub floating over a
                  column of nothing. */}
              <div className="grid gap-1.5 md:grid-cols-2">
                {rows.map((r) => {
                  const wait = r.standbyWait ?? 0;
                  const content = (
                    <>
                      <span className="line-clamp-1 flex-1 text-sm font-semibold">{r.name}</span>
                      <WaitPill minutes={wait} />
                    </>
                  );
                  const classes =
                    "relative top-0 flex min-w-0 items-center gap-2.5 rounded-2xl border-3d shadow-3d btn-3d-outline bg-card py-1.5 pr-1.5 pl-3.5 text-left transition-[box-shadow,top] duration-150 ease-out hover:-top-px hover:shadow-3d-hover focus-visible:ring-3 focus-visible:ring-ring/30 focus-visible:outline-none";
                  return parkSlug ? (
                    <Link
                      key={r.id}
                      to="/park/$slug/ride/$rideSlug"
                      params={{ slug: parkSlug, rideSlug: r.slug }}
                      className={classes}
                      aria-label={`${r.name} — ${wait} minute wait`}
                    >
                      {content}
                    </Link>
                  ) : (
                    <div key={r.id} className={classes}>
                      {content}
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <p className="text-sm font-medium text-wash-muted">
              {closed
                ? "No live waits while the gates are shut — the board below keeps today's history."
                : "No waits posted yet today."}
            </p>
          )}

          <div className="flex flex-wrap items-center gap-2">
            {stats.rides.length > 0 && (
              <Button
                variant="yellow"
                size="lg"
                className="h-12 min-w-0 flex-1 text-[15px] font-bold"
                // Scrolled, not navigated: a `#hash` link is a router navigation
                // here, and the board is already on this page.
                onClick={() =>
                  document
                    .getElementById(boardId)
                    ?.scrollIntoView({ behavior: "smooth", block: "start" })
                }
              >
                All {stats.rides.length} rides
                <ChevronDownIcon />
              </Button>
            )}
            <Button
              variant="outline"
              size="lg"
              className="h-12 shrink-0 text-[15px] font-bold"
              render={<Link to="/alerts" />}
            >
              <BellIcon />
              Park alerts
            </Button>
          </div>
        </>
      )}
    </WashPanel>
  );
}
