import { config } from "../config.ts";
import { UniversalWaitFeedSchema, type UniversalWaitFeed } from "../schemas.ts";
import { UpstreamError } from "./themeparks.ts";

/**
 * Universal's public asset CDN — the live wait board behind the operator's own
 * app (research/universal-app-data-mining.md §1). One cookieless GET per
 * resort, no headers, CORS `*`, republished about once a minute. Nothing here
 * is gated, so unlike the places/ticket feeds it needs no Browserless session,
 * and unlike the mobile-services host it needs no static credential pair.
 *
 * The resort code is the path's first segment: `uor` (Orlando), `ush`
 * (Hollywood) and `usj` (Japan) all publish; Beijing/Singapore 404. Only `uor`
 * has parks in our catalog today.
 *
 * Runs on the ingest path once per tick for the whole resort (see
 * `universal-cdn-waits.ts`, which owns the caching and the degradation), so it
 * must stay one small request and its failures must be non-fatal.
 */
export async function fetchUniversalWaitTimes(
  resort: string,
  signal: AbortSignal,
): Promise<UniversalWaitFeed> {
  const url = `${config.universalCdnBase}/${resort}/wait-time/wait-time-attraction-list.json`;
  const res = await fetch(url, {
    headers: { accept: "application/json", "user-agent": config.userAgent },
    signal,
  });
  if (!res.ok) throw new UpstreamError(`GET ${url} -> ${res.status}`, res.status);
  return UniversalWaitFeedSchema.parse(await res.json());
}
