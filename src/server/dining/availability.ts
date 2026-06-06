import type { Page } from "puppeteer-core";

/**
 * dine-vas `getAvailability` — the perishable reservation feed. Called in-page
 * on the logged-in session (§8 option A: cookies are inherited; we add the SPA
 * routing headers). One row per bookable slot in `offersByAccessibility[]`.
 * See research/disney-ticket-deep-dive.md §7.
 */

export interface DiningOffer {
  mealPeriod: string | null;
  offerTime: string | null; // "11:30:00"
  offerId: string | null;
}

export interface AvailabilityResult {
  // false => session looks dead (HTTP 401 / login redirect) → caller re-logs in
  loggedIn: boolean;
  offers: Array<DiningOffer>;
}

/** Fetch availability for one (facility, date, partySize). `date` = YYYY-MM-DD. */
export async function fetchAvailability(
  page: Page,
  facilityId: string,
  entityType: string,
  date: string,
  partySize: number,
): Promise<AvailabilityResult> {
  return page.evaluate(
    async (fid: string, et: string, d: string, party: number) => {
      const url = `/api/availability/${party}/${d},${d}?facilityId=${fid};entityType=${et}`;
      let res: Response;
      try {
        res = await fetch(url, {
          headers: {
            Accept: "application/json, text/plain, */*",
            "X-Function-Name": "getAvailability",
            "X-Correlation-Id": crypto.randomUUID(),
            "X-Conversation-Id": crypto.randomUUID(),
            "x-disney-internal-dine-vas-eks": "true",
            "x-disney-internal-dine-vas-365": "true",
          },
        });
      } catch {
        return { loggedIn: true, offers: [] }; // transient network error — keep session
      }
      if (res.status === 401 || res.redirected) return { loggedIn: false, offers: [] };

      const j = (await res.json().catch(() => null)) as {
        restaurants?: Record<
          string,
          Array<{
            mealPeriodType?: string;
            mealPeriodName?: string;
            offersByAccessibility?: Array<{ offerId?: string; time?: string }>;
          }>
        >;
      } | null;

      // `restaurants` present => logged-in (populated or genuinely empty).
      const periods = j?.restaurants?.[d] ?? [];
      const offers: Array<{
        mealPeriod: string | null;
        offerTime: string | null;
        offerId: string | null;
      }> = [];
      for (const mp of periods) {
        const mealPeriod = mp.mealPeriodType ?? mp.mealPeriodName ?? null;
        for (const off of mp.offersByAccessibility ?? []) {
          offers.push({ mealPeriod, offerTime: off.time ?? null, offerId: off.offerId ?? null });
        }
      }
      return { loggedIn: true, offers };
    },
    facilityId,
    entityType,
    date,
    partySize,
  );
}
