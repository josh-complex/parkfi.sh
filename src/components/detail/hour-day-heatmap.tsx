"use client";

import * as React from "react";

import { cn } from "#/lib/utils.ts";

import {
  ChartLegend,
  ChartSentence,
  HeatRampKey,
  LegendKey,
  deltaClause,
  deltaTone,
  heatBg,
  heatStepOf,
  hourLabel,
  mean,
} from "./chart-kit.tsx";

export interface HourDayCell {
  /** Park-local `YYYY-MM-DD`. */
  date: string;
  /** Park-local hour, 0–23. */
  hour: number;
  value: number;
}

function dayLabel(date: string, long = false): string {
  return new Date(`${date}T12:00:00`).toLocaleDateString("en-US", {
    weekday: long ? "long" : "short",
    month: long ? "short" : undefined,
    day: "numeric",
  });
}

/**
 * Days down, hours across, each cell shaded on the house heat ramp: the
 * crowd calendar the park and ride pages both draw. The cell you point at is
 * spoken in the sentence above and compared with the average open hour; the
 * hour you are standing in (today's row, this hour) is ringed in yellow.
 */
export function HourDayHeatmap({
  cells,
  today,
  nowHour,
  unit,
  subject = "this ride",
  className,
}: {
  cells: Array<HourDayCell>;
  /** Park-local today, to ring the current cell and lead its row. */
  today?: string | null;
  /** Park-local current hour. */
  nowHour?: number | null;
  unit: (value: number) => string;
  /** What the figures are of — "this ride", "the park". */
  subject?: string;
  className?: string;
}) {
  const [sel, setSel] = React.useState<string | null>(null);

  const model = React.useMemo(() => {
    const dates = [...new Set(cells.map((c) => c.date))].sort();
    let lo = 23;
    let hi = 0;
    const byKey = new Map<string, number>();
    for (const c of cells) {
      lo = Math.min(lo, c.hour);
      hi = Math.max(hi, c.hour);
      byKey.set(`${c.date}|${c.hour}`, c.value);
    }
    const hours = hi >= lo ? Array.from({ length: hi - lo + 1 }, (_, i) => lo + i) : [];
    const vals = cells.map((c) => c.value);
    const vLo = vals.length ? Math.min(...vals) : 0;
    const vHi = vals.length ? Math.max(...vals) : 0;
    const avg = mean(vals) ?? 0;
    const peak = cells.reduce<HourDayCell | null>(
      (b, c) => (!b || c.value > b.value ? c : b),
      null,
    );
    const trough = cells.reduce<HourDayCell | null>(
      (b, c) => (!b || c.value < b.value ? c : b),
      null,
    );
    return { dates, hours, byKey, vLo, vHi, avg, peak, trough };
  }, [cells]);

  if (cells.length === 0 || model.hours.length === 0) return null;
  const { dates, hours, byKey, vLo, vHi, avg, peak, trough } = model;

  const active = sel ? (byKey.has(sel) ? sel : null) : null;
  let headline: string;
  let subline: string;
  let tone: "good" | "bad" | "neutral" = "neutral";
  if (active) {
    const [d, h] = active.split("|") as [string, string];
    const v = byKey.get(active)!;
    headline = `${dayLabel(d, true)} at ${hourLabel(Number(h))} · ${unit(v)}`;
    subline = deltaClause(v, avg, unit, `the average open hour`, {
      more: "longer than",
      less: "shorter than",
    });
    tone = deltaTone(v, avg);
  } else if (peak && trough) {
    headline = `Busiest: ${dayLabel(peak.date)} at ${hourLabel(peak.hour)} · ${unit(peak.value)}`;
    subline = `Quietest open hour was ${dayLabel(trough.date)} at ${hourLabel(trough.hour)} · ${unit(trough.value)}. Tap a cell for its hour.`;
  } else {
    headline = `What ${subject} did hour by hour`;
    subline = "Tap a cell for its hour.";
  }

  const grid = { gridTemplateColumns: `2.75rem repeat(${hours.length}, minmax(0, 1fr))` };

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      <ChartSentence headline={headline} subline={subline} tone={tone} size="sm" />

      <div className="flex flex-col gap-[3px]" onMouseLeave={() => setSel(null)}>
        <div className="grid gap-[3px]" style={grid} aria-hidden>
          <span />
          {hours.map((h) => (
            <span
              key={h}
              className={cn(
                "min-w-0 text-center text-[10px] leading-[14px] font-bold whitespace-nowrap",
                h === nowHour ? "text-wash-fg" : "text-wash-muted",
              )}
            >
              {h % 3 === 0 ? hourLabel(h).replace(" ", " ") : ""}
            </span>
          ))}
        </div>
        {dates.map((d) => {
          const isToday = d === today;
          return (
            <div key={d} className="grid items-center gap-[3px]" style={grid}>
              <span
                className={cn(
                  "truncate pr-1 text-right text-[10px] leading-none font-bold",
                  isToday ? "text-wash-fg" : "text-wash-muted",
                )}
              >
                {isToday ? "Today" : dayLabel(d)}
              </span>
              {hours.map((h) => {
                const key = `${d}|${h}`;
                const v = byKey.get(key);
                const hot = sel === key;
                const isNow = isToday && h === nowHour;
                if (v == null) {
                  return (
                    <span
                      key={h}
                      aria-hidden
                      className={cn(
                        "h-4 rounded-[3px] md:h-[18px]",
                        isNow
                          ? "bg-wash-bar/60 ring-2 ring-brand-yellow ring-inset"
                          : "bg-wash-bar/35",
                      )}
                    />
                  );
                }
                return (
                  <button
                    key={h}
                    type="button"
                    aria-label={`${dayLabel(d, true)} at ${hourLabel(h)}: ${unit(v)}`}
                    aria-pressed={hot}
                    onMouseEnter={() => setSel(key)}
                    onFocus={() => setSel(key)}
                    onBlur={() => setSel(null)}
                    onClick={() => setSel(key)}
                    className={cn(
                      "h-4 min-w-0 cursor-pointer rounded-[3px] outline-none transition-[box-shadow] md:h-[18px]",
                      heatBg(heatStepOf(v, vLo, vHi)),
                      isNow && "ring-2 ring-brand-yellow ring-inset",
                      hot && "ring-[3px] ring-wash-fg/50 ring-inset",
                    )}
                  />
                );
              })}
            </div>
          );
        })}
      </div>

      <ChartLegend>
        <HeatRampKey from={unit(vLo)} to={unit(vHi)} />
        {today && nowHour != null && <LegendKey swatch="now">This hour</LegendKey>}
      </ChartLegend>
    </div>
  );
}
