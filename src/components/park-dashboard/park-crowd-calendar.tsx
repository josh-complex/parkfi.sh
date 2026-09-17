"use client";

import { DetailCard } from "#/components/detail/panels.tsx";
import { Skeleton } from "#/components/ui/skeleton.tsx";
import { cn } from "#/lib/utils.ts";

import type { ParkCrowd } from "./types.ts";

/** Sunday-first, as the calendar reads. */
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

/** A park-local `YYYY-MM-DD` as a real date, at local midnight — never
 *  `Date.parse("2026-09-13")`, which is UTC and lands a day early west of
 *  Greenwich. */
function day(date: string): Date {
  return new Date(`${date}T00:00:00`);
}

/**
 * Which of the five heat steps a value falls in. Quintiles of the *observed*
 * range rather than fixed minute thresholds: parks differ by a factor of four
 * (a 12-minute Tuesday at Universal Studios is a quiet day; at Magic Kingdom
 * it's a miracle), and a fixed ramp paints the quiet park entirely pale.
 */
function heatStep(value: number, lo: number, hi: number): number {
  if (hi <= lo) return 3;
  return Math.min(5, Math.max(1, Math.ceil(((value - lo) / (hi - lo)) * 5)));
}

const HEAT_BG = ["bg-heat-1", "bg-heat-2", "bg-heat-3", "bg-heat-4", "bg-heat-5"] as const;

/**
 * "Busiest days" — five weeks of the park's daily average standby as a calendar
 * grid, today outlined. No numbers in the cells (they're illegible at this
 * size — plan deviation D3); every cell carries its figure in its tooltip and
 * in the table a screen reader reads.
 */
function BusiestDays({ days, today }: { days: ParkCrowd["days"]; today: string | null }) {
  const byDate = new Map(days.map((d) => [d.date, d.avgWait]));
  const values = days.map((d) => d.avgWait);
  const lo = Math.min(...values);
  const hi = Math.max(...values);

  // A whole number of weeks ending on the last day we have, padded back to
  // Sunday so every column really is one weekday.
  const last = days.length > 0 ? day(days[days.length - 1]!.date) : new Date();
  const end = new Date(last);
  end.setDate(end.getDate() + (6 - end.getDay()));
  const cells: Array<{ iso: string; label: string; value: number | null }> = [];
  for (let i = 34; i >= 0; i--) {
    const d = new Date(end);
    d.setDate(d.getDate() - i);
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    cells.push({
      iso,
      label: d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }),
      value: byDate.get(iso) ?? null,
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-7 gap-1.5">
        {WEEKDAYS.map((w) => (
          <span
            key={w}
            className="text-center text-[10px] font-bold tracking-[0.06em] text-muted-foreground uppercase"
          >
            {w.slice(0, 1)}
          </span>
        ))}
        {cells.map((c) => (
          <div
            key={c.iso}
            title={c.value == null ? `${c.label} · no data` : `${c.label} · ${c.value} min`}
            className={cn(
              "aspect-square rounded-[6px]",
              c.value == null ? "bg-muted" : HEAT_BG[heatStep(c.value, lo, hi) - 1],
              c.iso === today && "ring-2 ring-brand-yellow ring-offset-1 ring-offset-card",
            )}
          />
        ))}
      </div>
      <div className="flex items-center justify-end gap-1.5 text-[10px] font-semibold text-muted-foreground">
        <span>{lo} min</span>
        {HEAT_BG.map((bg) => (
          <span key={bg} className={cn("size-2.5 rounded-[3px]", bg)} />
        ))}
        <span>{hi} min</span>
      </div>
    </div>
  );
}

/**
 * "By day of week" — the same five weeks folded onto the seven weekdays, so a
 * guest choosing a day can see which one this park actually rewards. The
 * quietest bar is picked out in green; it's the answer to the question the card
 * is asking.
 */
function ByWeekday({ days }: { days: ParkCrowd["days"] }) {
  const buckets = WEEKDAYS.map(() => [] as Array<number>);
  for (const d of days) buckets[day(d.date).getDay()]!.push(d.avgWait);
  const means = buckets.map((xs) =>
    xs.length === 0 ? null : Math.round(xs.reduce((a, b) => a + b, 0) / xs.length),
  );
  const present = means.filter((m): m is number => m != null);
  if (present.length === 0) return null;
  const peak = Math.max(...present);
  const quietest = Math.min(...present);

  return (
    <div className="flex items-end gap-2">
      {means.map((m, i) => (
        <div key={WEEKDAYS[i]} className="flex min-w-0 flex-1 flex-col items-center gap-1.5">
          <span className="text-[11px] font-bold tabular-nums">{m ?? "—"}</span>
          <div className="flex h-28 w-full items-end">
            <div
              title={`${WEEKDAYS[i]} · ${m ?? "no"} min average`}
              style={{ height: `${m == null ? 3 : Math.max(6, Math.round((m / peak) * 100))}%` }}
              className={cn(
                "w-full rounded-t",
                m == null
                  ? "bg-muted"
                  : m === quietest
                    ? "bg-wait-cool"
                    : "bg-wash-bar-strong dark:bg-wash-bar-strong",
              )}
            />
          </div>
          <span className="text-[10px] font-bold tracking-[0.04em] text-muted-foreground uppercase">
            {WEEKDAYS[i]!.slice(0, 1)}
          </span>
        </div>
      ))}
    </div>
  );
}

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
  className,
}: {
  crowd: ParkCrowd | undefined;
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

  return (
    <div className="grid gap-4 md:grid-cols-[2fr_3fr] md:gap-6">
      <DetailCard title="Busiest days" description="Park-wide average standby · today outlined">
        <BusiestDays days={days} today={crowd?.date ?? null} />
      </DetailCard>
      <DetailCard
        title="By day of week"
        description="Average standby per weekday · 5 weeks · quietest in green"
      >
        <ByWeekday days={days} />
      </DetailCard>
    </div>
  );
}
