import { createFileRoute } from "@tanstack/react-router";

import {
  MAPTILER_FALLBACK_RASTER_STYLE_ID_DARK,
  MAPTILER_STYLE_ID,
} from "#/components/maps/maptiler-style.ts";
import { CACHE } from "#/lib/cache.ts";

/**
 * Edge proxy for MapTiler vector style documents. The map (`park-map.tsx`) points
 * `style:` at `/api/map-style/light` | `/dark` instead of `api.maptiler.com`, so
 * we can stamp a real `Cache-Control` (MapTiler sends none) and let Cloudflare
 * serve the JSON from a POP near the user — cutting a cross-origin round-trip off
 * the map's first paint. Only the style *descriptor* is proxied; the tiles,
 * sprites, and glyphs it references keep loading direct from MapTiler (their ToS
 * requires end-users to hit `api.maptiler.com` for tile bytes).
 */

// Server-side key. `process.env.VITE_MAPTILER_KEY` is populated in the deploy
// (same as `VITE_POSTHOG_KEY` in `server/posthog.ts`); fall back to the build-
// inlined value for local/dev.
const MAPTILER_KEY = process.env.VITE_MAPTILER_KEY ?? import.meta.env.VITE_MAPTILER_KEY;

/** Map the theme path segment to its MapTiler style ID (allowlist — anything
 *  else 404s rather than letting arbitrary IDs be proxied). */
function styleIdFor(theme: string): string | null {
  if (theme === "light") return MAPTILER_STYLE_ID;
  if (theme === "dark") return MAPTILER_FALLBACK_RASTER_STYLE_ID_DARK;
  return null;
}

export const Route = createFileRoute("/api/map-style/$theme")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const theme = new URL(request.url).pathname.replace(/^\/api\/map-style\//, "");
        const styleId = styleIdFor(theme);
        if (!styleId) return new Response("not found", { status: 404 });

        const upstream = `https://api.maptiler.com/maps/${styleId}/style.json?key=${MAPTILER_KEY}`;

        let res: Response;
        try {
          res = await fetch(upstream);
        } catch {
          // MapTiler unreachable — surface a short-lived error so the edge retries
          // soon rather than caching a broken style for the long TTL.
          return new Response("upstream unavailable", {
            status: 502,
            headers: { "cache-control": "no-store" },
          });
        }

        if (!res.ok) {
          // Pass the failure through without the long cache window.
          return new Response(await res.text(), {
            status: res.status,
            headers: { "cache-control": "no-store" },
          });
        }

        return new Response(await res.text(), {
          headers: {
            "content-type": "application/json; charset=utf-8",
            "cache-control": CACHE.MAP_STYLE,
          },
        });
      },
    },
  },
});
