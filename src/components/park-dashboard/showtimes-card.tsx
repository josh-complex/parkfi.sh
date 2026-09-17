"use client";

import * as React from "react";

import { WashPanel } from "#/components/detail/panels.tsx";
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
 *
 * `variant="wash"` makes it the ride page's **job block** — a show has no
 * standby to curve, and the question a guest brings to one is what time it
 * starts, so the times take the wash field a coaster spends on its day.
 */
export function ShowtimesCard({
  showtimes,
  timeZone,
  variant = "card",
  children,
  className,
}: {
  showtimes: Array<Showtime>;
  timeZone: string;
  variant?: "card" | "wash";
  /** The page's keys, under the times (wash variant only). */
  children?: React.ReactNode;
  className?: string;
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

  const wash = variant === "wash";
  // The clock chips. One vocabulary for both variants — what changes is the
  // field they sit on, so the past/next/upcoming split reads the same either way.
  const chips = (
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
                ? wash
                  ? "bg-brand-yellow text-ink-on-yellow border-3d shadow-3d btn-3d-yellow"
                  : "bg-primary text-primary-foreground"
                : isPast
                  ? wash
                    ? "bg-background/60 text-wash-muted line-through"
                    : "bg-muted text-muted-foreground/50 line-through"
                  : wash
                    ? "bg-background text-wash-fg"
                    : "bg-muted text-foreground",
            )}
          >
            {showClock(t.iso, timeZone)}
          </span>
        );
      })}
    </div>
  );

  if (wash) {
    return (
      <WashPanel
        title="Showtimes today"
        meta={
          next && nextMinutes != null
            ? `Next ${showClock(next.iso, timeZone)} \u00b7 ${untilLabel(nextMinutes)}`
            : "That\u2019s the last one today"
        }
        className={className}
      >
        {chips}
        {kind && <p className="text-[13px] text-wash-muted">{kind}</p>}
        {children}
      </WashPanel>
    );
  }

  return (
    <Card className={className}>
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
        {chips}
        {kind && <span className="text-xs text-muted-foreground">{kind}</span>}
      </CardContent>
    </Card>
  );
}
