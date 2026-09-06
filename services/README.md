# Railway-side services

Standalone Node services that run _alongside_ the TanStack Start app. They share
all domain code with the app via the `#/*` subpath alias (`#/server/parks/*`,
`#/db/*`), so there's no duplicated logic and one schema/normalizer to maintain.

Builder: **Railpack** (`railpack.json` at the repo root). It auto-detects bun
from `bun.lock`, so bun is available at build and runtime for every service.

Deploy each as its own Railway service pointed at this same repo, with a distinct
**start command** (set the root in Railway → "Custom Start Command"):

| Service               | Start command                 | Railway type         | Notes                                                                                                                                                                                                                                                                                                                                                                    |
| --------------------- | ----------------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `worker`              | `bun run worker`              | long-running, 1 rep  | self-scheduling 60s poller; `/health` on `$PORT`                                                                                                                                                                                                                                                                                                                         |
| `cron-tickets`        | `bun run cron:tickets`        | Cron `0 8 * * *`     | single-shot; gated ticket/Express feeds                                                                                                                                                                                                                                                                                                                                  |
| `geo`                 | `bun run cron:geo`            | Cron `0 6 1 * *`     | monthly; geo enrichment of `parks`/`attractions`                                                                                                                                                                                                                                                                                                                         |
| `cron-weather`        | `bun run cron:weather`        | Cron `0 0,2,...`     | every ~2h; OpenWeather → `weather_obs` (forecast + actual)                                                                                                                                                                                                                                                                                                               |
| `cron-calendar`       | `bun run cron:calendar`       | Cron `0 6 * * 1`     | weekly; holidays/breaks → `calendar_day` + `park_calendar_map`                                                                                                                                                                                                                                                                                                           |
| `cron-eval`           | `bun run cron:eval`           | Cron `0 * * * *`     | hourly; backfill `forecast_eval` (forecasts vs actuals) + recompute `model_metrics`. Keyless                                                                                                                                                                                                                                                                             |
| `ml-train`            | `python main.py train`        | Cron `0 6 * * *`     | daily; **Python** (`services/ml-train`, own railpack.json) — fit quantile model → `model_run`/`model_artifact`, emit next-day curve → `queue_forecast`                                                                                                                                                                                                                   |
| `ml-infer`            | `python main.py infer`        | Cron `*/15 * * * *`  | frequent; **Python** (same service code) — near-term now+30/60/120 forecasts → `queue_forecast`                                                                                                                                                                                                                                                                          |
| `dining-facilities`   | `bun run dining:facilities`   | Cron `0 6 * * 1`     | weekly; refresh `restaurant_dim` catalog + `dining_location`, enrich `dining_schedule` (hours), and capture change-only menu generations (`dining_menu_item` + `dining_menu_snapshot` pointer/hash) with a `dining_menu_price_change` log                                                                                                                                |
| `dining-availability` | `bun run dining:availability` | Cron `*/10 * * * *`  | frequent; dine-vas reservation sweep (logged-in)                                                                                                                                                                                                                                                                                                                         |
| `stays-availability`  | `bun run stays:availability`  | Cron `*/10 * * * *`  | frequent; resort-availability sweep → `stay_obs` cache (keyless)                                                                                                                                                                                                                                                                                                         |
| `cron-park-news`      | `bun run cron:park-news`      | Cron `0 */2 * * *`   | RSS → Gemini original-analysis drafts → `blog_post` (human-approved in /admin/blog)                                                                                                                                                                                                                                                                                      |
| `cron-park-report`    | `bun run cron:park-report`    | Cron `0 10,22 * * *` | bidaily; SQL detectors over our own telemetry → `report_event` ledger → Gemini data-digest drafts → `blog_post` (same review gate). Detection is keyless; composing needs `GEMINI_API_KEY`. Plan: docs/plans/blog-data-reports.md                                                                                                                                        |
| `cron-public-records` | `bun run cron:public-records` | Cron `0 9 * * *`     | daily; government records → `public_record` ledger + entity links + revisions, served at `/filings`. Adapters: City of Orlando permits (Socrata, keyless; `SODA_APP_TOKEN` optional), USPTO trademarks (TDXF daily bulk) + patents (PFW search) — both need the free `USPTO_ODP_API_KEY` and skip themselves without it. Plan: docs/plans/public-records-intelligence.md |

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
image / Railway Browserless template). The Universal places (`geo`) and dining
crons connect puppeteer-core to it over its WS/CDP endpoint to mint a guest
session; `cron-tickets` no longer needs it (the ticket store's API is open).
Simplest wiring: reference the template's `BROWSER_WS_ENDPOINT` (a full
`wss://…?token=…` URL) into those crons — that's all they need.

