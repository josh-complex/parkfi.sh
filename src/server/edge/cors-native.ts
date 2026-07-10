import { definePlugin } from "nitro";
import type { H3Core, Middleware } from "nitro/h3";

/**
 * CORS for the Capacitor native shell.
 *
 * The WebView loads from `capacitor://localhost` (iOS) / `https://localhost`
 * (Android) but talks to the API at `https://parkfi.sh`, so `/api/auth` and
 * `/api/trpc` are cross-origin from those two origins only. Native auth uses a
 * bearer token (not cookies), so we deliberately **omit**
 * `Access-Control-Allow-Credentials` — a cleaner posture, and it lets us echo a
 * concrete origin instead of the wildcard the credentialed mode forbids.
 *
 * The web app is same-origin and never sends an `Origin` header we match here,
 * so this middleware is a no-op for it.
 *
 * `Vary: Origin` keeps a shared cache (Cloudflare) from serving a response with
 * one origin's CORS headers to a different origin — important because the
 * cacheable `/api/trpc` GETs are edge-cached.
 */
const NATIVE_ORIGINS = new Set(["capacitor://localhost", "https://localhost"]);
const CORS_PREFIXES = ["/api/auth", "/api/trpc"];

function applyCors(headers: Headers, origin: string): void {
  headers.set("access-control-allow-origin", origin); // echo, never "*"
  headers.set("access-control-allow-methods", "GET,POST,OPTIONS");
  headers.set(
    "access-control-allow-headers",
    "authorization, content-type, trpc-accept, x-trpc-source",
  );
  headers.set("access-control-expose-headers", "set-auth-token");
  headers.append("vary", "Origin");
}

// Cache the preflight for a day so every cross-origin mutation/ping from the
// native shell doesn't pay an extra OPTIONS round trip.
const PREFLIGHT_MAX_AGE = "86400";

const corsMiddleware: Middleware = (event, next) => {
  const origin = event.req.headers.get("origin");
  if (!origin || !NATIVE_ORIGINS.has(origin)) return next();
  if (!CORS_PREFIXES.some((p) => event.url.pathname.startsWith(p))) return next();

  // Preflight: short-circuit with a bare 204 carrying the CORS headers.
  // Returning a Response from a middleware ends the chain (see h3
  // `callMiddleware`), so the SSR/route handler never runs for the OPTIONS.
  if (event.req.method === "OPTIONS") {
    const res = new Response(null, { status: 204 });
    applyCors(res.headers, origin);
    res.headers.set("access-control-max-age", PREFLIGHT_MAX_AGE);
    return res;
  }

  // Actual request: stamp CORS headers on the prepared response, then proceed.
  applyCors(event.res.headers, origin);
  return next();
};

export default definePlugin((nitroApp) => {
  // The Nitro build instantiates the base `H3Core`, which has no public `use()`
  // — but its `~middleware` array (the same one `use()` would append to) is
  // included by `~getMiddleware`, so pushing here registers global middleware.
  const app = nitroApp.h3 as H3Core | undefined;
  if (!app) {
    // The nitro dependency is pinned to `nitro-nightly@latest`; a future nightly
    // could reshape `nitroApp.h3` or drop the `~middleware` seam we rely on here
    // (H3Core exposes no public `use()`). If that happens the native shell would
    // silently lose CORS and every cross-origin request would fail with an opaque
    // error. Fail loudly at server init instead so it surfaces on deploy.
    throw new Error(
      "[cors-native] nitroApp.h3 is unavailable — the Nitro/H3 middleware seam changed. " +
        "Native-shell CORS is not registered; re-check H3Core's middleware API.",
    );
  }
  app["~middleware"].push(corsMiddleware);
});
