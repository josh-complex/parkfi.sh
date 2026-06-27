/**
 * Park operating-hours formatting. `park_schedule` stores opening/closing as
 * `timestamptz` (absolute instants), so every display must be rendered in the
 * park's own timezone — never the viewer's. These helpers take the raw ISO
 * string the API returns plus the park `timeZone` and format locally.
 */

/** Clock time in the park's timezone, e.g. "9:00 AM". */
export function formatHour(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(iso));
}

/** Compact clock time for dense cells, e.g. "9a" or "10:30p" (drops ":00"). */
export function formatHourShort(iso: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).formatToParts(new Date(iso));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const hour = get("hour");
  const minute = get("minute");
  const ap = get("dayPeriod").toLowerCase().startsWith("p") ? "p" : "a";
  return minute === "00" ? `${hour}${ap}` : `${hour}:${minute}${ap}`;
}

/** Open–close range in the park's timezone; null when either bound is missing. */
export function formatHourRange(
  open: string | null,
  close: string | null,
  timeZone: string,
  short = false,
): string | null {
  if (!open || !close) return null;
  if (short) return `${formatHourShort(open, timeZone)}–${formatHourShort(close, timeZone)}`;
  return `${formatHour(open, timeZone)} – ${formatHour(close, timeZone)}`;
}

/** Today's date as `YYYY-MM-DD` in the given timezone — matches a `service_date`. */
export function todayInTz(timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}
