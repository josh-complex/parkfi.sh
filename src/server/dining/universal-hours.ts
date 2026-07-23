import type { DiningScheduleRow } from "./disney-dining-detail.ts";

/**
 * UOR dining hours (untapped-data follow-up, probed 2026-07-23): the places
 * feed carries `place_hours` on ~163/191 dining venues — a Google-Places-style
 * WEEKLY pattern (`periods[{open: {day, time}, close: {day, time}}]`, day
 * 0 = Sunday, 12-hour strings like "11:00 AM", literal "Closed" as a time on
 * dark days). We expand the recurring pattern into concrete dated
 * `dining_schedule` rows (the same shape the WDW `openingHoursSpecification`
 * path lands) so the whole hours surface — `dining.hours`, open/closed chips,
 * "open now" filters — lights up for Universal with zero UI changes.
 *
 * Caveat by construction: a weekly pattern refreshed weekly can't express
 * holiday deviations the way WDW's dated windows do.
 */

export interface UniversalPlaceHours {
  periods?: Array<{
    open?: { day?: number | null; time?: string | null } | null;
    close?: { day?: number | null; time?: string | null } | null;
  } | null> | null;
}

/** Park-local calendar date (UOR is US Eastern), as YYYY-MM-DD. */
export function parkToday(now = new Date()): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(now);
}

/** "11:00 AM" → "11:00:00" (24h). Null for "Closed" or anything unparseable. */
export function universalTime12(t?: string | null): string | null {
  const m = (t ?? "").trim().match(/^(1[0-2]|0?[1-9]):([0-5]\d)\s*([AP]M)$/i);
  if (!m) return null;
  let h = Number.parseInt(m[1]!, 10) % 12;
  if (m[3]!.toUpperCase() === "PM") h += 12;
  return `${String(h).padStart(2, "0")}:${m[2]}:00`;
}

/**
 * Expand a venue's weekly pattern into dated rows for `days` days starting at
 * `fromDate` (park-local YYYY-MM-DD). Periods whose open or close is missing/
 * "Closed" are skipped; duplicate (date, start) pairs collapse.
 */
export function universalScheduleRows(
  facilityId: string,
  hours: UniversalPlaceHours | null | undefined,
  fromDate: string,
  days = 14,
): Array<DiningScheduleRow> {
  const periods = (hours?.periods ?? []).filter((p) => p != null);
  if (periods.length === 0) return [];
  const start = new Date(`${fromDate}T12:00:00Z`); // noon anchor sidesteps DST edges
  if (Number.isNaN(start.getTime())) return [];
  const out: Array<DiningScheduleRow> = [];
  const seen = new Set<string>();
  for (let i = 0; i < days; i++) {
    const date = new Date(start.getTime() + i * 86_400_000).toISOString().slice(0, 10);
    const weekday = new Date(`${date}T00:00:00Z`).getUTCDay(); // 0 = Sunday, matches the feed
    for (const p of periods) {
      if (p.open?.day !== weekday) continue;
      const startTime = universalTime12(p.open.time);
      const endTime = universalTime12(p.close?.time);
      if (!startTime || !endTime) continue;
      const key = `${date}|${startTime}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ facilityId, scheduleDate: date, scheduleType: "Operating", startTime, endTime });
    }
  }
  return out;
}

/**
 * One-line display address from the places-feed address object
 * ("5600 Universal Boulevard, Orlando, FL 32819"). Country dropped — every
 * observed row is USA.
 */
export function universalAddressLine(
  a?: {
    address_line1?: string | null;
    city?: string | null;
    state?: string | null;
    postal_code?: string | null;
    country_code?: string | null;
  } | null,
): string | null {
  if (!a) return null;
  const statePostal = [a.state, a.postal_code].filter(Boolean).join(" ");
  const line = [a.address_line1?.trim(), a.city?.trim(), statePostal].filter(Boolean).join(", ");
  return line || null;
}
