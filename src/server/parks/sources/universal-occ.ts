import { config } from "../config.ts";
import {
  UniversalOccCalendarSchema,
  UniversalOccSearchSchema,
  type UniversalOccCalendar,
  type UniversalOccProduct,
} from "../schemas.ts";
import { UpstreamError } from "./themeparks.ts";

/**
 * Universal Orlando's ticket store since August 2026: an SAP Commerce Cloud
 * ("OCC v2") storefront at `store.universalorlando.com`, whose API lives on a
 * separate host (`comm-api.universaldestinationsandexperiences.com`). The old
 * WebSphere store — `gettickets` + `priceAndInventory/v2` on
 * `api.universalparks.com`, driven through a Browserless guest session — no
 * longer fires from the tickets page, which is why the catalog crawl went dark
 * on 2026-07-29 (research/universal-ticket-deep-dive.md, status header).
 *
 * Both calls here are plain cookieless HTTPS, verified 2026-09-03 with our own
 * User-Agent and with none at all — no session, no bearer, no Queue-it (the
 * waiting room gates the store's HTML, not its API). Akamai fronts the host
 * (`ak_p` in server-timing) but challenges nothing on these paths; if that ever
 * changes from a datacenter IP, the calls are ordinary `fetch`es and can be
 * replayed inside a Browserless page against the store origin.
 *
 *   • `GET  /{site}/products/search?query=:relevance:allCategories:{category}`
 *     — the catalog, one page per category (52 tickets · 14 Express · 24
 *     extras on 2026-09-03; `pageSize=100` fits each in one call).
 *   • `POST /{site}/products/fetchCalendarDatesWithPriceAndInventory`
 *     — per-date price + availability for a list of orderable part numbers
 *     (the *variant* codes), any window up to the product's `calendarEndDate`.
 */

/** Store categories we crawl — the three stops of the store's progress bar. */
export const UNIVERSAL_OCC_CATEGORIES = {
  tickets: "uo_ice_default_pb_tickets",
  express: "uo_ice_default_pb_express",
  extras: "uo_ice_default_pb_extras",
} as const;
export type UniversalOccCategory = keyof typeof UNIVERSAL_OCC_CATEGORIES;

const SEARCH_FIELDS =
  "products(code,name,dateSelectionRequired,purchasable,price(FULL),stock(FULL),variantOptions(FULL),ageCategory)," +
  "pagination(DEFAULT)";
const PAGE_SIZE = 100;

function headers(json = false): Record<string, string> {
  return {
    accept: "application/json",
    "user-agent": config.userAgent,
    ...(json ? { "content-type": "application/json" } : {}),
  };
}

function siteUrl(path: string, query: Record<string, string>): string {
  const url = new URL(`${config.universalOccBase}/${config.universalOccSite}${path}`);
  for (const [k, v] of Object.entries({ lang: "en", curr: "USD", ...query })) {
    url.searchParams.set(k, v);
  }
  return url.toString();
}

async function getJson(url: string, signal: AbortSignal): Promise<unknown> {
  const res = await fetch(url, { headers: headers(), signal });
  if (!res.ok) throw new UpstreamError(`GET ${url} -> ${res.status}`, res.status);
  return res.json();
}

/** Every product in one store category (all pages). */
export async function fetchUniversalOccCategory(
  category: UniversalOccCategory,
  signal: AbortSignal,
): Promise<Array<UniversalOccProduct>> {
  const code = UNIVERSAL_OCC_CATEGORIES[category];
  const out: Array<UniversalOccProduct> = [];
  for (let page = 0, pages = 1; page < pages; page++) {
    const url = siteUrl("/products/search", {
      fields: SEARCH_FIELDS,
      query: `:relevance:allCategories:${code}`,
      pageSize: String(PAGE_SIZE),
      currentPage: String(page),
    });
    const parsed = UniversalOccSearchSchema.parse(await getJson(url, signal));
    out.push(...parsed.products);
    pages = Math.min(parsed.pagination?.totalPages ?? 1, 10);
  }
  return out;
}

export interface UniversalOccCalendarRequest {
  partNumber: string;
  /** ISO dates (YYYY-MM-DD), inclusive. */
  startDate: string;
  endDate: string;
  quantity?: number;
}

/**
 * Per-date price + availability for the given part numbers. One call prices
 * every requested part over the whole window; the store's own UI batches the
 * two age variants of a product per call, and 20 per call was fine live.
 */
export async function fetchUniversalOccCalendar(
  events: Array<UniversalOccCalendarRequest>,
  signal: AbortSignal,
): Promise<UniversalOccCalendar> {
  const url = siteUrl("/products/fetchCalendarDatesWithPriceAndInventory", {});
  const res = await fetch(url, {
    method: "POST",
    headers: headers(true),
    body: JSON.stringify({
      currency: "USD",
      events: events.map((e) => ({ quantity: 1, ...e })),
    }),
    signal,
  });
  if (!res.ok) throw new UpstreamError(`POST ${url} -> ${res.status}`, res.status);
  return UniversalOccCalendarSchema.parse(await res.json());
}
