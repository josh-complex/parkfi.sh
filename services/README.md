# Railway-side services

Standalone Node services that run _alongside_ the TanStack Start app. They share
all domain code with the app via the `#/*` subpath alias (`#/server/parks/*`,
`#/db/*`), so there's no duplicated logic and one schema/normalizer to maintain.

Builder: **Railpack** (`railpack.json` at the repo root). It auto-detects bun
from `bun.lock`, so bun is available at build and runtime for every service.

Deploy each as its own Railway service pointed at this same repo, with a distinct
**start command** (set the root in Railway → "Custom Start Command"):

| Service               | Start command                 | Railway type        | Notes                                                            |
| --------------------- | ----------------------------- | ------------------- | ---------------------------------------------------------------- |
| `worker`              | `bun run worker`              | long-running, 1 rep | self-scheduling 60s poller; `/health` on `$PORT`                 |
| `cron-tickets`        | `bun run cron:tickets`        | Cron `0 8 * * *`    | single-shot; gated ticket/Express feeds                          |
| `geo`                 | `bun run cron:geo`            | Cron `0 6 1 * *`    | monthly; geo enrichment of `parks`/`attractions`                 |
| `dining-facilities`   | `bun run dining:facilities`   | Cron `0 6 * * 1`    | weekly; refresh `restaurant_dim` catalog                         |
| `dining-availability` | `bun run dining:availability` | Cron `*/10 * * * *` | frequent; dine-vas reservation sweep (logged-in)                 |
| `stays-availability`  | `bun run stays:availability`  | Cron `*/10 * * * *` | frequent; resort-availability sweep → `stay_obs` cache (keyless) |

The web app (`bun run start`) is a third service with a public domain. DB/Redis
ride the Railway private network — only the app gets a public URL.

The `notifications` worker (`bun run notifications`, long-running) hosts TWO BullMQ
workers on one Redis connection: `push-notifications` (web push) and `stay-alerts`
(durable, retried resort-availability EMAIL via Resend). Stay alerts are evaluated
at the end of each `stays-availability` sweep, which writes a `notification` row
(status `queued`) and enqueues a `stay-alerts` job; the worker renders a React Email
template and sends it. Set `ALERTS_SEND_ENABLED=true` to actually send — it defaults
OFF so dev/test runs log instead of mailing.

The two `dining-*` services share one logged-in MyDisney (OneID) session
(encrypted in `scraper_session`); they require a logged-in browser, so they need
Browserless + `DISNEY_EMAIL`/`DISNEY_PASS` + `SESSION_ENC_KEY`. The availability
sweep only polls restaurants flagged `restaurant_dim.priority=true` (set those by
hand/SQL); `dining-facilities` seeds the full catalog but never sets `priority`.

**Browserless v2** runs as its own Railway service (the `ghcr.io/browserless/chromium`
image / Railway Browserless template). For the Universal feeds, `cron-tickets`
connects puppeteer-core to it over its WS/CDP endpoint. Simplest wiring: reference
the template's `BROWSER_WS_ENDPOINT` (a full `wss://…?token=…` URL) into the cron
— that's all it needs.

The `geo` cron is keyless and needs only `DATABASE_URL`. It enriches the nullable
geo columns on `parks` (center, bounds, `map_zoom`) and `attractions` (lat/lng,
`category`) from ThemeParks.wiki `/entity/{uuid}/children` (the backbone, 100%
coverage at both resorts), with the WDW finder explorer (`DISNEY_FINDER_BASE`)
layered on for Disney pin categories + precise map center/zoom. Pure dimension
enrichment — no fact table, no `ref_source`. Monthly is plenty (geo rarely moves).

The `stays-availability` sweep is keyless too (Disney's resort-availability API is
public + cookieless), needing only `DATABASE_URL`. It re-seeds a rolling warm set
(upcoming weekends × parties of 2 & 4) into `stay_query`, sweeps that frontier
least-recently-swept under `STAYS_SWEEP_BUDGET_MS`, and writes a fresh `stay_obs`
generation per tuple — the cache the `stays.availability` read path serves from
(`STAYS_CACHE_TTL_MS`). Knobs: `STAYS_WARM_HORIZON_DAYS` (56), `STAYS_DEMAND_AGE_OUT_DAYS`
(14). No Browserless, no login.

