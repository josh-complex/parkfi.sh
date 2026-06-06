import type { Page } from "puppeteer-core";

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
 * from its own requests, then call the two commerce endpoints ourselves —
 * crucially FROM INSIDE THE PAGE (page.evaluate), so they carry the live
 * browser session (cookies, TLS fingerprint, Akamai sensor). The API rejects
 * detached/datacenter clients, so a Node-side fetch does not work.
 *   A. `gettickets`            — catalog, crawled over days × park × residency
 *   B. `priceAndInventory/v2`  — per-date price/inventory, forward window
 */

const TICKETS_URL =
  process.env.UNIVERSAL_TICKETS_URL ?? `${config.universalStoreUrl}/web-store/en/us/park-tickets`;
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
 * Load the tickets page and capture the guest-session headers (+ gettickets seed
 * body) from the SPA's own requests. The page stays open for the in-page crawl.
 */
async function harvestSession(page: Page): Promise<GuestSession> {
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
    .goto(TICKETS_URL, { waitUntil: "networkidle2", timeout: NAV_TIMEOUT_MS })
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

// Runs INSIDE the page (page.evaluate), so every gettickets/priceAndInventory
// call carries the live browser session — cookies, TLS fingerprint, Akamai
// sensor. api.universalparks.com rejects detached/datacenter clients, so the
// calls must originate in-browser, not from Node. Crawls the catalog across all
// dims, then prices the variable SKUs (+ Express) over the forward window.
interface CaptureArgs {
  headers: Record<string, string>;
  seed: Record<string, unknown>;
  getticketsUrl: string;
  priceUrl: string;
  contractId: string;
  crawlDays: Array<string>;
  crawlParks: Array<string>;
  crawlPoo: Array<{ geo: string; cardLabel: string; fl: string }>;
  express: Array<string>;
  start: string;
  end: string;
  batch: number;
}

const inPageCapture = async (a: CaptureArgs) => {
  const post = async (url: string, body: unknown): Promise<Record<string, unknown> | null> => {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: a.headers,
        body: JSON.stringify(body),
      });
      if (!res.ok) return null;
      return (await res.json()) as Record<string, unknown>;
    } catch {
      return null;
    }
  };

  type Sku = {
    partNumber: string;
    name: string | null;
    listPrice: number | string | null;
    currency: string;
    variablePriced: boolean;
  };
  const skus: Record<string, Sku> = {};
  for (const days of a.crawlDays) {
    for (const park of a.crawlParks) {
      for (const poo of a.crawlPoo) {
        const json = await post(a.getticketsUrl, {
          ...a.seed,
          cards: `Tickets_MDVP_SC_Web~DAYS.${days}~PARK_NUM.${park}~POO.${poo.cardLabel}`,
          catalogId: a.seed.catalogId ?? "20004",
          geoLocation: poo.geo,
          ticketsPageNumberOfDays: days,
          ticketsPageFloridaResidentFlag: poo.fl,
          skipInventory: true,
          dates: [],
          firstTimeVisitor: "Y",
        });
        const cards =
          (json?.result as { page?: { cards?: Array<Record<string, unknown>> } } | undefined)?.page
            ?.cards ?? [];
        for (const card of cards) {
          for (const group of (card.groups as Array<Record<string, unknown>>) ?? []) {
            for (const item of (group.items as Array<Record<string, unknown>>) ?? []) {
              const pn = item.partNumber as string | undefined;
              if (!pn || skus[pn]) continue;
              const pi = (item.pricingAndInventory as Record<string, unknown>) ?? {};
              skus[pn] = {
                partNumber: pn,
                name: (item.name as string) ?? null,
                listPrice: (pi.listPrice as number | string) ?? null,
                currency: (pi.currency as string) ?? "USD",
                variablePriced: Boolean(pi.isVariablePriced),
              };
            }
          }
        }
      }
    }
  }

  const variable = Object.values(skus)
    .filter((s) => s.variablePriced)
    .map((s) => s.partNumber);
  const toPrice = Array.from(new Set([...variable, ...a.express]));
  const eventAvailability: Record<string, Record<string, unknown>> = {};
  for (let i = 0; i < toPrice.length; i += a.batch) {
    const events = toPrice
      .slice(i, i + a.batch)
      .map((partNumber) => ({ partNumber, startDate: a.start, endDate: a.end, quantity: 1 }));
    const json = await post(a.priceUrl, { contractId: a.contractId, currency: "USD", events });
    const ea = (json?.eventAvailability as Record<string, Record<string, unknown>>) ?? {};
    for (const pn of Object.keys(ea)) {
      eventAvailability[pn] = Object.assign(eventAvailability[pn] ?? {}, ea[pn]);
    }
  }
  return { skus: Object.values(skus), eventAvailability };
};

/** Capture the full Universal catalog + per-date pricing — entirely in-browser. */
export async function fetchUniversalCatalogAndPricing(
  signal: AbortSignal,
): Promise<UniversalCapture> {
  const today = new Date();
  const end = new Date(today);
  end.setDate(end.getDate() + PRICE_WINDOW_DAYS);

  const raw = await withBrowser(async (browser) => {
    const page = await browser.newPage();
    await page.setUserAgent(BROWSER_UA);
    await page.setViewport({ width: 1366, height: 900 });

    const session = await harvestSession(page);

    // The crawl + pricing run in-page against the live session.
    return page.evaluate(inPageCapture, {
      headers: session.headers,
      seed: session.seed,
      getticketsUrl: GETTICKETS_URL,
      priceUrl: PRICE_URL,
      contractId: CONTRACT_ID,
      crawlDays: CRAWL_DAYS,
      crawlParks: CRAWL_PARK_NUMS,
      crawlPoo: CRAWL_POO,
      express: EXPRESS_PARTNUMBERS,
      start: `${isoDate(today)} 00:00:01`,
      end: `${isoDate(end)} 23:59:59`,
      batch: PRICE_BATCH,
    });
  }, signal);

  return UniversalCaptureSchema.parse(raw);
}
