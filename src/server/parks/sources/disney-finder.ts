import type { ParkHeroSlide } from "../../../db/schema.ts";
import { disneyEntityHeroSlides, stripInlineHtml } from "../codes.ts";
import { config } from "../config.ts";
import {
  DisneyAttractionListSchema,
  DisneyDiningDetailSchema,
  DisneyParkDetailSchema,
  type DisneyAttractionList,
  type DisneyParkDetail,
} from "../schemas.ts";
import { UpstreamError } from "./themeparks.ts";

/**
 * Disney WDW "finder" explorer — the geo *enrichment* layer (the ThemeParks.wiki
 * `/children` feed is the authoritative geo backbone; this only enriches WDW
 * attractions with pin categories). Cookieless GET over plain HTTPS, same trust
 * level as the availability calendar — reuse the shared User-Agent. Only invoked
 * by the monthly geo cron, so no rate-limit bucket.
 */
async function getJson(url: string, signal: AbortSignal): Promise<unknown> {
  const res = await fetch(url, {
    signal,
    headers: { "user-agent": config.userAgent, accept: "application/json" },
  });
  if (!res.ok) throw new UpstreamError(`GET ${url} -> ${res.status}`, res.status);
  return res.json();
}

/** Coerce a string|number lat/lng/zoom to a finite number, or null. */
export function toNum(v: number | string | null | undefined): number | null {
  if (v == null) return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Per-park detail: one marker per facility, each with a `pin` category and a
 * `card.id` whose numeric prefix joins back to the ThemeParks.wiki child. The
 * `finderSlug` is the Disney `urlFriendlyId` (equals our park slug for the four
 * WDW parks). `date` is an ISO `YYYY-MM-DD` the explorer keys on — irrelevant to
 * geo, but part of the path.
 */
export async function fetchParkDetail(
  finderSlug: string,
  date: string,
  signal: AbortSignal,
): Promise<DisneyParkDetail> {
  const url = `${config.disneyFinderBase}/details-entity-simple/wdw/${finderSlug}/${date}/`;
  return DisneyParkDetailSchema.parse(await getJson(url, signal));
}

/**
 * The WDW destination entity every `list-ancestor-entities` catalog hangs off
 * (the same id `services/dining-facilities` and the resort catalog generator
 * use). One call under it returns the whole resort, not one park.
 */
export const DISNEY_DESTINATION_ID =
  process.env.DISNEY_DESTINATION_ID ?? "80007798;entityType=destination";

/**
 * Every WDW attraction + entertainment entity in ONE destination-wide GET
 * (research/disney-content-parity.md §2) — Disney's typed facet slugs, map
 * markers, alt text and today's performance times. Supersedes what the six
 * per-park `details-entity-simple` marker sweeps could tell us about facets,
 * and is the only place the accessibility taxonomy is published as data rather
 * than prose. Same endpoint family, trust level and cookielessness as the
 * dining/shops catalogs.
 */
export async function fetchDestinationAttractions(
  date: string,
  signal: AbortSignal,
  destinationId: string = DISNEY_DESTINATION_ID,
): Promise<DisneyAttractionList> {
  const url = `${config.disneyFinderBase}/list-ancestor-entities/wdw/${encodeURIComponent(
    destinationId,
  )}/${date}/attractions`;
  return DisneyAttractionListSchema.parse(await getJson(url, signal));
}

export interface DisneyEntityDetail {
  /** Official marketing copy, HTML-stripped; null when absent. */
  description: string | null;
  /** Normalized `mediaEngine` slides (stills + video/cinemagraph loops). */
  heroMedia: Array<ParkHeroSlide> | null;
}

/**
 * Official copy + media collection for any finder entity (plan items 2.3 +
 * 1.9 ride-level) — the same `details-entity-simple` endpoint the park/dining
 * details come from, keyed by the entity's `urlFriendlyId`. Description
 * prefers the richer `aagData.description` marketing copy over the
 * `structuredData` one-liner. Used by the monthly geo cron's per-attraction
 * pass (~40–60 requests/park).
 */
export async function fetchEntityDetail(
  finderSlug: string,
  date: string,
  signal: AbortSignal,
): Promise<DisneyEntityDetail> {
  const url = `${config.disneyFinderBase}/details-entity-simple/wdw/${finderSlug}/${date}/`;
  const detail = DisneyDiningDetailSchema.parse(await getJson(url, signal));
  const raw = detail.aagData?.description?.trim() || detail.structuredData?.description?.trim();
  return {
    description: raw ? stripInlineHtml(raw) || null : null,
    heroMedia: disneyEntityHeroSlides(detail.mediaEngine?.data),
  };
}