The `geo` cron is keyless and needs only `DATABASE_URL`. It enriches the nullable
geo columns on `parks` (center, bounds, `map_zoom`) and `attractions` (lat/lng,
`category`) from ThemeParks.wiki `/entity/{uuid}/children` (the backbone, 100%
coverage at both resorts), with the WDW finder explorer (`DISNEY_FINDER_BASE`)
layered on for Disney pin categories + precise map center/zoom. Pure dimension
enrichment — no fact table, no `ref_source`. Monthly is plenty (geo rarely moves).

The forecasting feature crons (wait-time prediction; tables in `src/db/schema.ts`
§ "Wait-time forecasting") follow the same single-shot, per-step-isolated pattern
as `geo`. **`cron-weather`** writes `weather_obs` from OpenWeather One Call 3.0 —
one call per active park lat/lng yields the 48h `hourly[]` block (FORECAST rows)
plus `current` (one ACTUAL row at the current hour); running every ~2h densifies
the actuals for backtesting. It needs geo populated first (`cron:geo` fills
park lat/lng). **`cron-calendar`** writes `calendar_day` (US federal holidays from
the keyless Nager.Date API + a coarse, clearly-labeled school-break heuristic) and
seeds `park_calendar_map` (every active park → region `US`).

The **model pipeline** turns those features into forecasts. **`ml-train`** /
**`ml-infer`** are one **Python** service (`services/ml-train/`, see its README) —
the only non-TS service here. It never imports app code; Postgres is the sole
contract. `train` (daily 06:00 UTC) fits a global quantile LightGBM
(`attraction_id` categorical, p10/p50/p90 → band) over `queue_15min` + weather +
calendar + schedule, writes the booster bundle to `model_artifact` (bytea) and a
`model_run` ledger row, then emits tomorrow's hourly curve. `infer` (every 15
min) loads the active model and writes near-term now+30/60/120 forecasts — both
into `queue_forecast` (30-day retention). **`cron-eval`** (TS, hourly, keyless)
closes the loop: it joins past-due `queue_forecast` rows to the actual wait from
`queue_15min` into `forecast_eval`, then rolls `model_metrics` (MAE/RMSE/MAPE/R²

- verified coverage) per window — the numbers the `/predictions` tiles read. A
  2-hour grace lets the 15-min continuous aggregate materialize before evaluating.

| Var                    | Default                                   | Service         | Purpose                                                       |
| ---------------------- | ----------------------------------------- | --------------- | ------------------------------------------------------------- |
| `OPENWEATHER_API_KEY`  | _(unset ⇒ weather cron logs + skips)_     | `cron-weather`  | One Call 3.0 key (paid tier; required to write `weather_obs`) |
| `OPENWEATHER_BASE`     | `https://api.openweathermap.org/data/3.0` | `cron-weather`  | One Call API host                                             |
| `NAGER_BASE`           | `https://date.nager.at/api/v3`            | `cron-calendar` | federal-holiday API (keyless)                                 |
| `CALENDAR_YEARS_AHEAD` | `2`                                       | `cron-calendar` | forward years of calendar to seed                             |
| `CALENDAR_YEARS_BACK`  | `1`                                       | `cron-calendar` | back years to seed (history for backtesting)                  |
| `ML_TRAIN_DAYS`        | `60`                                      | `ml-train`      | history window for the training frame                         |
| `ML_VAL_DAYS`          | `7`                                       | `ml-train`      | most-recent days held out for time-based validation           |
| `ML_NUM_BOOST_ROUND`   | `400`                                     | `ml-train`      | LightGBM boosting rounds per quantile fit                     |

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

