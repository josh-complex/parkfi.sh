import type { Browser } from "puppeteer-core";

import { config } from "../config.ts";
import { UniversalCaptureSchema, type UniversalCapture } from "../schemas.ts";
import { withBrowser } from "./browserless.ts";
import { UpstreamError } from "./themeparks.ts";

/**
 * Universal Orlando ticket + Express catalog & pricing (U1/U2), per
 * research/universal-ticket-deep-dive.md.
 *
 * We do NOT drive the SPA UI. We load the web-store once in Browserless
 * Chromium so it mints an anonymous guest session, harvest the auth header set
 * from its own auto-fired `gettickets` request, then replay the two commerce
 * endpoints directly (both CORS-open + header-auth'd, so a plain server client
 * works once we hold the headers):
 *   A. `gettickets`            — catalog, crawled over days × park × residency
 *   B. `priceAndInventory/v2`  — per-date price/inventory, full-year window
 *
 * The browser is used only for the ~1s session harvest; the catalog crawl and
 * pricing run as ordinary fetches against the harvested headers.
 */

const TICKETS_URL =
  process.env.UNIVERSAL_TICKETS_URL ??
  `${config.universalStoreUrl}/web-store/en/us/theme-park-tickets`;
const GETTICKETS_URL = `${config.universalApiBase}/cp/personalization/gettickets`;
const PRICE_URL = `${config.universalApiBase}/shop/wcs/resources/store/10101/event/priceAndInventory/v2`;
// Prices both standard and FL SKUs (residency is in the partNumber, not the contract).
const CONTRACT_ID = process.env.UNIVERSAL_CONTRACT_ID ?? "4000000000000000003";

const NAV_TIMEOUT_MS = 45_000;
// Browserless Chromium's default UA advertises HeadlessChrome (Akamai flags it).
const BROWSER_UA =
  process.env.UNIVERSAL_BROWSER_UA ??
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

// Catalog crawl dimensions. Most (days,park) cells are empty; the union of all
// is the full catalog. Catalog is stable — fine to crawl daily alongside prices.
const CRAWL_DAYS = ["1", "2", "3", "4", "5", "6", "7", "365"];
const CRAWL_PARK_NUMS = ["1", "2", "3", "4"];
const CRAWL_POO = [
  { geo: "OUS", cardLabel: "Outer%20US", fl: "N" },
  { geo: "FL", cardLabel: "Florida", fl: "Y" },
];

// Express SKUs aren't in the tickets catalog; price them explicitly (§U1).
const EXPRESS_PARTNUMBERS = [
  "AO-UEP_UU_USF",
  "AO-UEP_01U_USF",
  "AO-UEP_UU_UIOA",
  "AO-UEP_01U_UIOA",
  "AO-UEP_01U_PV_UVB",
  "AO-UEP_01U_SV_UVB",
  "AO-UEP_1D_01U_EPIC",
];

// How far forward to pull per-date pricing (one call covers the whole window).
const PRICE_WINDOW_DAYS = Number(process.env.UNIVERSAL_PRICE_WINDOW_DAYS ?? 180);
const PRICE_BATCH = Number(process.env.UNIVERSAL_PRICE_BATCH ?? 20);

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

