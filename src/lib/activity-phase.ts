/**
 * Time-of-day phase engine for the /activity recap card — the "twilight mode".
 *
 * A park day is skinned by a `dawn → day → dusk → night` arc keyed off a
 * representative park-local hour: the LIVE hour for today (so today's card
 * shifts through the day as you use it) and the last-seen hour for past days
 * (a close-nighter ends "after dark", a morning visit ends in daylight).
 *
 * Client-safe and pure (aside from an injectable `now`): no server/db imports.
 */

export type DayPhase = "dawn" | "day" | "dusk" | "night";

/** Park-local hour (0–23) for an instant, via Intl. */
export function localHourInZone(at: Date, timeZone: string): number {
  const h = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "2-digit",
    hourCycle: "h23",
  }).format(at);
  return Number(h) % 24;
}

/** Park-local calendar day (YYYY-MM-DD) for an instant, via Intl. */
export function localDayInZone(at: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);
}

/** Map a park-local hour to its phase. dawn 5–8, day 8–17, dusk 17–20, else night. */
export function dayPhase(hour: number): DayPhase {
  if (hour >= 5 && hour < 8) return "dawn";
  if (hour >= 8 && hour < 17) return "day";
  if (hour >= 17 && hour < 20) return "dusk";
  return "night";
}

/** Eyebrow label above the step count. Daytime keeps the plain header; the
 *  other phases add their flavor (matching the mockups: day → "Today's park
 *  day", night → "Park day · After dark"). */
export function phaseEyebrow(phase: DayPhase, isToday: boolean): string {
  const suffix: Partial<Record<DayPhase, string>> = {
    dawn: "Rope drop",
    dusk: "Golden hour",
    night: "After dark",
  };
  const flavor = suffix[phase];
  if (!flavor) return isToday ? "Today's park day" : "Park day";
  return `Park day · ${flavor}`;
}

export interface DayForPhase {
  /** The recap's park-local day (YYYY-MM-DD). */
  day: string;
  /** When the visit last recorded a ping (drives past-day phase). */
  lastSeenAt: Date | string;
  /** Park timezone (first entry's — hop days share a resort zone). */
  timezone: string;
}

/**
 * Resolve the phase + eyebrow for a recap day. Today (in the park's zone) uses
 * the live clock; a past day uses its last-seen hour. `now` is injectable for
 * tests.
 */
export function resolveDayPhase(
  input: DayForPhase,
  now: Date = new Date(),
): { phase: DayPhase; isToday: boolean } {
  const isToday = localDayInZone(now, input.timezone) === input.day;
  const at = isToday ? now : new Date(input.lastSeenAt);
  return { phase: dayPhase(localHourInZone(at, input.timezone)), isToday };
}
