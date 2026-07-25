import { config } from "../config.ts";
import {
  UniversalPoiFeedSchema,
  UniversalVenuesSchema,
  type UniversalPoiFeed,
  type UniversalVenues,
} from "../schemas.ts";
import { UpstreamError } from "./themeparks.ts";

/**
 * Universal's mobile-app services host — the typed POI + venue catalog behind
 * Universal's own app (research/universal-content-parity.md §2.3). Two plain
 * GETs, no Browserless and no guest session: the gate is a STATIC client
 * credential pair (`X-UNIWebService-ApiKey` / `-Token`) that
 * universalorlando.com publishes in its own JS bundle. Without the headers
 * every path 401s.
 *
 * This is the feed that closes the UOR attribute gap the places feed leaves —
 * numeric `MinHeightInInches`, Express Pass, single rider, child swap, virtual
 * line, accessibility and typed amenity buckets (restrooms/lockers/ATMs/first
 * aid/…) with `ExternalIds.PlaceId` in the same namespace we already join on.
 *
 * Treat as breakable: the credentials can be rotated at any time. Callers must
 * degrade rather than fail — the monthly geo cron runs this inside `runStep`,
 * and the contentdata ride pages (`universal-content.ts`) independently cover
 * heights/ride type/Express if this ever goes dark.
 */

function headers(): Record<string, string> {
  return {
    "X-UNIWebService-ApiKey": config.universalServicesApiKey,
    "X-UNIWebService-Token": config.universalServicesToken,
    accept: "application/json",
  };
}

async function get(path: string, signal: AbortSignal): Promise<unknown> {
  const url = `${config.universalServicesBase}${path}`;
  const res = await fetch(url, { headers: headers(), signal });
  if (!res.ok) throw new UpstreamError(`GET ${url} -> ${res.status}`, res.status);
  return res.json();
}

/** Every POI bucket for the Orlando resort in one call (~740 KB). */
export async function fetchUniversalPois(signal: AbortSignal): Promise<UniversalPoiFeed> {
  return UniversalPoiFeedSchema.parse(
    await get("/PointsOfInterest?city=Orlando&pageSize=All", signal),
  );
}

/**
 * The 14 Orlando venues (4 parks, CityWalk, 8 hotels, the resort itself) with
 * their GPS boundary polygons, bounding circles, contained lands and a 38-day
 * hours calendar.
 */
export async function fetchUniversalVenues(signal: AbortSignal): Promise<UniversalVenues> {
  return UniversalVenuesSchema.parse(await get("/Venues?city=Orlando&pageSize=All", signal));
}
