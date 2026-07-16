/**
 * Shared `cache-control` header values. Centralizes the stale-while-revalidate
 * policies the app emits so the edge (Cloudflare) caches each surface
 * consistently. HTML shells are deliberately absent here — they stay on
 * `no-cache` via the `no-cache-html` Nitro plugin (the stale-chunk safety net).
 */
export const CACHE = {
  /** OG card images — rarely change; long edge TTL + week-long stale window. */
  OG_IMAGE: "public, max-age=300, s-maxage=86400, stale-while-revalidate=604800",
  /** RSS/feed XML — short edge TTL, day-long stale window. */
  FEED: "public, s-maxage=900, stale-while-revalidate=86400",
  /**
   * MapTiler vector style document (proxied via `/api/map-style/:theme`). It's
   * one static JSON per theme, identical for every user, and changes only when
   * we republish the Cloud style. MapTiler serves it with `Last-Modified` but no
   * `Cache-Control`, which the Capacitor WebView mishandles (unbounded heuristic
   * freshness) — so we stamp our own: a short browser TTL so republishes land
   * within minutes, an hour of edge freshness, and a week-long stale window so
   * first paint never waits on a MapTiler round-trip.
   */
  MAP_STYLE: "public, max-age=300, s-maxage=3600, stale-while-revalidate=604800",
  /**
   * Read-only public tRPC query data (catalog / menu / hours / availability):
   * identical for every user, and already backed by a DB-side cache, so a short
   * edge TTL with a long stale window is plenty. Only emitted for an allowlist
   * of GET query paths (see `src/routes/api.trpc.$.tsx`).
   */
  TRPC_DATA: "public, s-maxage=300, stale-while-revalidate=86400",
} as const;

/**
 * tRPC query paths whose responses are safe to cache at a shared edge: pure
 * public catalog/availability reads with no per-user variation. Used on both
 * sides of the wire — the client routes these through a cacheable GET link
 * (`root-provider.tsx`) and the server stamps `CACHE.TRPC_DATA` on them
 * (`api.trpc.$.tsx`). Keep the two in lockstep.
 */
export const CACHEABLE_TRPC_PATHS: ReadonlySet<string> = new Set([
  "dining.venue",
  "dining.menu",
  "dining.hours",
  "dining.availability",
  "dining.restaurants",
  "dining.picks",
  "dining.menuChanges",
  "dining.recentlyUpdated",
  "parks.dining",
  "parks.shops",
  "parks.poi",
  "stays.catalog",
  "stays.availability",
]);
