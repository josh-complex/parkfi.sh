/**
 * dine-vas `getAvailability` — the perishable reservation feed.
 *
 * The per-facility availability endpoint takes a DATE RANGE and returns every
 * bookable slot across it in ONE call, keyed by service date. Crucially it does
 * NOT need a live browser session or cookies — only the OneID bearer plus the
 * two `x-disney-internal-dine-vas-*` routing headers (verified live from a bare
 * HTTP client). So we mint the bearer once via the browser (see
 * disney-session.ts → refreshDineBearer) and fire these as plain `fetch`es; no
 * session to keep warm, and one request per (facility, partySize) covers the
 * whole horizon instead of one per day. See research/disney-ticket-deep-dive.md §7.
 */

const DINE_HOST = "https://disneyworld.disney.go.com";
// undici sends `User-Agent: node` by default; mirror a real browser so we don't
// trip a UA gate. The data path is bearer-gated, not cookie-gated.
const BROWSER_UA =
  process.env.DISNEY_BROWSER_UA ??
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

export interface DiningOffer {
  mealPeriod: string | null;
  offerTime: string | null; // "11:30:00"
  offerId: string | null;
}

export interface AvailabilityResult {
  // false => bearer rejected (HTTP 401/403 / login redirect) → caller re-mints it
  loggedIn: boolean;
  // service date (YYYY-MM-DD) → its offers. A date absent from the map was not
  // returned by the feed (no availability); the caller treats it as "checked,
  // none available".
  offersByDate: Map<string, Array<DiningOffer>>;
}

interface DineAvailabilityResponse {
  restaurants?: Record<
    string,
    Array<{
      mealPeriodType?: string;
      mealPeriodName?: string;
      // each entry is an accessibility tier; the bookable slots are nested under
      // `.offers`, NOT on the tier object itself.
      offersByAccessibility?: Array<{
        accessibilityLevel?: string;
        offers?: Array<{ offerId?: string; time?: string }>;
      }>;
    }>
  >;
}

/** Flatten a dine-vas getAvailability body into per-date offers. Exported for tests. */
export function parseAvailability(body: unknown): Map<string, Array<DiningOffer>> {
  const out = new Map<string, Array<DiningOffer>>();
  const restaurants = (body as DineAvailabilityResponse | null)?.restaurants;
  if (!restaurants) return out;
  for (const [date, periods] of Object.entries(restaurants)) {
    const offers: Array<DiningOffer> = [];
    for (const mp of periods ?? []) {
      const mealPeriod = mp.mealPeriodType ?? mp.mealPeriodName ?? null;
      for (const tier of mp.offersByAccessibility ?? []) {
        for (const off of tier.offers ?? []) {
          offers.push({ mealPeriod, offerTime: off.time ?? null, offerId: off.offerId ?? null });
        }
      }
    }
    out.set(date, offers);
  }
  return out;
}

/**
 * Fetch availability for one (facility, partySize) across the inclusive date
 * range [startDate, endDate] (YYYY-MM-DD) in a single request. `partySize` ≤ 10.
 * `signal` aborts a hung request so the cron's budget can cap the whole run.
 */
export async function fetchAvailability(
  bearer: string | null,
  facilityId: string,
  entityType: string,
  startDate: string,
  endDate: string,
  partySize: number,
  signal?: AbortSignal,
): Promise<AvailabilityResult> {
  const url =
    `${DINE_HOST}/dine-res/api/availability/${partySize}/${startDate},${endDate}` +
    `?facilityId=${facilityId};entityType=${entityType}&entityType=${entityType}`;
  const headers: Record<string, string> = {
    Accept: "application/json, text/plain, */*",
    "User-Agent": BROWSER_UA,
    "x-disney-internal-dine-vas-eks": "true",
    "x-disney-internal-dine-vas-365": "true",
  };
  if (bearer) headers.Authorization = `BEARER ${bearer}`;

  let res: Response;
  try {
    res = await fetch(url, { headers, signal });
  } catch (err) {
    if (signal?.aborted) throw err; // budget abort — let the caller stop the run
    return { loggedIn: true, offersByDate: new Map() }; // transient network error — keep the bearer
  }
  // 401/403 or a redirect to the login page => the bearer is dead.
  if (res.status === 401 || res.status === 403 || res.redirected) {
    return { loggedIn: false, offersByDate: new Map() };
  }
  const body = (await res.json().catch(() => null)) as unknown;
  return { loggedIn: true, offersByDate: parseAvailability(body) };
}