| Var                                     | Default                                                           | Purpose                                                                       |
| --------------------------------------- | ----------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `DISNEY_TICKET_BASE`                    | `https://disneyworld.disney.go.com`                               | WDW client-token + lexicon catalog/pricing host (D2)                          |
| `DISNEY_PRICE_WINDOW_DAYS`              | `180`                                                             | forward window of WDW per-date pricing (calendar reaches ~17mo)               |
| `BROWSER_WS_ENDPOINT`                   | _(unset)_                                                         | full `wss://…?token=…` (Railway template var); geo + dining crons only        |
| `BROWSERLESS_URL` + `BROWSERLESS_TOKEN` | _(unset)_                                                         | fallback: HTTP base (→ `ws://`) + token, e.g. `…railway.internal:3000`        |
| `BROWSERLESS_TIMEOUT_MS`                | `600000`                                                          | budget for one Browserless session (sized for the dining-availability sweep)  |
| `BROWSERLESS_WS_QUERY`                  | _(unset)_                                                         | extra WS query, e.g. `proxy=residential&proxySticky=true` (Akamai fallback)   |
| `UNIVERSAL_STORE_URL`                   | `https://www.universalorlando.com`                                | site whose tickets page is loaded once to mint the guest session (geo/dining) |
| `UNIVERSAL_API_BASE`                    | `https://api.universalparks.com`                                  | guest-session API host (places catalog, dining reservations)                  |
| `UNIVERSAL_TICKETS_URL`                 | web-store default                                                 | page whose bearer-carrying request we harvest session headers from            |
| `UNIVERSAL_OCC_BASE`                    | `https://comm-api.universaldestinationsandexperiences.com/occ/v2` | ticket store (SAP Commerce) API — catalog + per-date calendar, cookieless     |
| `UNIVERSAL_OCC_SITE`                    | `uor_b2c`                                                         | the store's base site id                                                      |
| `UNIVERSAL_PRICE_WINDOW_DAYS`           | `180`                                                             | forward window of per-date pricing (calendars run ~16 months out)             |
| `UNIVERSAL_PRICE_BATCH`                 | `20`                                                              | part numbers per calendar call                                                |
| `UNIVERSAL_OCC_TIMEOUT_MS`              | `30000`                                                           | budget per catalog page / calendar batch                                      |

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

| Var                            | Default  | Purpose                                                                     |
| ------------------------------ | -------- | --------------------------------------------------------------------------- |
| `DISNEY_EMAIL` / `DISNEY_PASS` | _(req.)_ | OneID login for a **dedicated throwaway account** (no payment on file)      |
| `SESSION_ENC_KEY`              | _(req.)_ | AES-256-GCM key (hex-64 or base64-32) for the `scraper_session` blob        |
| `DINING_PARTY_SIZES`           | `2,4`    | comma list of party sizes to sweep                                          |
| `DINING_DAY_HORIZON`           | `14`     | forward days to sweep per restaurant                                        |
| `DINING_DETAILS`               | `1`      | `dining-facilities` schedule+menu enrichment; `0` = catalog-only run        |
| `DINING_DETAIL_CONCURRENCY`    | `6`      | concurrent per-venue detail fetches (~2 calls/venue) in `dining-facilities` |

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
`_mk/_ep/_hs/_ak` park). **Universal** is plain HTTPS too since the store moved
to SAP Commerce (Aug 2026): the three store categories (tickets / Express /
extras) come from the OCC product search and per-date price + sell-out from
`fetchCalendarDatesWithPriceAndInventory`, keyed by the store's variant part
numbers (`src/server/parks/universal-occ.ts`). Day tickets are date-priced
there, so UOR admission now has a real calendar; the old WebSphere part numbers
are retired (`product_dim.active = false`) on the first run.

Neither resort's ticket API is Akamai-sensor-gated, so both run over a plain
HTTPS client with no proxy. If the Railway datacenter IP ever gets challenged,
the Universal calls are ordinary `fetch`es and can be replayed inside a
Browserless page against the store origin (not wired by default).

## One-time bootstrap (in order)

```bash
bun run db:migrate   # tables + transaction-safe Timescale DDL (hypertables,
                     # compression, retention, index) — drizzle/ migrations
bun run db:cagg      # queue_hourly + queue_15min continuous aggregates +
                     # refresh policies (can't run in a migration's
                     # transaction; see cagg.sql). queue_15min is the
                     # forecasting feature store; this also backfills it.
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