## Environment

All services need `DATABASE_URL` (Timescale-enabled Postgres). Optional knobs
(`src/server/parks/config.ts`): `POLL_INTERVAL_MS` (default 60000),
`POLL_CONCURRENCY` (4), `FETCH_TIMEOUT_MS` (9000), `THEMEPARKS_MAX_PER_MIN` (280),
`INGEST_USER_AGENT`, `TICKET_WINDOW_DAYS` (60).

`cron-tickets` gated feeds (Disney: `research/disney-ticket-deep-dive.md`;
Universal: `research/universal-ticket-deep-dive.md`):

| Var                                     | Default                             | Purpose                                                                      |
| --------------------------------------- | ----------------------------------- | ---------------------------------------------------------------------------- |
| `DISNEY_TICKET_BASE`                    | `https://disneyworld.disney.go.com` | WDW client-token + lexicon catalog/pricing host (D2)                         |
| `DISNEY_PRICE_WINDOW_DAYS`              | `180`                               | forward window of WDW per-date pricing (calendar reaches ~17mo)              |
| `BROWSER_WS_ENDPOINT`                   | _(unset)_                           | full `wss://…?token=…` (Railway template var); unset ⇒ Universal skipped     |
| `BROWSERLESS_URL` + `BROWSERLESS_TOKEN` | _(unset)_                           | fallback: HTTP base (→ `ws://`) + token, e.g. `…railway.internal:3000`       |
| `BROWSERLESS_TIMEOUT_MS`                | `600000`                            | budget for one Browserless session (sized for the dining-availability sweep) |
| `BROWSERLESS_WS_QUERY`                  | _(unset)_                           | extra WS query, e.g. `proxy=residential&proxySticky=true` (Akamai fallback)  |
| `UNIVERSAL_STORE_URL`                   | `https://www.universalorlando.com`  | web-store front loaded once to mint the guest session                        |
| `UNIVERSAL_API_BASE`                    | `https://api.universalparks.com`    | commerce API host (`gettickets` + `priceAndInventory/v2`)                    |
| `UNIVERSAL_TICKETS_URL`                 | web-store default                   | tickets page whose `gettickets` request we harvest session headers from      |
| `UNIVERSAL_CONTRACT_ID`                 | `4000000000000000003`               | priceAndInventory contract id (prices standard + FL SKUs)                    |
| `UNIVERSAL_PRICE_WINDOW_DAYS`           | `180`                               | forward window of per-date pricing (one call covers it; max ~365)            |
| `UNIVERSAL_PRICE_BATCH`                 | `20`                                | partNumbers per priceAndInventory call                                       |

Stay-alert email (`notifications` worker; see `docs/plans/stays-caching-and-alerts.md`).
Secrets are read directly from `process.env` (like `SESSION_ENC_KEY`), not `src/env.ts`:

