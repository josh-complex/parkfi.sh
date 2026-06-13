/**
 * Shared shape + formatting for dining-alert notifications. The evaluator builds
 * a `DiningNotificationPayload` (persisted as `dining_notification.payload`); the
 * mailer renders from it. Framework-free so both the worker and the evaluator can
 * import it without pulling in React. Mirrors `stayFormat.ts`.
 */

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
