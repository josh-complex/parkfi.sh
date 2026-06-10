/**
 * Shared shape + formatting for stay-alert notifications. The evaluator builds a
 * `StayNotificationPayload` (persisted as `notification.payload`); the mailer
 * renders from it. Kept framework-free so both the worker and the evaluator can
 * import it without pulling in React.
 */
import { RESORT_BY_ID } from "#/server/stays/resort-catalog.generated.ts";

/** What we persist on `notification.payload` — enough to render + audit. */
export interface StayNotificationPayload {
  mode: number; // 1 = becomes_available, 2 = price_below
  resortId: string; // '' = any resort
  resortName: string;
  checkInDate: string;
  checkOutDate: string;
  dateRange: string;
  pricePerNight: number | null;
  priceBelow: number | null;
  subject: string;
}

/** Display name for a resort alert; "any" alerts name the cheapest open resort. */
export function resortDisplayName(resortId: string, cheapestResortId?: string | null): string {
  if (resortId) return RESORT_BY_ID.get(resortId)?.name ?? "a Disney Resort";
  if (cheapestResortId) {
    return RESORT_BY_ID.get(cheapestResortId)?.name ?? "a Walt Disney World Resort";
  }
  return "Walt Disney World Resorts";
}

/** "Jul 4 – Jul 6, 2026" from two YYYY-MM-DD strings. */
export function formatDateRange(checkIn: string, checkOut: string): string {
  const fmt = (iso: string) =>
    new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    });
  return `${fmt(checkIn)} – ${fmt(checkOut)}, ${checkOut.slice(0, 4)}`;
}
