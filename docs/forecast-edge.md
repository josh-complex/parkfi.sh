# Forecast on the edge (R2)

The per-park crowd calendar is identical for every visitor and only changes when
`ml-infer` writes new predictions (~every 15 min). That makes it a perfect
edge artifact: precompute it, drop it in R2, and let Cloudflare serve a static
JSON from the edge — Postgres does zero work on the read path.

## Pipeline

```
ml-infer (every 15m) → queue_forecast (Postgres)
forecast-publish (every 15m, Railway cron)
  → loadParkCalendar(slug)   ← SAME code the tRPC API uses (no drift)
  → putJson("forecast/<slug>.json", …)  → R2 bucket
Cloudflare (public R2 custom domain)  → serves forecast/<slug>.json at the edge
```

- Publisher: [services/forecast-publish/main.ts](../services/forecast-publish/main.ts) (`bun run forecast:publish`)
- Shared logic: [src/server/forecast/parkCalendar.ts](../src/server/forecast/parkCalendar.ts) — `forecast.parkCalendar` (tRPC) and the publisher both call `loadParkCalendar`, so the edge JSON always matches the site.
- R2 writer: [src/server/edge/r2.ts](../src/server/edge/r2.ts) (no-ops until configured).

Each object: `{ parkSlug, generatedAt, range:{start,end}, days:[{date, crowdIndex, crowdIsEstimate, weather}] }`.

## Cloudflare / R2 setup (dashboard)

1. **R2 → Create bucket**, name e.g. `parkfi-forecast`.
2. **Bucket → Settings → Public access → Custom Domain**: add `cdn.parkfi.sh`
   (Cloudflare creates the DNS record automatically since the zone is here).
   This serves objects publicly and respects the `Cache-Control` we set on each
   object (`s-maxage=900, stale-while-revalidate=86400`).
3. **R2 → Manage R2 API Tokens → Create API Token**: Object Read & Write,
   scoped to the `parkfi-forecast` bucket. Copy the Access Key ID + Secret.
4. Find your **Account ID** (R2 overview, right sidebar).

## Railway

Add a cron service running the publisher (Railpack auto-detects bun):

```
Start command: bun run forecast:publish
Schedule:      */15 * * * *
```

Set these env vars on that service:

```
R2_ACCOUNT_ID=<account id>
R2_ACCESS_KEY_ID=<access key id>
R2_SECRET_ACCESS_KEY=<secret>
R2_BUCKET=parkfi-forecast
FORECAST_PUBLISH_DAYS=60        # optional, default 60
```

## Read path (optional follow-up — not yet wired)

The publish half is live and safe to deploy now (it no-ops without R2 creds, and
the site still reads forecasts via tRPC). To actually serve reads from the edge,
point the predictions/park view at the R2 JSON with a tRPC fallback so nothing
breaks before the bucket is populated:

```ts
// pseudo — in the predictions loader/query
const base = import.meta.env.VITE_FORECAST_CDN; // e.g. https://cdn.parkfi.sh
async function getCalendar(slug: string) {
  if (base) {
    try {
      const r = await fetch(`${base}/forecast/${slug}.json`, { cache: "no-store" });
      if (r.ok) return await r.json();
    } catch {
      /* fall through to tRPC */
    }
  }
  return trpcClient.forecast.parkCalendar.query({ parkSlug: slug, startDate, endDate });
}
```

Flip this on once the bucket is serving — it's a small, reversible change, so
it's left as a deliberate follow-up rather than risking the working read path.

```

```
