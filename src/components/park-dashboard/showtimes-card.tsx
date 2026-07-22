"use client";

import * as React from "react";

import { Card, CardContent } from "#/components/ui/card.tsx";
import {
  meaningfulShowKind,
  nextShowtime,
  parseShowtimes,
  showClock,
  untilLabel,
  type Showtime,
} from "#/lib/showtimes.ts";
import { cn } from "#/lib/utils.ts";

/**
 * "Today's showtimes" for a SHOW entity (plan item 1.1): a chip row of the day's
 * performances with the next upcoming one highlighted and a live countdown.
 * Renders nothing when there are no posted times. The `nowMs` clock ticks each
 * minute so the countdown and past/upcoming split stay current.
 */
export function ShowtimesCard({
  showtimes,
  timeZone,
}: {
  showtimes: Array<Showtime>;
  timeZone: string;
}) {
  const [nowMs, setNowMs] = React.useState(() => Date.now());
  React.useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  const times = React.useMemo(() => parseShowtimes(showtimes), [showtimes]);
  if (times.length === 0) return null;

  const next = nextShowtime(times, nowMs);
  const nextMinutes = next ? Math.round((next.ms - nowMs) / 60_000) : null;
  const kind = meaningfulShowKind(times);

  return (
    <Card>
      <CardContent className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Today’s showtimes
          </span>
          {next && nextMinutes != null && (
            <span className="text-sm text-muted-foreground">
              Next{" "}
              <span className="font-semibold text-foreground">{showClock(next.iso, timeZone)}</span>{" "}
              · {untilLabel(nextMinutes)}
            </span>
          )}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {times.map((t) => {
            const isNext = next != null && t.ms === next.ms;
            const isPast = t.ms <= nowMs;
            return (
              <span
                key={t.iso}
                className={cn(
                  "rounded-full px-2.5 py-1 text-sm font-semibold tabular-nums",
                  isNext
                    ? "bg-primary text-primary-foreground"
                    : isPast
                      ? "bg-muted text-muted-foreground/50 line-through"
                      : "bg-muted text-foreground",
                )}
              >
                {showClock(t.iso, timeZone)}
              </span>
            );
          })}
        </div>
        {kind && <span className="text-xs text-muted-foreground">{kind}</span>}
      </CardContent>
    </Card>
  );
}