| Var                     | Default             | Purpose                                                                   |
| ----------------------- | ------------------- | ------------------------------------------------------------------------- |
| `ALERTS_SEND_ENABLED`   | `false`             | actually send via Resend; OFF logs instead (safe default for dev/test)    |
| `RESEND_API_KEY`        | _(req. to send)_    | Resend API key                                                            |
| `ALERT_FROM_EMAIL`      | `alerts@parkfi.sh`  | verified Resend sender (verify the domain's SPF/DKIM/DMARC before launch) |
| `UNSUBSCRIBE_SECRET`    | _(req.)_            | HMAC key for signed one-click unsubscribe tokens                          |
| `ALERT_POSTAL_ADDRESS`  | _(empty)_           | physical address in the email footer (CAN-SPAM)                           |
| `APP_BASE_URL`          | `https://parkfi.sh` | origin for absolute unsubscribe + manage links                            |
| `STAYS_CACHE_TTL_MS`    | `900000`            | how long a swept `stay_obs` generation serves the read path               |
| `STAYS_SWEEP_BUDGET_MS` | `300000`            | wall-clock budget for one stays sweep; the tail leads the next run        |

`dining-*` services (logged-in MyDisney session; see `disney-ticket-deep-dive.md` §7-8):

| Var                            | Default  | Purpose                                                                |
| ------------------------------ | -------- | ---------------------------------------------------------------------- |
| `DISNEY_EMAIL` / `DISNEY_PASS` | _(req.)_ | OneID login for a **dedicated throwaway account** (no payment on file) |
| `SESSION_ENC_KEY`              | _(req.)_ | AES-256-GCM key (hex-64 or base64-32) for the `scraper_session` blob   |
| `DINING_PARTY_SIZES`           | `2,4`    | comma list of party sizes to sweep                                     |
| `DINING_DAY_HORIZON`           | `14`     | forward days to sweep per restaurant                                   |

Both dining services also need `BROWSER_WS_ENDPOINT` (+ `BROWSERLESS_WS_QUERY=stealth&proxy=residential`
— login from a datacenter IP is the main failure point) and a generous
`BROWSERLESS_TIMEOUT_MS` for the availability sweep (facilities × parties × days
in one session).

Both resorts land in the SKU-keyed model (`product_dim` + `sku_price_obs`), not
the park-keyed `product_price_obs`. **Note:** as of 2026-06-07, `insertSkuPrices`
is delta-only — a new row is written only when `price_cents`, `available`,
`available_units`, or `total_capacity` changes from the previous observation for
that `(sku, service_date)` pair. Rows before that date are full daily snapshots
(one per run regardless of change). When querying historical prices, use the most
recent observation on or before your target date, not an exact-date match.

**Disney** is plain HTTPS (no browser): mint
an anonymous client token, then sweep the lexicon pricing calendar across product
types × add-ons (theme-parks ±hopper/PHP/WPS, after-2pm, four-park-magic, canada,
FL) — each row is keyed by its `productInstanceId` (1-day rows carry the
`_mk/_ep/_hs/_ak` park). **Universal** is captured by loading the web-store once
in Browserless to harvest the guest-session headers, then calling `gettickets`
(catalog crawl) + `priceAndInventory/v2` (per-date pricing) **in-page** so they
carry the live browser session (the API rejects detached datacenter clients).

Disney's JSON APIs (D1/D2) are not Akamai-sensor-gated, so they run over a plain
HTTPS client with no proxy. If the Railway datacenter IP gets challenged on either
resort, route through Browserless `/unblock` + residential proxy (the WS-query
fallback above for Universal; not wired for Disney by default).

## One-time bootstrap (in order)

```bash
bun run db:migrate   # tables + transaction-safe Timescale DDL (hypertables,
                     # compression, retention, index) — drizzle/ migrations
bun run db:cagg      # queue_hourly continuous aggregate + refresh policy
                     # (can't run in a migration's transaction; see cagg.sql)
bun run db:seed      # reference data + WDW & Universal Orlando parks
```

Use `db:migrate`, NOT `db:push` — push diffs the schema and never runs the
custom migration that carries the Timescale DDL. `db:cagg` is the only piece
outside migrations (a continuous aggregate can't be created in a transaction
block). `parks.history` is the only app code that needs `queue_hourly`;
everything else runs on plain tables.

Attractions self-populate on first ingest (auto-discovered from `/live` and
mapped through `external_ids`), so only parks need seeding.

## Scale path (not built yet)

The worker schedules itself in-process and uses an in-memory rate-limit bucket —
correct for a single replica. To scale out: introduce Redis + BullMQ, move the
token bucket to a Redis Lua `INCR`/`PEXPIRE` bucket, split `scheduler`
(repeatable jobs, replica=1, leader-leased) from `worker` (queue consumers,
replica=N), and add a circuit breaker (opossum) around each upstream. The
`ingestPark()` core stays unchanged — only what _drives_ it changes.

Additional cron services to add later (same pattern as `cron-tickets`):
`cron-rollups` (refresh `queue_hourly`), `cron-retention` (verify policies),
`cron-health` (per-source freshness audit).
