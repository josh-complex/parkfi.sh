import { createFileRoute } from "@tanstack/react-router";

import { generateBotAvatarSvg } from "#/lib/avatar.ts";
import { CACHE } from "#/lib/cache.ts";

/**
 * Serves a deterministic bot avatar SVG for a seed (the user id). The avatar is a
 * pure function of the seed, so we regenerate it on demand and let Cloudflare
 * cache it immutably (`CACHE.AVATAR`) rather than storing a ~27 KB data URI on
 * `user.image` — see `src/lib/avatar.ts` for why the inline form had to go.
 *
 * `Access-Control-Allow-Origin: *` mirrors the map-style proxy: on web the
 * `<img>` is same-origin, but the Capacitor WebView (`https://localhost` /
 * `capacitor://`) fetches it cross-origin. The SVG is public and non-credentialed
 * so `*` is correct and keeps it cleanly edge-cacheable (no `Vary`).
 */
const CORS_ORIGIN = "access-control-allow-origin";

// Cap the seed so a flood of unique seeds can't balloon the edge cache; real
// seeds are 32-char user ids / UUIDs.
const MAX_SEED_LEN = 128;

export const Route = createFileRoute("/api/avatar/$seed")({
  server: {
    handlers: {
      GET: ({ params }) => {
        const seed = decodeURIComponent(params.seed);
        if (!seed || seed.length > MAX_SEED_LEN) {
          return new Response("not found", { status: 404, headers: { [CORS_ORIGIN]: "*" } });
        }
        return new Response(generateBotAvatarSvg(seed), {
          headers: {
            "content-type": "image/svg+xml; charset=utf-8",
            "cache-control": CACHE.AVATAR,
            [CORS_ORIGIN]: "*",
          },
        });
      },
    },
  },
});
