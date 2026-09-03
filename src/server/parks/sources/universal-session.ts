import type { Page } from "puppeteer-core";

import { config } from "../config.ts";
import { withBrowser } from "./browserless.ts";
import { UpstreamError } from "./themeparks.ts";

/**
 * Shared Universal Orlando guest-session harvest. The feeds we still drive on
 * `api.universalparks.com` — the geo "places" enrichment and the dining
 * catalog/reservation sweeps — reject detached/datacenter clients: the calls
 * must run INSIDE a real Browserless page so they carry the live browser
 * session (cookies, TLS fingerprint, Akamai sensor). We load the tickets page
 * once so the store mints an anonymous session, capture the bearer header set
 * from its own requests, then the caller replays the data endpoints in-page
 * with those headers. See research/gated-feeds-report.md §U1.
 *
 * Since the store moved to `store.universalorlando.com` (Aug 2026) the tickets
 * page's FIRST authenticated call is the OIDC client-credentials exchange
 * (`/oidc/connect/token`, a `Basic` client secret — useless against a data
 * endpoint), followed by `resort-areas/…` GETs carrying the bearer the SPA
 * minted from it (scope `default`). That bearer is what the places catalog
 * wants (verified 2026-09-03), so the harvest waits for it. The ticket
 * catalog itself no longer goes through here at all (`universal-occ.ts`).
 */

export const STORE_URL =
  process.env.UNIVERSAL_TICKETS_URL ?? `${config.universalStoreUrl}/web-store/en/us/park-tickets`;
// Browserless Chromium's default UA advertises HeadlessChrome (Akamai flags it).
export const BROWSER_UA =
  process.env.UNIVERSAL_BROWSER_UA ??
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const NAV_TIMEOUT_MS = 45_000;

// Auth headers we forward from the SPA's request. We rebuild a clean set rather
// than replaying everything (drop host/content-length/etc. that fetch sets).
const FORWARD_HEADERS = [
  "authorization",
  "wctoken",
  "wctrustedtoken",
  "x-uniwebservice-apikey",
  "x-uniwebservice-appversion",
  "x-uniwebservice-device",
  "x-uniwebservice-platform",
  "x-ibm-client-id",
];

export interface GuestSession {
  headers: Record<string, string>;
}

/**
 * Load the tickets page and capture the guest-session headers from the first
 * bearer-carrying `api.universalparks.com` request. The page stays open for
 * the in-page work.
 */
export async function harvestSession(page: Page): Promise<GuestSession> {
  const seenApi: Array<string> = [];
  let captured: Record<string, string> | null = null;
  let resolve: () => void = () => {};
  const bearerSeen = new Promise<void>((r) => (resolve = r));

  page.on("request", (req) => {
    const url = req.url();
    if (!url.includes("api.universalparks.com")) return;
    seenApi.push(`${req.method()} ${url.split("?")[0]}`);
    if (captured) return;
    // The client-credentials exchange carries a `Basic` client secret, not a
    // session: replaying it against a data endpoint 401s. Wait for the bearer.
    if (url.includes("/oidc/connect/token")) return;
    const h = req.headers();
    const isBearer = typeof h.authorization === "string" && /^bearer\s/i.test(h.authorization);
    if (!isBearer && !h.wctoken) return;
    captured = h;
    resolve();
  });

  await page
    .goto(STORE_URL, { waitUntil: "networkidle2", timeout: NAV_TIMEOUT_MS })
    .catch(() => {});
  // The bearer usually lands before networkidle; give late XHRs the nav budget.
  await Promise.race([bearerSeen, new Promise<void>((r) => setTimeout(r, NAV_TIMEOUT_MS))]);

  if (!captured) {
    const seen = seenApi.length
      ? `saw ${seenApi.length} api request(s): ${[...new Set(seenApi)].slice(0, 6).join(", ")}`
      : "saw NO api.universalparks.com requests — page likely challenged/blocked (try BROWSERLESS_WS_QUERY=proxy=residential, or verify UNIVERSAL_TICKETS_URL)";
    throw new UpstreamError(`Universal: no authenticated guest-session request captured; ${seen}`);
  }

  const raw: Record<string, string> = captured;
  const headers: Record<string, string> = {
    "content-type": "application/json",
    accept: "application/json",
  };
  for (const key of FORWARD_HEADERS) {
    if (raw[key]) headers[key] = raw[key];
  }
  return { headers };
}

/**
 * Connect to Browserless, open a page with the Universal UA, harvest the guest
 * session, and run `fn` against the live page (where the data endpoints are
 * replayed). The `signal` bounds the whole connect+harvest+run.
 */
export async function withUniversalSession<T>(
  fn: (page: Page, session: GuestSession) => Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  return withBrowser(async (browser) => {
    const page = await browser.newPage();
    await page.setUserAgent(BROWSER_UA);
    await page.setViewport({ width: 1366, height: 900 });
    const session = await harvestSession(page);
    return fn(page, session);
  }, signal);
}
