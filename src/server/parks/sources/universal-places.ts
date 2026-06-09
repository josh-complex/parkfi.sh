import type { Page } from "puppeteer-core";

import { config } from "../config.ts";
import { UniversalPlacesSchema, type UniversalPlaces } from "../schemas.ts";
import { UpstreamError } from "./themeparks.ts";
import { withUniversalSession } from "./universal-session.ts";

/**
 * Universal Orlando "places" feed — the UOR geo *enrichment* layer (the analog
 * of the Disney finder explorer). One resort-wide GET returns every POI (park
 * rides/shows/dining + hotels + CityWalk) with rich card metadata (images,
 * descriptions, place_type, land, detail URL), each keyed by a `place_id` in the
 * SAME namespace as our ThemeParks.wiki Universal child `externalId` — that's the
 * join back to our attractions (see `parseUniversalId`). Bearer/guest-session
 * gated, so we harvest the session in Browserless and replay the GET in-page
 * (api.universalparks.com rejects detached clients). Only invoked by the monthly
 * geo cron, so no rate-limit bucket.
 */

const PLACES_URL =
  process.env.UNIVERSAL_PLACES_URL ?? `${config.universalApiBase}/resort-areas/uor/places`;

// Runs INSIDE the page so the GET carries the live guest session. Returns the
// status alongside the body so the caller can surface a useful error.
const inPageGet = async (a: { url: string; headers: Record<string, string> }) => {
  try {
    const res = await fetch(a.url, { headers: a.headers });
    return { status: res.status, body: res.ok ? ((await res.json()) as unknown) : null };
  } catch {
    return { status: 0, body: null };
  }
};

/**
 * Fetch the places catalog within an already-open guest session — for callers
 * that also replay other endpoints (e.g. the dining catalog probes
 * reservation-availability) on the same page, avoiding a second session.
 */
export async function fetchPlacesInPage(
  page: Page,
  headers: Record<string, string>,
): Promise<UniversalPlaces> {
  // GET, not POST: drop the JSON content-type but keep the auth header set.
  const getHeaders = { ...headers };
  delete getHeaders["content-type"];
  const result = await page.evaluate(inPageGet, { url: PLACES_URL, headers: getHeaders });
  if (result.body == null) {
    throw new UpstreamError(
      `Universal places GET ${PLACES_URL} -> ${result.status || "no response"}`,
      result.status || undefined,
    );
  }
  return UniversalPlacesSchema.parse(result.body);
}

/** Fetch the full UOR places catalog, harvesting a guest session in-browser. */
export async function fetchUniversalPlaces(signal: AbortSignal): Promise<UniversalPlaces> {
  return withUniversalSession((page, session) => fetchPlacesInPage(page, session.headers), signal);
}
