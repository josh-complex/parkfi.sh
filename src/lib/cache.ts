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
  /**
   * Live-board tRPC reads (`parks.board` / `parks.overview` / `parks.ticker`):
   * public, identical for every user, and refreshed by the ingestion worker on a
   * 60 s tick. A short 30 s edge TTL bounds worst-case staleness at ~90 s — the
   * same freshness class users already get from their own 60 s client poll —
   * while collapsing every concurrent poller down to one origin hit per park per
   * 30 s. The long stale window keeps the edge serving through origin blips.
   */
  TRPC_LIVE: "public, s-maxage=30, stale-while-revalidate=300",
} as const;

/**
 * tRPC query paths whose responses are safe to cache at a shared edge: pure
 * public reads with no per-user variation, mapped to the `cache-control` policy
 * each should emit. Used on both sides of the wire — the client routes these
 * through a cacheable GET link (`root-provider.tsx`) and the server stamps the
 * matching policy on them (`api.trpc.$.tsx`). Keep the two in lockstep.
 */
export const CACHEABLE_TRPC_PATHS: ReadonlyMap<string, string> = new Map([
  // Live-board reads — worker-tick-fresh, short edge TTL.
  ["parks.board", CACHE.TRPC_LIVE],
  ["parks.overview", CACHE.TRPC_LIVE],
  ["parks.ticker", CACHE.TRPC_LIVE],
  // Catalog / menu / hours / availability — slow-moving, longer edge TTL.
  ["dining.venue", CACHE.TRPC_DATA],
  ["dining.menu", CACHE.TRPC_DATA],
  ["dining.hours", CACHE.TRPC_DATA],
  ["dining.availability", CACHE.TRPC_DATA],
  ["dining.restaurants", CACHE.TRPC_DATA],
  ["dining.picks", CACHE.TRPC_DATA],
  ["dining.menuChanges", CACHE.TRPC_DATA],
  ["dining.recentlyUpdated", CACHE.TRPC_DATA],
  ["parks.dining", CACHE.TRPC_DATA],
  ["parks.shops", CACHE.TRPC_DATA],
  ["parks.poi", CACHE.TRPC_DATA],
  ["stays.catalog", CACHE.TRPC_DATA],
  ["stays.availability", CACHE.TRPC_DATA],
]);

/**
 * The `cache-control` to stamp for a batch of cacheable query paths. Cacheable
 * paths travel on the non-batched GET link, so a request normally carries one
 * path; if a batch ever mixes several, emit the shortest edge TTL among them so
 * the freshest-needed policy wins. Returns `undefined` if any path is unlisted
 * (fail closed — the response stays uncacheable).
 */
export function trpcCacheControl(paths: readonly string[]): string | undefined {
  if (paths.length === 0) return undefined;
  let best: string | undefined;
  let bestSMaxAge = Infinity;
  for (const path of paths) {
    const policy = CACHEABLE_TRPC_PATHS.get(path);
    if (policy === undefined) return undefined;
    const sMaxAge = Number(/s-maxage=(\d+)/.exec(policy)?.[1] ?? Infinity);
    if (sMaxAge < bestSMaxAge) {
      bestSMaxAge = sMaxAge;
      best = policy;
    }
  }
  return best;
}
