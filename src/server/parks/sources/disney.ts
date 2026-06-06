import { config } from "../config.ts";
import {
  AvailabilityCalendarSchema,
  DisneyClientTokenSchema,
  DisneyPricingSchema,
  type AvailabilityCalendar,
  type DisneyClientToken,
  type DisneyPricing,
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
 * D2 step 2: the date-based ticket pricing calendar for `slug` (default
 * `theme-parks`, the standard demand-priced product). Returns ~16 months of
 * per-date, per-ageGroup prices in 10 numDays buckets, plus sold-out / blockout
 * flags. Requires `Authorization: BEARER <token>` (401 without it).
 */
export async function fetchTicketPricing(
  accessToken: string,
  signal: AbortSignal,
  slug = "theme-parks",
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
