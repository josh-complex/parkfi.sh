"use client";

import { cn } from "#/lib/utils.ts";

/** One hour in the day's curve. */
export interface HourBar {
  /** Park-local hour of day, 0–23. */
  hour: number;
  /** Average standby for that hour, or null when nothing was posted. */
  value: number | null;
  /** True when `value` is what this hour *usually* does rather than what it did
   *  — every hour still ahead of the guest. */
  projected: boolean;
  /** The hour the guest is standing in. At most one bar carries it. */
  now: boolean;
}

/** "9 AM", "Noon", "1 PM" — a park-local hour, in the park's own words. */
export function hourLabel(hour: number): string {
  if (hour === 12) return "Noon";
  if (hour === 0) return "Midnight";
  const h = hour % 12 === 0 ? 12 : hour % 12;
  return `${h} ${hour < 12 ? "AM" : "PM"}`;
}

/**
 * The wash panel's day curve: one bar per operating hour, the hour you're
 * standing in picked out in brand yellow.
 *
 * Past hours are the pale `--wash-bar` and hours still to come are the stronger
 * one, which is the opposite of the instinct — but the strong bars are the
 * *claim* ("this is what 7 PM usually does"), and a guest reading the panel is
 * looking forward, not back. The shape only works if it's one continuous
 * silhouette, so a projected hour draws at the same scale as a measured one and
 * the difference is carried by colour plus the tooltip, never by a gap.
 *
 * Deliberately not a visx chart: fourteen `<div>`s cost nothing, render on the
 * server, and need no axis — the legend row underneath is the whole scale.
 */
export function HourBars({
  hours,
  /** The live figure for the current hour, shown in the legend ("Now · 23 min").
   *  Comes from the live board rather than this series, so it matches the
   *  ticket's "Avg wait" to the minute. */
  nowValue,
  /** Override the end ticks with the park's real open/close times — the last
   *  bar is the hour *before* closing, so "6 PM" under a park that shuts at 7
   *  reads as a mistake. */
  startLabel,
  endLabel,
  className,
}: {
  hours: Array<HourBar>;
  nowValue?: number | null;
  startLabel?: string | null;
  endLabel?: string | null;
  className?: string;
}) {
  if (hours.length === 0) return null;
  // Floor the scale so a genuinely quiet park doesn't draw a 4-minute hour as a
  // full-height bar and read as a wall-to-wall queue.
  const peak = Math.max(20, ...hours.map((h) => h.value ?? 0));
  const first = hours[0]!;
  const last = hours[hours.length - 1]!;
  const now = hours.find((h) => h.now) ?? null;
  const nowMinutes = nowValue ?? now?.value ?? null;
  // Noon earns a label only when it isn't standing right next to the "now"
  // legend, which would put two marks on the same stretch of the row.
  const showNoon = hours.some((h) => h.hour === 12) && (!now || Math.abs(now.hour - 12) > 2);

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <div className="flex h-18 items-end gap-1 md:h-22" aria-hidden>
        {hours.map((h) => {
          const value = h.value;
          const pct = value == null ? 4 : Math.max(6, Math.round((value / peak) * 100));
          return (
            <div
              key={h.hour}
              title={
                value == null
                  ? `${hourLabel(h.hour)} · no data`
                  : `${hourLabel(h.hour)} · ${value} min${h.projected ? " typical" : ""}`
              }
              style={{ height: `${pct}%` }}
              className={cn(
                "min-w-0 flex-1 rounded-t",
                h.now
                  ? "bg-brand-yellow"
                  : value == null
                    ? "bg-wash-bar/50"
                    : h.projected
                      ? "bg-wash-bar-strong"
                      : "bg-wash-bar",
              )}
            />
          );
        })}
      </div>
      <div className="flex justify-between text-[10px] font-bold uppercase tracking-[0.06em] text-wash-muted">
        <span>{startLabel ?? hourLabel(first.hour)}</span>
        {showNoon && <span>Noon</span>}
        {now && (
          <span className="text-wash-fg">
            Now{nowMinutes != null ? ` · ${nowMinutes} min` : ""}
          </span>
        )}
        <span>{endLabel ?? hourLabel(last.hour)}</span>
      </div>
      {/* The bars are decorative; this is the series a screen reader gets. */}
      <p className="sr-only">
        Average wait by hour, {hourLabel(first.hour)} to {hourLabel(last.hour)}:{" "}
        {hours
          .filter((h) => h.value != null)
          .map((h) => `${hourLabel(h.hour)} ${h.value} minutes${h.projected ? " typical" : ""}`)
          .join(", ")}
        .
      </p>
    </div>
  );
}
