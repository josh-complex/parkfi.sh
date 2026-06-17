import { definePlugin } from "nitro";

/**
 * Never let the SSR'd HTML shell be cached by a shared cache (Cloudflare's edge,
 * a proxy) without revalidating.
 *
 * The shell embeds the current build's hashed chunk names (e.g.
 * `/assets/park-map-BFZ9bEVD.js`). A redeploy changes those hashes and deletes
 * the old chunks. If the edge keeps serving a stale shell, its `import()` calls
 * 404 with "Failed to fetch dynamically imported module" — and because the
 * recovery reload re-fetches that *same* stale shell, the app can't self-heal
 * and falls into the error boundary. This bit installed PWAs especially hard
 * (Android launches the cached `start_url` shell directly).
 *
 * Origin sent no `cache-control` on the document, so Cloudflare cached it
 * (observed `cf-cache-status: HIT`, multi-hour `age`). `no-cache` keeps the
 * response storable (so bfcache and conditional revalidation still work) but
 * forbids serving it without checking the origin first — every load gets a shell
 * that references the live build's chunks.
 *
 * Scope: only `text/html` responses that don't already set `cache-control`.
 * Immutable `/assets/**`, OG images, and `sitemap.xml`/RSS all set their own
 * policy (or aren't HTML), so they're left alone.
 */
export default definePlugin((nitroApp) => {
  nitroApp.hooks.hook("response", (res) => {
    const contentType = res.headers.get("content-type") ?? "";
    if (!contentType.includes("text/html")) return;
    if (res.headers.has("cache-control")) return;
    res.headers.set("cache-control", "no-cache");
  });
});
