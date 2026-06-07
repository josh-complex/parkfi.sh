import type { Page } from "puppeteer-core";

import { getDineAccessToken } from "./disney-session.ts";

/**
 * WDW restaurant catalog from `/dine-res/api/dine/facilities` (session-gated —
 * fetched in-page on the logged-in session). The response groups venues under
 * `restaurant` / `dinnerShow` / `diningEvent`, each a map of bare-id → facility.
 * The bare id is the `getAvailability` join key; `;entityType=…` is the category.
 *
 * The request needs the OneID bearer AND the dine-vas routing headers: cookies
 * alone → 401; bearer without the `X-Function-Name`/`dine-vas` headers → the
 * service can't build its DineContext and 500s (NPE in DineContextSubscriber);
 * bearer + routing headers → 200. All three verified live.
 * See research/disney-ticket-deep-dive.md §7, §9.
 */

export interface RestaurantRow {
  facilityId: string;
  entityType: "restaurant" | "dinner-show" | "dining-event";
  name: string;
  cuisine: string | null;
  experienceType: string | null;
  priceRange: string | null;
  parkResort: string | null;
  parkResortId: string | null;
  bookable: boolean;
  sellableOnline: boolean;
}

const CATEGORIES: Array<[string, RestaurantRow["entityType"]]> = [
  ["restaurant", "restaurant"],
  ["dinnerShow", "dinner-show"],
  ["diningEvent", "dining-event"],
];

// Facet urlFriendlyIds that mark a venue as reservation-checkable.
const BOOKABLE_FACETS = new Set(["reservations-accepted", "checkavailmodulewdw"]);

export async function fetchFacilities(page: Page): Promise<Array<RestaurantRow>> {
  const bearer = await getDineAccessToken(page);
  const raw = await page.evaluate(async (token: string | null) => {
    const headers: Record<string, string> = {
      Accept: "application/json, text/plain, */*",
      "X-Function-Name": "getFacilities",
      "x-disney-internal-dine-vas-eks": "true",
      "x-disney-internal-dine-vas-365": "true",
    };
    if (token) headers.Authorization = `BEARER ${token}`;
    const r = await fetch("/dine-res/api/dine/facilities", { headers });
    if (!r.ok) return { status: r.status, body: null as unknown };
    return { status: 200, body: (await r.json()) as unknown };
  }, bearer);
  if (raw.status !== 200 || !raw.body) {
    throw new Error(`dine/facilities -> ${raw.status} (session invalid?)`);
  }

  const doc = raw.body as Record<string, Record<string, Record<string, unknown>>>;
  const rows: Array<RestaurantRow> = [];
  for (const [catKey, entityType] of CATEGORIES) {
    const group = doc[catKey];
    if (!group) continue;
    for (const [facilityId, v] of Object.entries(group)) {
      const facets = (v.facets as Array<{ urlFriendlyId?: string }>) ?? [];
      rows.push({
        facilityId,
        entityType,
        name: (v.name as string) ?? facilityId,
        cuisine: (v.primaryCuisineType as string) ?? null,
        experienceType: (v.experienceType as string) ?? null,
        priceRange: (v.priceRange as string) ?? null,
        parkResort: (v.ancestorLocationParkResort as string) ?? null,
        parkResortId: (v.ancestorLocationParkResortId as string) ?? null,
        bookable: facets.some((f) => f.urlFriendlyId && BOOKABLE_FACETS.has(f.urlFriendlyId)),
        sellableOnline: Boolean(v.sellableOnline),
      });
    }
  }
  return rows;
}