interface GuestSession {
  headers: Record<string, string>;
  /** Fields echoed back into gettickets bodies (guest/session ids, catalog). */
  seed: Record<string, unknown>;
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
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
 * Load the tickets page and capture the guest-session headers + seed body from
 * the SPA's own `gettickets` POST. The browser closes immediately after.
 */
async function harvestSession(browser: Browser): Promise<GuestSession> {
  const page = await browser.newPage();
  await page.setUserAgent(BROWSER_UA);
  await page.setViewport({ width: 1366, height: 900 });

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
    if (!h.authorization && !h.wctoken) return;
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
    .goto(TICKETS_URL, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT_MS })
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
      "[universal] no gettickets request seen — harvested headers from another api call; crawl may need a seed body (set UNIVERSAL_TICKETS_URL to the tickets page)",
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

async function postJson(
  url: string,
  headers: Record<string, string>,
  body: unknown,
  signal: AbortSignal,
): Promise<Record<string, unknown> | null> {
  try {
    const res = await fetch(url, { method: "POST", headers, body: JSON.stringify(body), signal });
    if (!res.ok) return null;
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return null; // flaky upstream / one crawl cell failing must not abort the run
  }
}

/** Crawl `gettickets` over all dimensions and union the SKUs. */
async function crawlCatalog(
  session: GuestSession,
  signal: AbortSignal,
): Promise<Map<string, UniversalCapture["skus"][number]>> {
  const skus = new Map<string, UniversalCapture["skus"][number]>();
  for (const days of CRAWL_DAYS) {
    for (const park of CRAWL_PARK_NUMS) {
      for (const poo of CRAWL_POO) {
        const body = {
          ...session.seed,
          cards: `Tickets_MDVP_SC_Web~DAYS.${days}~PARK_NUM.${park}~POO.${poo.cardLabel}`,
          catalogId: session.seed.catalogId ?? "20004",
          geoLocation: poo.geo,
          ticketsPageNumberOfDays: days,
          ticketsPageFloridaResidentFlag: poo.fl,
          skipInventory: true,
          dates: [],
          firstTimeVisitor: "Y",
        };
        const json = await postJson(GETTICKETS_URL, session.headers, body, signal);
        const cards = (json?.result as { page?: { cards?: Array<Record<string, unknown>> } })?.page
          ?.cards;
        for (const card of cards ?? []) {
          for (const group of (card.groups as Array<Record<string, unknown>>) ?? []) {
            for (const item of (group.items as Array<Record<string, unknown>>) ?? []) {
              const partNumber = item.partNumber as string | undefined;
              if (!partNumber || skus.has(partNumber)) continue;
              const pi = (item.pricingAndInventory as Record<string, unknown>) ?? {};
              skus.set(partNumber, {
                partNumber,
                name: (item.name as string) ?? null,
                listPrice: (pi.listPrice as number | string) ?? null,
                currency: (pi.currency as string) ?? "USD",
                variablePriced: Boolean(pi.isVariablePriced),
              });
            }
          }
        }
      }
    }
  }
  return skus;
}

/** Pull per-date pricing for the given partNumbers over the forward window. */
async function fetchPricing(
  session: GuestSession,
  partNumbers: Array<string>,
  signal: AbortSignal,
): Promise<UniversalCapture["eventAvailability"]> {
  const today = new Date();
  const end = new Date(today);
  end.setDate(end.getDate() + PRICE_WINDOW_DAYS);
  const start = `${isoDate(today)} 00:00:01`;
  const endStr = `${isoDate(end)} 23:59:59`;

  const merged: UniversalCapture["eventAvailability"] = {};
  for (let i = 0; i < partNumbers.length; i += PRICE_BATCH) {
    const events = partNumbers
      .slice(i, i + PRICE_BATCH)
      .map((partNumber) => ({ partNumber, startDate: start, endDate: endStr, quantity: 1 }));
    const json = await postJson(
      PRICE_URL,
      session.headers,
      { contractId: CONTRACT_ID, currency: "USD", events },
      signal,
    );
    const ea = (json?.eventAvailability as UniversalCapture["eventAvailability"]) ?? {};
    for (const part of Object.keys(ea)) merged[part] = { ...merged[part], ...ea[part] };
  }
  return merged;
}

/** Capture the full Universal catalog + per-date pricing. */
export async function fetchUniversalCatalogAndPricing(
  signal: AbortSignal,
): Promise<UniversalCapture> {
  const session = await withBrowser(harvestSession, signal);

  const skuMap = await crawlCatalog(session, signal);
  const variable = [...skuMap.values()].filter((s) => s.variablePriced).map((s) => s.partNumber);
  // Express SKUs live in a separate catalog; price them by their known numbers.
  const toPrice = [...new Set([...variable, ...EXPRESS_PARTNUMBERS])];
  const eventAvailability = await fetchPricing(session, toPrice, signal);

  return UniversalCaptureSchema.parse({ skus: [...skuMap.values()], eventAvailability });
}
