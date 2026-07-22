/**
 * Shared helpers for SHOW entity showtimes (plan item 1.1). The live feed gives
 * us each performance as `{type, start, end}` with raw ISO times carrying the
 * park-local offset. Consumers: the ride/show detail card, the park-dashboard
 * "Entertainment today" rail, and the map show-pin popover.
 */

export interface Showtime {
  type: string | null;
  start: string | null;
  end: string | null;
}

export interface ParsedShowtime {
  /** Epoch ms of the start, for sorting / countdown math. */
  ms: number;
  /** The raw ISO start string, for formatting in the park timezone. */
  iso: string;
  type: string | null;
}

/** Parse + sort showtimes by start, dropping unparseable entries. */
export function parseShowtimes(showtimes: Array<Showtime>): Array<ParsedShowtime> {
  return showtimes
    .flatMap((s) => {
      if (!s.start) return [];
      const ms = new Date(s.start).getTime();
      if (Number.isNaN(ms)) return [];
      return [{ ms, iso: s.start, type: s.type }];
    })
    .sort((a, b) => a.ms - b.ms);
}

/** The next performance at/after `nowMs`, or null when the day's shows are done. */
export function nextShowtime(times: Array<ParsedShowtime>, nowMs: number): ParsedShowtime | null {
  return times.find((t) => t.ms > nowMs) ?? null;
}

/** Format an ISO time as a park-local clock, e.g. "3:00 PM". */
export function showClock(iso: string, timeZone: string): string {
  return new Date(iso).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone,
  });
}

/** Human "in 25 min" / "in 1 hr 10 min" from a positive minute delta. */
export function untilLabel(minutes: number): string {
  if (minutes < 1) return "starting now";
  if (minutes < 60) return `in ${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `in ${h} hr` : `in ${h} hr ${m} min`;
}

/**
 * The showtime `type` is usually the generic "Performance Time"; surface a label
 * only when it carries something more specific (e.g. "Parade", "Fireworks").
 */
export function meaningfulShowKind(times: Array<ParsedShowtime>): string | null {
  return times.find((t) => t.type && t.type !== "Performance Time")?.type ?? null;
}
