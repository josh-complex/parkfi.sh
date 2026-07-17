# Edge caching (Cloudflare in front of Railway)

The Railway Nitro origin renders **anonymous** SSR HTML — auth is resolved
client-side (`authClient.useSession()`), so the server never embeds a user's
identity. That makes every public page safe to cache and share at the edge.

Public routes are also SSR-prefetched in their loaders (`_dash` →
`parks.list`, `/` → `parks.overview`, `/park/$slug` → `parks.board`), so the
cached HTML already contains the ride list, live waits, and stats that crawlers
index — not a loading shell.

## 1. Cloudflare Cache Rules (dashboard)

Caching is configured at Cloudflare, not the origin: Cloudflare doesn't cache
HTML by default, and Cache Rules let us set edge TTL + serve-stale per path on
any plan. Add these under **Caching → Cache Rules** (first match wins, so order
bypass rules first):

| Order | When (URI Path)                                                                                    | Action                                                                  |
| ----- | -------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| 1     | `starts_with /api/` OR `eq /login` OR `starts_with /account` OR `eq /alerts` OR `eq /stays/alerts` | **Bypass cache**                                                        |
| 2     | `eq /` OR `starts_with /park/`                                                                     | Eligible for cache · Edge TTL **60s** · Serve stale while revalidating  |
| 3     | `eq /dining` OR `eq /stays`                                                                        | Eligible for cache · Edge TTL **120s** · Serve stale while revalidating |
| 4     | `eq /predictions`                                                                                  | Eligible for cache · Edge TTL **300s** · Serve stale while revalidating |
| 5     | `eq /tickets` OR `eq /disclaimers` OR `eq /privacy`                                                | Eligible for cache · Edge TTL **1h+** · Serve stale while revalidating  |

For every "Eligible for cache" rule, set **Browser TTL → "Respect origin TTL"**
(Cloudflare won't accept `0`, and it isn't needed — the origin sends no long
`max-age` on HTML, so browsers don't hard-cache it). **Edge TTL** is the lever
that matters; keep **"Serve stale content while revalidating" ON**.

The live numbers still refresh on the client after hydration (tRPC refetch), so
a slightly stale HTML snapshot only affects first paint and crawler content,
never the interactive UX.

### Map style proxy (`/api/map-style/:theme`)

The map basemap style documents are proxied through the origin
(`routes/api/map-style/$theme.ts`) instead of being fetched straight from
`api.maptiler.com` — MapTiler sends `Last-Modified` but no `Cache-Control`, which
the Capacitor WebView mishandles and which put a cross-origin round-trip on the
map's first paint. The proxy stamps `CACHE.MAP_STYLE` so CF can serve it from a
POP near the user. Only the style descriptor is proxied; the tiles/sprites/glyphs
it references still load direct from MapTiler (their ToS requires it).

This path lives **under `/api/`, which rule #1 bypasses** — so it needs its own
Cache Rule ordered **above** the bypass (same as the tRPC cache rule):

| When (URI Path)               | Action                                                                                                                                     |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `starts_with /api/map-style/` | Eligible for cache · Edge TTL **"Use cache-control header if present, bypass if not"** · Browser TTL "Respect origin TTL" · Serve stale ON |

Use the origin's headers — don't pick "Ignore cache-control and use this TTL":
the route sends `no-store` on upstream errors (`502`/`404`) so a transient
MapTiler blip isn't cached for the full window, and that only works if CF
respects the header.

**Gotcha — CORS.** The response **must** send `Access-Control-Allow-Origin: *`
(the route does). On the web the map fetches this same-origin, but the native
Capacitor WebView runs from `https://localhost`, making it a cross-origin fetch;
without the header the style load is blocked and the map shows "failed to load"
on device only. MapTiler's own API sends `*`, so the pre-proxy direct URL didn't
hit this. After changing the route's headers, **purge the two URLs**
(`/api/map-style/light`, `/api/map-style/dark`) or the old cached copy without
CORS keeps serving to native for up to the edge TTL.

Also enable, both free:

- **Tiered Cache** (Caching → Tiered Cache) — a miss in one PoP pulls from an
  upper tier instead of the Railway origin.
- **Brotli**, **HTTP/3**, **Early Hints** (Speed / Network) — free latency wins.

Hashed build assets (`/_build/*`) are cached by Cloudflare's default rules; set
their Browser TTL to a year via a Cache Rule if you want client-side immutability.

## 2. Event-driven purge

Short TTLs cover live data, so purging is only for discrete changes — a park
added/removed, the sitemap changing, a blog post publishing. `purgeEdge()` /
`purgeParks()` in `src/server/edge/purge.ts` purge specific URLs (works on every
plan; tag/prefix purge is Enterprise only). It no-ops with a warning when the
token isn't set, so local/preview don't break.

```ts
import { purgeParks } from "#/server/edge/purge.ts";
// after activating/deactivating parks (e.g. in cron-geo or a seed/admin step):
await purgeParks(changedSlugs); // also purges / and /sitemap.xml
```

## 3. Required secret

Create a scoped API token (**My Profile → API Tokens → Create Token**) with:

- Permission: **Zone › Cache Purge › Purge**
- Zone Resources: **Include → Specific zone → parkfi.sh**

Set on the Railway services that call `purgeEdge` (and the web service):

```
CLOUDFLARE_ZONE_ID=<the parkfi.sh zone id>
CLOUDFLARE_API_TOKEN=<the token>
```
