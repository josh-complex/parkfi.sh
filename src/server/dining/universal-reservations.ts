import type { Page } from "puppeteer-core";

import { config } from "../parks/config.ts";
import {
  UniversalReservationAvailabilitySchema,
  type UniversalReservationAvailability,
} from "../parks/schemas.ts";

/**
 * Universal dining reservation availability —
 * `POST resort-areas/UOR/places/{place_id}/reservation-availability`. Unlike
 * Disney's dine-vas (which needs a logged-in OneID session), this is reachable
 * with the anonymous web guest-session headers (same set as the places feed),
 * so we replay it in-page against a harvested session (see `universal-session`).
 * One POST returns the whole [start,end] date range. Returns null on a non-200
 * (e.g. a place that isn't actually reservable), so the caller can skip it.
 */
export async function fetchUniversalReservationAvailability(
  page: Page,
  headers: Record<string, string>,
  placeId: string,
  startDate: string,
  endDate: string,
  partySize: number,
): Promise<UniversalReservationAvailability | null> {
  const url = `${config.universalApiBase}/resort-areas/UOR/places/${placeId}/reservation-availability`;
  const result = await page.evaluate(
    async (a: { url: string; headers: Record<string, string>; body: Record<string, unknown> }) => {
      try {
        const res = await fetch(a.url, {
          method: "POST",
          headers: a.headers,
          body: JSON.stringify(a.body),
        });
        return { status: res.status, body: res.ok ? ((await res.json()) as unknown) : null };
      } catch {
        return { status: 0, body: null };
      }
    },
    {
      url,
      headers,
      body: { place_id: placeId, start_date: startDate, end_date: endDate, party_size: partySize },
    },
  );

  if (result.body == null) return null;
  return UniversalReservationAvailabilitySchema.parse(result.body);
}
