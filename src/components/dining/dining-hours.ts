/**
 * Pure helpers for the `dining.hours` data: a venue's operating schedule for a
 * given date, plus open-now / breakfast / late classification against the
 * current Walt Disney World local time (America/New_York). The server returns
 * raw start/end times and stays time-agnostic; all "is it open?" logic lives
 * here so badges stay fresh between refetches.
 */

export interface ScheduleEntry {
  scheduleType: string; // "Operating" | "Extended Evening" | "Early Entry" | …
  startTime: string; // "HH:MM:SS"
  endTime: string; // "HH:MM:SS"
}

export interface HoursEntry {
  facilityId: string;
  schedules: Array<ScheduleEntry>;
}

export type HoursMap = Map<string, Array<ScheduleEntry>>;

export type HoursFilter = "ALL" | "now" | "breakfast" | "late";

export const HOURS_LABELS: Record<HoursFilter, string> = {
  ALL: "Any hours",
  now: "Open now",
  breakfast: "Breakfast",
  late: "Open late",
};

/**
 * The hours options offered in the filter UI. There is no "Any" escape hatch —
 * a venue's hours always narrow the list, defaulting to `now` (see DEFAULT_FILTERS).
 */
export const HOURS_OPTIONS: ReadonlyArray<Exclude<HoursFilter, "ALL">> = [
  "now",
  "breakfast",
  "late",
];

// Breakfast = a service that begins at/before 10:30; late = one that runs to or
// past 21:00. Thresholds in minutes-since-midnight, park-local.
const BREAKFAST_BY = 10 * 60 + 30;
const LATE_FROM = 21 * 60;

/** Minutes since midnight from an "HH:MM[:SS]" time string. */
function toMinutes(time: string): number {
  const [h, m] = time.split(":");
  return Number(h) * 60 + Number(m);
}

/** Current minutes-since-midnight in the WDW park timezone. */
export function parkNowMinutes(now: Date = new Date()): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const h = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  const m = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
  // Intl emits "24" for midnight in some runtimes; normalize.
  return (h % 24) * 60 + m;
}

/** Today's date (YYYY-MM-DD) in the WDW park timezone. */
export function parkToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/** Operating-only schedules (drop Early Entry / Extended Evening overlays). */
function operating(schedules: Array<ScheduleEntry>): Array<ScheduleEntry> {
  return schedules.filter((s) => s.scheduleType === "Operating");
}

/** True when `nowMin` falls within any operating window (handles past-midnight closes). */
export function isOpenNow(schedules: Array<ScheduleEntry>, nowMin: number): boolean {
  return operating(schedules).some((s) => {
    const start = toMinutes(s.startTime);
    const end = toMinutes(s.endTime);
    // A close <= open means the venue runs past midnight (e.g. 17:00–01:00).
    if (end <= start) return nowMin >= start || nowMin < end;
    return nowMin >= start && nowMin < end;
  });
}

export function servesBreakfast(schedules: Array<ScheduleEntry>): boolean {
  return operating(schedules).some((s) => toMinutes(s.startTime) <= BREAKFAST_BY);
}

export function isOpenLate(schedules: Array<ScheduleEntry>): boolean {
  return operating(schedules).some((s) => {
    const start = toMinutes(s.startTime);
    const end = toMinutes(s.endTime);
    return end <= start || end >= LATE_FROM; // past-midnight always counts as late
  });
}

/** Compact label for a venue's primary operating window today ("11:00 AM–9:00 PM"). */
export function hoursLabel(schedules: Array<ScheduleEntry>): string | null {
  const op = operating(schedules);
  if (!op.length) return null;
  const fmt = (t: string) => {
    const min = toMinutes(t);
    const h24 = Math.floor(min / 60) % 24;
    const m = min % 60;
    const ampm = h24 < 12 ? "AM" : "PM";
    const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
    return m === 0 ? `${h12} ${ampm}` : `${h12}:${String(m).padStart(2, "0")} ${ampm}`;
  };
  const first = op[0]!;
  const last = op[op.length - 1]!;
  return `${fmt(first.startTime)}–${fmt(last.endTime)}`;
}
