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

/** Fetch the full UOR places catalog, harvesting a guest session in-browser. */
export async function fetchUniversalPlaces(signal: AbortSignal): Promise<UniversalPlaces> {
  const result = await withUniversalSession(async (page, session) => {
    // GET, not POST: drop the JSON content-type but keep the auth header set.
    const headers = { ...session.headers };
    delete headers["content-type"];
    return page.evaluate(inPageGet, { url: PLACES_URL, headers });
  }, signal);

  if (result.body == null) {
    throw new UpstreamError(
      `Universal places GET ${PLACES_URL} -> ${result.status || "no response"}`,
      result.status || undefined,
    );
  }
  return UniversalPlacesSchema.parse(result.body);
}
