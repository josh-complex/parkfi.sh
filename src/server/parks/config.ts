/**
 * Ingestion config. Reads env with sensible defaults so the worker runs with
 * zero config in dev. All knobs are overridable per Railway service.
 */

function num(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

export const config = {
  themeparksBase: process.env.THEMEPARKS_BASE ?? "https://api.themeparks.wiki/v1",
  queueTimesBase: process.env.QUEUE_TIMES_BASE ?? "https://queue-times.com",
  disneyAvailabilityBase:
    process.env.DISNEY_AVAILABILITY_BASE ??
    "https://disneyworld.disney.go.com/availability-calendar/api",
  /**
   * Disney WDW origin for the ticket-pricing handshake (D2): the anonymous
   * client-token endpoint + the lexicon pricing-calendar API both live here.
   * Cookieless, bearer-gated only — see research/gated-feeds-report.md.
   */
  disneyTicketBase: process.env.DISNEY_TICKET_BASE ?? "https://disneyworld.disney.go.com",
  /**
   * Disney WDW "finder" explorer host — the geo enrichment source (park map
   * center/zoom, pin categories, media). Cookieless GETs over plain HTTPS, same
   * trust level as the availability calendar. Only used by the monthly geo cron.
   */
  disneyFinderBase:
    process.env.DISNEY_FINDER_BASE ??
    "https://disneyworld.disney.go.com/finder/api/v1/explorer-service",
  /**
   * OneID (registerdisney) refresh-token exchange that mints the dine-vas
   * bearer over plain HTTP — no browser. The bearer (access_token) lives 24h;
   * the refresh token lives 180d and ROTATES on each use, so it's stored as
   * mutable state in `scraper_session` (see disney-session.refreshDineBearer).
   * `disneyOneIdApiKey` is a static public client key (grab from any
   * registerdisney request's `Authorization: APIKEY …` header / OneID.js).
   * `clientId` MUST match the token's `client_id` claim (…-PROD), not the
   * browser SDK's `getConfig` value. See research/disney-ticket-deep-dive.md.
   */
  disneyOneIdApiKey: process.env.DISNEY_ONEID_APIKEY ?? "",
  disneyOneIdClientId: process.env.DISNEY_ONEID_CLIENT_ID ?? "TPR-WDW-LBJS.WEB-PROD",
  disneyOneIdBase: process.env.DISNEY_ONEID_BASE ?? "https://registerdisney.go.com/jgc/v8",

  /**
   * Universal Orlando's website (Akamai-protected). The tickets page is loaded
   * once in Browserless to mint the anonymous guest session the places and
   * dining feeds need (`sources/universal-session.ts`).
   */
  universalStoreUrl: process.env.UNIVERSAL_STORE_URL ?? "https://www.universalorlando.com",
  /** Universal's guest-session API host (places catalog, dining reservations). */
  universalApiBase: process.env.UNIVERSAL_API_BASE ?? "https://api.universalparks.com",
  /**
   * The ticket store's SAP Commerce (OCC v2) API — catalog + per-date pricing
   * (`sources/universal-occ.ts`). Plain cookieless HTTPS: no session, no bearer,
   * no Queue-it. `universalOccSite` is the store's base site id (`uor_b2c`).
   */
  universalOccBase:
    process.env.UNIVERSAL_OCC_BASE ??
    "https://comm-api.universaldestinationsandexperiences.com/occ/v2",
  universalOccSite: process.env.UNIVERSAL_OCC_SITE ?? "uor_b2c",
  /**
   * Universal's Tridion content host. `/contentdata/<path>/index.html` returns
   * the raw page model as JSON for anything in the website sitemap, to a plain
   * cookieless GET — no Browserless, no session (see `universal-menu.ts` and
   * `sources/universal-content.ts`).
   */
  universalContentBase:
    process.env.UNIVERSAL_CONTENTDATA_BASE ?? "https://www.universalorlando.com/contentdata",
  /** Universal's public website origin (sitemap + resolved detail-page URLs). */
  universalWebBase: process.env.UNIVERSAL_WEB_BASE ?? "https://www.universalorlando.com",
  /**
   * Universal's mobile-app services host — the typed POI/Venues catalog
   * (`sources/universal-mobile.ts`). Gated by a STATIC client credential pair
   * that universalorlando.com publishes in its own JS bundle (`mobileServicesApi`
   * in `/web/main-*.js`), not a reversed secret: without the headers every path
   * 401s. Treat as breakable — if the pair is rotated, the geo cron's ride
   * enrichment degrades to the contentdata ride pages (which cover heights,
   * ride type and Express) and the typed POI layers simply go stale.
   */
  universalServicesBase:
    process.env.UNIVERSAL_SERVICES_BASE ?? "https://services.universalorlando.com/api",
  universalServicesApiKey: process.env.UNIVERSAL_SERVICES_API_KEY ?? "WebServicePortal",
  universalServicesToken:
    process.env.UNIVERSAL_SERVICES_TOKEN ?? "020B07FD-C5CC-412F-BBCC-F94B16BE7A3F",
  /**
   * Universal's public asset CDN — the live wait board behind the operator's
   * own app (`sources/universal-cdn.ts`). `/{resort}/wait-time/
   * wait-time-attraction-list.json` is a plain cookieless GET, no headers, CORS
   * `*`, republished about once a minute, and it types every ride's queues
   * (STANDBY / EXPRESS / SINGLE) where ThemeParks.wiki carries the Express and
   * single-rider lines for only a few rides. Keyed by the operator's place id,
   * which TP.wiki hands us as the live entity's `externalId`.
   */
  universalCdnBase: process.env.UNIVERSAL_CDN_BASE ?? "https://assets.universalparks.com",

  /**
   * Browserless v2 instance (separate Railway service). Universal's feeds are
   * gated by a real-browser guest session, so we harvest them by connecting
   * puppeteer-core to this instance over its WS/CDP endpoint.
   *
   * Primary: `BROWSER_WS_ENDPOINT` — the complete `wss://…?token=…` URL the
   * Railway Browserless template exposes, used verbatim. Fallback: an HTTP(S)
   * base (`BROWSERLESS_URL`) + `BROWSERLESS_TOKEN`, from which we derive the ws
   * URL (e.g. for private-network `http://…railway.internal:3000`). Empty =
   * Universal capture is skipped (Disney still runs over plain HTTPS).
   */
  browserlessWsEndpoint:
    process.env.BROWSER_WS_ENDPOINT ?? process.env.BROWSERLESS_WS_ENDPOINT ?? "",
  browserlessUrl: (process.env.BROWSERLESS_URL ?? "").replace(/\/+$/, ""),
  browserlessToken: process.env.BROWSERLESS_TOKEN ?? "",
  /**
   * Extra WS query string appended to the connect URL, e.g.
   * `proxy=residential&proxySticky=true` to use Browserless's residential proxy
   * if the datacenter IP gets Akamai-challenged (the report's fallback).
   */
  browserlessQuery: (process.env.BROWSERLESS_WS_QUERY ?? "").replace(/^[?&]/, ""),
  /**
   * Budget for a single Browserless session, in ms. The dining-availability
   * sweep is the heaviest consumer (priority venues × parties × days in one
   * session), so this is sized for it; override per-service as needed.
   */
  browserlessTimeoutMs: num("BROWSERLESS_TIMEOUT_MS", 600_000),

  /** How often the worker polls every active park, in ms. */
  pollIntervalMs: num("POLL_INTERVAL_MS", 60_000),
  /**
   * `attraction_status_obs` is a change-log (one row per transition), so a ride
   * that hasn't changed emits no rows. If a single transition is ever missed
   * (feed glitch, non-monotonic `lastUpdated`, brief outage) the ride is
   * stranded at a stale status until its *next* genuine change — which for a
   * steadily-open ride can be the next overnight close, hours away. To bound
   * that, ingest also re-asserts the current status when the last recorded
   * observation is older than this — a heartbeat that lets a stranded ride
   * self-heal within one interval. Set 0 to disable (pure change-log).
   */
  statusHeartbeatMs: num("STATUS_HEARTBEAT_MS", 20 * 60_000),
  /**
   * Minimum gap between two notifications for the same ride alert. Alert
   * latency itself is governed by `pollIntervalMs` (alerts are evaluated once
   * per tick); this only rate-limits repeat fires of a still-matching rule.
   */
  alertCooldownMs: num("ALERT_COOLDOWN_MS", 30 * 60_000),
  /** Max parks fetched concurrently within one tick. */
  pollConcurrency: num("POLL_CONCURRENCY", 4),
  /** Per-request fetch timeout, in ms. */
  fetchTimeoutMs: num("FETCH_TIMEOUT_MS", 9_000),

  /**
   * Dining catalog detail enrichment (schedules + menus): the weekly
   * `dining-facilities` cron fetches `details-entity-simple` (hours) and the
   * dinemenu API (menus) per active WDW venue. `DINING_DETAILS=0` skips this
   * phase (catalog-only run); concurrency bounds the ~2 calls/venue fan-out.
   */
  diningDetailsEnabled: (process.env.DINING_DETAILS ?? "1") !== "0",
  // Schedule fan-out concurrency (the finder host tolerates a small burst).
  // Kept low: these feeds sit behind Akamai bot-manager, which rate-clamps a
  // big concurrent burst from a datacenter IP. Paired with per-request retry.
  diningDetailConcurrency: num("DINING_DETAIL_CONCURRENCY", 3),
  // Menus hit an AWS API Gateway that rejects *concurrent* access outright and
  // enforces a rolling per-IP rate cap. So menus are fetched strictly serially
  // with a polite gap, and bounded per run — least-recently-checked first, so
  // whatever the cap can't reach this run leads the next (the change-only
  // generational model makes partial coverage correct).
  //
  // Sized to cover the full active WDW dining catalog (~350–400 venues) in a
  // single run at the 700ms gap (~5 min of serial fetching), so menu change
  // detection is only as stale as the cron cadence — not the per-run cap. The
  // complementary lever lives in the Railway schedule: run this cron daily (not
  // weekly) to catch menu adds/removes/price moves within a day, matching what a
  // dedicated menu-diff tracker surfaces. The gap stays at 700ms to respect the
  // rate cap — throughput comes from a longer run + more frequent runs, never a
  // faster burst.
  diningMenuMaxPerRun: num("DINING_MENU_MAX_PER_RUN", 500),
  diningMenuDelayMs: num("DINING_MENU_DELAY_MS", 700),

  /**
   * Stays cache freshness: how long a swept `stay_obs` generation serves the
   * `stays.availability` read path before the next request fetches live. ~15min
   * matches the sweep cadence so a returning user almost always hits the cache.
   */
  staysCacheTtlMs: num("STAYS_CACHE_TTL_MS", 15 * 60_000),
  /** Wall-clock budget for one stays sweep run; the tail leads the next run. */
  staysSweepBudgetMs: num("STAYS_SWEEP_BUDGET_MS", 300_000),
  /**
   * Forward horizon (days) the sweep seeds a rolling warm set over — upcoming
   * weekends × small parties, so cold browse for popular dates is instant.
   */
  staysWarmHorizonDays: num("STAYS_WARM_HORIZON_DAYS", 56),
  /**
   * Demand-only `stay_query` rows (no active alert) are dropped once they
   * haven't been requested in this many days, bounding the swept space.
   */
  staysDemandAgeOutDays: num("STAYS_DEMAND_AGE_OUT_DAYS", 14),

  /**
   * Stay-alert email delivery. `alertsSendEnabled` gates the actual Resend send
   * — defaults OFF so dev/test runs log instead of mailing (the secrets
   * RESEND_API_KEY / UNSUBSCRIBE_SECRET are read directly where used, like
   * SESSION_ENC_KEY). `appBaseUrl` builds absolute unsubscribe + manage links.
   */
  alertsSendEnabled: process.env.ALERTS_SEND_ENABLED === "true",
  alertFromEmail: process.env.ALERT_FROM_EMAIL ?? "alerts@parkfi.sh",
  alertPostalAddress: process.env.ALERT_POSTAL_ADDRESS ?? "",
  appBaseUrl: (process.env.APP_BASE_URL ?? process.env.SERVER_URL ?? "https://parkfi.sh").replace(
    /\/+$/,
    "",
  ),

  /**
   * Wait-time forecasting feature feeds (services/cron-weather, cron-calendar).
   * `openweatherApiKey` is required for the weather cron — unset ⇒ it logs and
   * skips (no row written), like the Browserless gate. One Call 3.0 covers both
   * the hourly forecast block and current-conditions actual in one call/park.
   * Nager.Date (federal holidays) is keyless. `calendarYearsAhead`/`Back` bound
   * how far the calendar cron seeds (back ⇒ history for backtesting).
   */
  openweatherApiKey: process.env.OPENWEATHER_API_KEY ?? "",
  openweatherBase: process.env.OPENWEATHER_BASE ?? "https://api.openweathermap.org/data/3.0",
  nagerBase: process.env.NAGER_BASE ?? "https://date.nager.at/api/v3",
  calendarYearsAhead: num("CALENDAR_YEARS_AHEAD", 2),
  calendarYearsBack: num("CALENDAR_YEARS_BACK", 1),

  /**
   * ThemeParks.wiki allows 300 req/min. Hold below that across the process to
   * leave headroom for /schedule and retries.
   */
  themeparksMaxPerMin: num("THEMEPARKS_MAX_PER_MIN", 280),

  /**
   * User-Agent sent to upstreams. Disney's availability-calendar rejects empty
   * UAs; be a polite, identifiable client.
   */
  userAgent:
    process.env.INGEST_USER_AGENT ?? "parkfi.sh/1.0 (+https://parkfi.sh; theme-park data platform)",

  /**
   * OpenStreetMap Overpass API — source of theme-park boundary polygons for the
   * monthly geo cron. Public, keyless; be a polite client (long timeout, run once
   * a month). Override to a self-hosted/alt mirror if rate-limited.
   */
  overpassBase: process.env.OVERPASS_BASE ?? "https://overpass-api.de/api/interpreter",
  /** Budget for the single monthly Overpass boundary query (it can be slow). */
  overpassTimeoutMs: num("OVERPASS_TIMEOUT_MS", 120_000),
} as const;
