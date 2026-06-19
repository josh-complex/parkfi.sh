/**
 * Format an ISO instant as a time-of-day string (e.g. "6:45 PM") in an explicit
 * timezone.
 *
 * Park times — Lightning Lane return windows, opening hours — are wall-clock
 * times *at the park*, so we format them in the park's own zone. Pinning the
 * zone is also what keeps server and client output identical: a bare
 * `toLocaleTimeString` reads the runtime zone (UTC on the server, the viewer's
 * zone in the browser), the two disagree, and that trips a React hydration
 * mismatch (#418) which crashes the reconciler and blanks the page in
 * production.
 */
export function formatTimeInZone(iso: string, timeZone: string | null | undefined): string {
  return new Date(iso).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: timeZone || "America/New_York",
  });
}
