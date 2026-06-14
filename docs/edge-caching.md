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
