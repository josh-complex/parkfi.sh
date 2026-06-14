/**
 * Cloudflare cache purge-by-URL.
 *
 * Live wait/availability pages lean on short `s-maxage` TTLs (see the Nitro
 * `routeRules` in vite.config.ts) and don't need purging. This helper is for
 * event-driven invalidation — a park is added/removed, a ticket price drops, a
 * blog post publishes — where you want the edge to reflect the change now
 * rather than after the TTL lapses.
 *
 * Purge-by-URL works on every Cloudflare plan (tag/prefix purge is Enterprise
 * only), so we enumerate exact absolute URLs. Reads credentials from
 * `process.env` so it works identically in the Nitro server and the standalone
 * bun cron services; it no-ops (with a warning) when unconfigured, so local and
 * preview environments don't fail for lack of a token.
 *
 * Required env: CLOUDFLARE_ZONE_ID, CLOUDFLARE_API_TOKEN (token needs the
 * "Zone › Cache Purge › Purge" permission, scoped to the parkfi.sh zone).
 */

import { SITE_URL } from "#/lib/seo.ts";

const PURGE_BATCH = 30; // Cloudflare caps purge_cache `files` at 30 URLs/request.

/** Turn root-relative paths into the absolute URLs Cloudflare keys its cache on. */
function toAbsolute(paths: Array<string>): Array<string> {
  return paths.map((p) => (p.startsWith("http") ? p : `${SITE_URL}${p}`));
}

/**
 * Purge the given paths (root-relative like `/park/magic-kingdom`, or absolute)
 * from Cloudflare's edge cache. Returns true on success, false if it no-ops or
 * fails — callers should treat purge as best-effort and never block on it.
 */
export async function purgeEdge(paths: Array<string>): Promise<boolean> {
  const zoneId = process.env.CLOUDFLARE_ZONE_ID;
  const apiToken = process.env.CLOUDFLARE_API_TOKEN;

  if (paths.length === 0) return true;
  if (!zoneId || !apiToken) {
    console.warn("[edge/purge] CLOUDFLARE_ZONE_ID / CLOUDFLARE_API_TOKEN unset — skipping purge");
    return false;
  }

  const files = toAbsolute(paths);
  let ok = true;

  for (let i = 0; i < files.length; i += PURGE_BATCH) {
    const batch = files.slice(i, i + PURGE_BATCH);
    try {
      const res = await fetch(`https://api.cloudflare.com/client/v4/zones/${zoneId}/purge_cache`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${apiToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ files: batch }),
      });
      if (!res.ok) {
        ok = false;
        console.error(`[edge/purge] HTTP ${res.status}: ${await res.text()}`);
      }
    } catch (err) {
      ok = false;
      console.error("[edge/purge] request failed", err);
    }
  }

  return ok;
}

/** Convenience: purge a park page plus the surfaces that link/aggregate it. */
export function purgeParks(slugs: Array<string>): Promise<boolean> {
  const paths = ["/", "/sitemap.xml", ...slugs.map((s) => `/park/${s}`)];
  return purgeEdge(paths);
}
