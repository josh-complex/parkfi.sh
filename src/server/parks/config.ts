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
  /** Universal Orlando web-store front (Akamai-protected SPA we drive in Chromium). */
  universalStoreUrl: process.env.UNIVERSAL_STORE_URL ?? "https://www.universalorlando.com",
  /** Universal commerce API host (gettickets + priceAndInventory/v2 live here). */
  universalApiBase: process.env.UNIVERSAL_API_BASE ?? "https://api.universalparks.com",

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
  /** Budget for a single Browserless session, in ms. Matches Browserless's own default. */
  browserlessTimeoutMs: num("BROWSERLESS_TIMEOUT_MS", 300_000),

  /** How often the worker polls every active park, in ms. */
  pollIntervalMs: num("POLL_INTERVAL_MS", 60_000),
  /** Max parks fetched concurrently within one tick. */
  pollConcurrency: num("POLL_CONCURRENCY", 4),
  /** Per-request fetch timeout, in ms. */
  fetchTimeoutMs: num("FETCH_TIMEOUT_MS", 9_000),

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
} as const;
