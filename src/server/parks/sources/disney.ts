import { config } from "../config.ts";
import {
  AvailabilityCalendarSchema,
  DisneyClientTokenSchema,
  DisneyPricingSchema,
  DisneyProductListingSchema,
  type AvailabilityCalendar,
  type DisneyClientToken,
  type DisneyPricing,
  type DisneyProductListing,
} from "../schemas.ts";
import { UpstreamError } from "./themeparks.ts";

/**
 * Disney park-pass / ticket-date availability. Public, no auth — but requires a
 * normal User-Agent. Returns one entry per date with an availability state and
 * the Disney numeric park IDs that the state applies to.
 *
 * segment ∈ 'tickets' | 'resort' | 'passholder'
 */
export async function fetchAvailabilityCalendar(
  startDate: string,
  endDate: string,
  segment: "tickets" | "resort" | "passholder",
  signal: AbortSignal,
): Promise<AvailabilityCalendar> {
  const url = `${config.disneyAvailabilityBase}/calendar?segment=${segment}&startDate=${startDate}&endDate=${endDate}`;
  const res = await fetch(url, {
    signal,
    headers: {
      "user-agent": config.userAgent,
      accept: "application/json",
    },
  });
  if (!res.ok) throw new UpstreamError(`GET ${url} -> ${res.status}`, res.status);
  return AvailabilityCalendarSchema.parse(await res.json());
}

/**
 * D2 step 1: mint an anonymous client token. No login, no cookies — the token
 * (TTL ~1000s) is the only gate on the pricing calendar; Akamai sensor cookies
 * are not required for this JSON API. See research/gated-feeds-report.md §D2.
 */
export async function fetchClientToken(signal: AbortSignal): Promise<DisneyClientToken> {
  const url = `${config.disneyTicketBase}/authentication/get-client-token`;
  const res = await fetch(url, {
    signal,
    headers: { "user-agent": config.userAgent, accept: "application/json" },
  });
  if (!res.ok) throw new UpstreamError(`GET ${url} -> ${res.status}`, res.status);
  return DisneyClientTokenSchema.parse(await res.json());
}

/**
 * D2/E1: the catalog / product-listing — enumerates every purchasable product
 * across the anonymous discount groups. The `affiliations` CSV is additive (not
 * a filter); the union below surfaces STD_GST + FL_RESIDENT + CANADA_RESIDENT
 * (the login-gated affiliations add nothing to an anonymous token). Each product
 * key is the E2 slug, and `isVariablePricing` says whether an E2 calendar exists.
 * Bearer-gated (401 without). See research/disney-ticket-deep-dive.md §1.
 */
const E1_AFFILIATIONS = [
  "STD_GST",
  "PASSHOLDER",
  "STORE_INSTANCE_AFFILIATIONS_DVC",
  "CHARTER",
  "STORE_INSTANCE_AFFILIATIONS_DISNEY_STREAMING",
  "CANADA_RESIDENT",
  "FL_RESIDENT",
].join(",");

export async function fetchProductListing(
  accessToken: string,
  signal: AbortSignal,
): Promise<DisneyProductListing> {
  const url =
    `${config.disneyTicketBase}/api/lexicon-view-assembler-service/wdw/tickets/product-listing` +
    `?storeId=wdw&affiliations=${encodeURIComponent(E1_AFFILIATIONS)}`;
  const res = await fetch(url, {
    signal,
    headers: {
      "user-agent": config.userAgent,
      accept: "application/json",
      authorization: `BEARER ${accessToken}`,
    },
  });
  if (!res.ok) throw new UpstreamError(`GET ${url} -> ${res.status}`, res.status);
  return DisneyProductListingSchema.parse(await res.json());
}

/**
 * D2/E2: the date-based pricing calendar for one product. `slug` is the E1
 * product key (e.g. `theme-parks`, `theme-parks-with-park-hopper`,
 * `canada-ticket-for-canada-resident`) — the add-on tier and residency are
 * baked INTO the slug. NB: the `addOn` query param is ignored by the service
 * (verified live 2026-06-07: `theme-parks?addOn=park-hopper` still returns the
 * base `_0_` SKUs), so the tier MUST come from the slug, never the param.
 * Returns ~17 months of per-date prices in up to 10 numDays buckets (1-day rows
 * are per-park). Bearer-gated (401 without).
 */
export async function fetchTicketPricing(
  accessToken: string,
  signal: AbortSignal,
  slug: string,
): Promise<DisneyPricing> {
  const url =
    `${config.disneyTicketBase}/api/lexicon-view-assembler-service/wdw/tickets/product-types/` +
    `${slug}?storeId=wdw&addOn=false&excludePricingCalendar=false`;
  const res = await fetch(url, {
    signal,
    headers: {
      "user-agent": config.userAgent,
      accept: "application/json",
      authorization: `BEARER ${accessToken}`,
    },
  });
  if (!res.ok) throw new UpstreamError(`GET ${url} -> ${res.status}`, res.status);
  return DisneyPricingSchema.parse(await res.json());
}
