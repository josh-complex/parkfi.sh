/**
 * Shared shape + formatting for dining-alert notifications. The evaluator builds
 * a `DiningNotificationPayload` (persisted as `dining_notification.payload`); the
 * mailer renders from it. Framework-free so both the worker and the evaluator can
 * import it without pulling in React. Mirrors `stayFormat.ts`.
 */
import { wrapDeepLink } from "#/server/notifications/deepLinkRedirect.ts";

/** What we persist on `dining_notification.payload` — enough to render + audit. */
export interface DiningNotificationPayload {
  facilityId: string; // '' = any priority restaurant
  restaurantName: string;
  partySize: number;
  // The date axis the alert watched (exactly one is set).
  serviceDate: string | null; // YYYY-MM-DD
  windowDays: number | null;
  // The specific date the match was observed on (for "any day in window" alerts).
  matchedDate: string;
  dateLabel: string;
  subject: string;
  // My Disney Experience deep link pre-scoped to the matched offer, or null when
  // the match lacks a specific facility/time to scope it to (shouldn't happen
  // once matchedDate is set, but the offer time is a separate nullable column).
  deepLink: string | null;
}

/** "Jul 4, 2026" from a YYYY-MM-DD string. */
export function formatServiceDate(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

/**
 * Human label for an alert's date axis: a single day ("Jul 4, 2026") or a
 * rolling window ("any day in the next 30 days").
 */
export function diningDateLabel(serviceDate: string | null, windowDays: number | null): string {
  if (serviceDate) return formatServiceDate(serviceDate);
  if (windowDays) return `any day in the next ${windowDays} days`;
  return "your dates";
}

/**
 * My Disney Experience's `mdx://` deep-link scheme (route table recovered by
 * static decompile, see `docs/plans/jiminy/write-spike.md`). Opens the app
 * straight into the reservation flow, pre-scoped to a facility/party/time;
 * `completionDeepLink` bounces the user back once they're done. `serviceDate`
 * + `offerTime` combine into a local (no-offset) ISO 8601 datetime — dining
 * times are park-local, and MDE expects that, not UTC. Returned wrapped
 * through `/deep-link` (see `deepLinkRedirect.ts`) since a raw `mdx://` href
 * gets silently stripped by email HTML sanitizers.
 */
export function buildDiningDeepLink(params: {
  facilityId: string;
  partySize: number;
  serviceDate: string; // YYYY-MM-DD
  offerTime: string; // HH:MM:SS
  completionDeepLink: string;
}): string {
  const qs = new URLSearchParams({
    id: params.facilityId,
    partySize: String(params.partySize),
    dateTime: `${params.serviceDate}T${params.offerTime}`,
    completionDeepLink: params.completionDeepLink,
  });
  return wrapDeepLink(`mdx://dining/reservation?${qs.toString()}`);
}
