import type { Page } from "puppeteer-core";

import { config } from "../config.ts";
import { withBrowser } from "./browserless.ts";
import { UpstreamError } from "./themeparks.ts";

/**
 * Shared Universal Orlando guest-session harvest. Both Universal feeds we drive
 * (the ticket catalog/pricing capture and the geo "places" enrichment) live on
 * `api.universalparks.com`, which rejects detached/datacenter clients: the calls
 * must run INSIDE a real Browserless page so they carry the live browser session
 * (cookies, TLS fingerprint, Akamai sensor). We load the web-store once so it
 * mints an anonymous guest session, harvest the auth header set from its own
 * requests, then the caller replays the data endpoints in-page with those
 * headers. See research/universal-ticket-deep-dive.md §0.
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
  /** Fields echoed back into gettickets bodies (guest/session ids, catalog). */
  seed: Record<string, unknown>;
}

function safeParse(s: string | undefined): Record<string, unknown> {
  if (!s) return {};
  try {
    return JSON.parse(s) as Record<string, unknown>;
  } catch {
    return {};
  }
}

/**
 * Load the tickets page and capture the guest-session headers (+ gettickets seed
 * body) from the SPA's own requests. The page stays open for the in-page work.
 */
export async function harvestSession(page: Page): Promise<GuestSession> {
  // The auth header set rides on every api.universalparks.com call. Capture the
  // first authenticated one — preferring `gettickets` (it also carries the seed
  // body) but accepting any authed request so a changed path doesn't break us.
  const seenApi: Array<string> = [];
  let captured: { headers: Record<string, string>; body?: string } | null = null;
  let gotGetTickets = false;
  let resolve: () => void = () => {};
  const getticketsSeen = new Promise<void>((r) => (resolve = r));

  page.on("request", (req) => {
    const url = req.url();
    if (!url.includes("api.universalparks.com")) return;
    seenApi.push(`${req.method()} ${url.split("?")[0]}`);
    const h = req.headers();
    // The OIDC client-credentials exchange (`/oidc/connect/token`) carries a
    // `Basic` client secret, not a session: replaying it against a data
    // endpoint 401s. Since the store moved to store.universalorlando.com (Aug
    // 2026) it is the FIRST authenticated call on the page, so wait for the
    // bearer the SPA mints from it (`resort-areas/…` GETs) — that token has
    // the `default` scope the places catalog wants (verified 2026-09-03).
    if (url.includes("/oidc/connect/token")) return;
    const isBearer = typeof h.authorization === "string" && /^bearer\s/i.test(h.authorization);
    if (!isBearer && !h.wctoken) return;
    const isGetTickets = url.includes("/personalization/gettickets");
    if (isGetTickets) {
      captured = { headers: h, body: req.postData() };
      gotGetTickets = true;
      resolve();
    } else if (!captured) {
      captured = { headers: h, body: req.postData() }; // fallback (no seed body)
    }
  });

  await page
    .goto(STORE_URL, { waitUntil: "networkidle2", timeout: NAV_TIMEOUT_MS })
    .catch(() => {});
  // Wait for gettickets specifically, but don't exceed the nav budget.
  await Promise.race([getticketsSeen, new Promise<void>((r) => setTimeout(r, NAV_TIMEOUT_MS))]);

  if (!captured) {
    const seen = seenApi.length
      ? `saw ${seenApi.length} api request(s): ${[...new Set(seenApi)].slice(0, 6).join(", ")}`
      : "saw NO api.universalparks.com requests — page likely challenged/blocked (try BROWSERLESS_WS_QUERY=proxy=residential, or verify UNIVERSAL_TICKETS_URL)";
    throw new UpstreamError(`Universal: no authenticated guest-session request captured; ${seen}`);
  }
  if (!gotGetTickets) {
    console.warn(
      "[universal] no gettickets request seen — harvested headers from another api call; a catalog crawl may need a seed body (set UNIVERSAL_TICKETS_URL to the tickets page)",
    );
  }

  const raw = (captured as { headers: Record<string, string> }).headers;
  const headers: Record<string, string> = {
    "content-type": "application/json",
    accept: "application/json",
  };
  for (const key of FORWARD_HEADERS) {
    if (raw[key]) headers[key] = raw[key];
  }
  return { headers, seed: safeParse((captured as { body?: string }).body) };
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
