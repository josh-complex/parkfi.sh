"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";

import { DayHeatGrid, WeekdayBars } from "#/components/detail/day-series.tsx";
import { DetailCard } from "#/components/detail/panels.tsx";
import { useTRPC } from "#/integrations/trpc/react.ts";

/** Days of check-in dates the calendar asks for — six whole weeks of grid. */
const HORIZON_DAYS = 60;
/** Weeks the grid draws, starting on the first date we hold (a forecast). */
const GRID_WEEKS = 6;
/**
 * Days folded into the weekday bars. Whole weeks only, or the ranking is an
 * artifact of where the window was cut — `WeekdayBars` withholds its caption
 * when the window isn't one (see the venue page's `PlanAhead`).
 */
const WEEKDAY_DAYS = 28;
/** Under this many priced dates the two charts are mostly empty cells. */
const MIN_PRICED_DAYS = 7;

const usd = (value: number) => `$${Math.round(value).toLocaleString()}`;

/**
 * Which check-in date to start a stay on, and which weekday this resort
 * rewards — the resort page's "Know" band, over rates instead of waits.
 *
 * Both charts read one payload (`stays.cheapestDays`) and are the shared
 * day-scale pair `detail/day-series.tsx` draws for the park page's crowd
 * calendar and the venue page's openings: one calendar and one weekday chart in
 * the app, whatever the series behind them measures.
 *
 * ## Three cell states, kept apart
 *
 * `stay_obs` is not a price calendar — it holds what the sweep has looked at
 * (see `readCheapestCheckInDays`). So a date we have never priced draws as a
 * hairline, a date we priced and found sold out draws as the neutral zero step,
 * and only a date with a real rate takes the ramp. Collapsing the first two
 * into one pale swatch would put "we don't know" and "you can't book it" in the
 * same colour as a bargain.
 *
 * Renders nothing until there is enough priced history to say anything: a
 * resort nobody has searched has no calendar, and six rows of grey is worse
 * than no card.
 */
export function ResortRateCalendar({
  resortId,
  store,
  adults,
  children,
  childAges,
  accessible,
  floridaResident,
  partyLabel,
}: {
  resortId: string;
  store: "wdw" | "dlr";
  adults: number;
  children: number;
  childAges: Array<number>;
  accessible: boolean;
  floridaResident: boolean;
  /** "2 adults" — the party these rates are for, named in both captions. */
  partyLabel: string;
}) {
  const trpc = useTRPC();
  const q = useQuery(
    trpc.stays.cheapestDays.queryOptions({
      resortId,
      store,
      adults,
      children,
      childAges,
      accessible,
      floridaResident,
      days: HORIZON_DAYS,
    }),
  );

  const days = React.useMemo(
    () =>
      (q.data?.days ?? []).map((d) => ({
        date: d.date,
        // A date we priced and found sold out is a real zero; a date we hold a
        // row for but no rate on is not, and must not be ramped.
        value: d.pricePerNight ?? (d.available ? null : 0),
      })),
    [q.data],
  );
  // The weekday bars can only average dates that carry a rate — a sold-out day
  // is not a $0 day, and folding its zero in would drag its weekday's mean
  // toward "cheap" for exactly the reason it is unbookable.
  const priced = React.useMemo(
    () => days.filter((d): d is { date: string; value: number } => !!d.value),
    [days],
  );
  const weekdayDays = React.useMemo(
    () => priced.slice(0, Math.min(WEEKDAY_DAYS, Math.floor(priced.length / 7) * 7)),
    [priced],
  );

  if (priced.length < MIN_PRICED_DAYS) return null;

  return (
    <div className="grid gap-4 md:grid-cols-[19rem_minmax(0,1fr)] md:gap-6">
      <DetailCard
        title="Cheapest check-in days"
        description={`Lowest nightly rate we've seen · ${partyLabel} · palest is cheapest`}
      >
        <DayHeatGrid days={days} align="start" weeks={GRID_WEEKS} unit={usd} zeroLabel="Sold out" />
      </DetailCard>
      <DetailCard
        title="By day of week"
        description={`Average nightly rate per check-in weekday · next ${weekdayDays.length} priced days · cheapest in green`}
      >
        <WeekdayBars
          days={weekdayDays}
          good="min"
          unit={usd}
          caption={({ best, worst }) =>
            `Checking in on a ${best} costs least; a ${worst} costs most.`
          }
        />
      </DetailCard>
    </div>
  );
}
