import type { ParkHeroSlide } from "../../../db/schema.ts";
import { disneyEntityHeroSlides, stripInlineHtml } from "../codes.ts";
import { config } from "../config.ts";
import {
  DisneyDiningDetailSchema,
  DisneyParkDetailSchema,
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
