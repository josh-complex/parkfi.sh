import type { Browser, Page } from "puppeteer-core";

import { config } from "../config.ts";
import { UniversalPricingSchema, type UniversalPricing } from "../schemas.ts";
import { withBrowser } from "./browserless.ts";

/**
 * Universal Orlando Express Pass + admission ticket pricing (U1/U2).
 *
 * The data lives on `api.universalparks.com` but every priced call is gated by
 * a real-browser guest session (WCToken/bearer/apikey minted by the Angular
 * web-store, behind Akamai). Rather than replicate that fragile handshake by
 * hand, we drive the live web-store inside Browserless v2 Chromium and harvest
 * the SPA's own `priceAndInventory/v2` XHR responses — the per-date demand
 * calendar (`eventAvailability[partNumber][date]`). See gated-feeds-report §U1.
 *
 * Entry URLs + the "Select" trigger are env-overridable because the web-store
 * markup drifts; defaults target the public purchase flow.
 */

const EXPRESS_URL =
  process.env.UNIVERSAL_EXPRESS_URL ??
  `${config.universalStoreUrl}/web-store/en/us/universal-express-passes`;
const TICKETS_URL =
  process.env.UNIVERSAL_TICKETS_URL ??
  `${config.universalStoreUrl}/web-store/en/us/theme-park-tickets`;

// CSS selectors for the "Select"/"Continue" affordance whose click fires
// priceAndInventory/v2. CSS can't match by text, so triggerSelects() also runs
// an in-page text-match pass after these.
const SELECT_SELECTORS = (
  process.env.UNIVERSAL_SELECT_SELECTORS ??
  'button[data-testid*="select"],button[aria-label*="Select"],button[class*="select"]'
)
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const NAV_TIMEOUT_MS = 45_000;
const SETTLE_MS = 6_000;
// Browserless Chromium's default UA advertises HeadlessChrome (Akamai flags it).
// Present as a normal desktop Chrome unless overridden.
const BROWSER_UA =
  process.env.UNIVERSAL_BROWSER_UA ??
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

type EventAvailability = Record<string, Record<string, unknown>>;

/**
 * Best-effort: click anything that looks like a "Select" to trigger the
 * per-date priceAndInventory/v2 call. Runs the configured CSS selectors first
 * (real puppeteer clicks), then a text-match pass in-page. Tolerates missing or
 * changed markup.
 */
async function triggerSelects(page: Page): Promise<void> {
  for (const sel of SELECT_SELECTORS) {
    try {
      for (const handle of await page.$$(sel)) {
        await handle.click({ delay: 30 }).catch(() => {});
      }
    } catch {
      /* selector not present — ignore */
    }
  }
  // Text-based fallback: dispatch DOM clicks on buttons whose label matches.
  try {
    await page.evaluate(() => {
      const wanted = /\b(select|continue|view dates|view pricing|check pricing)\b/i;
      const nodes = document.querySelectorAll('button, a[role="button"], [role="button"]');
      for (const el of Array.from(nodes)) {
        const label = `${el.textContent ?? ""} ${el.getAttribute("aria-label") ?? ""}`;
        if (wanted.test(label)) (el as HTMLElement).click();
      }
    });
  } catch {
    /* page navigated away mid-eval — ignore */
  }
}

/** Capture Express + ticket pricing for Universal Orlando via Browserless. */
export async function fetchUniversalPricing(signal: AbortSignal): Promise<UniversalPricing> {
  const merged: EventAvailability = {};

  await withBrowser(async (browser: Browser) => {
    const page = await browser.newPage();
    await page.setUserAgent(BROWSER_UA);
    await page.setViewport({ width: 1366, height: 900 });

    // Sniff the SPA's own per-date calendar responses. Handlers run async, so
    // we track their promises and drain them before returning.
    const pending: Array<Promise<void>> = [];
    page.on("response", (res) => {
      if (!res.url().includes("priceAndInventory/v2")) return;
      pending.push(
        (async () => {
          try {
            const json = (await res.json()) as { eventAvailability?: EventAvailability };
            const ea = json?.eventAvailability;
            if (!ea) return;
            for (const part of Object.keys(ea)) {
              merged[part] = { ...merged[part], ...ea[part] };
            }
          } catch {
            /* non-JSON or already-consumed body — ignore */
          }
        })(),
      );
    });

    for (const url of [EXPRESS_URL, TICKETS_URL]) {
      try {
        await page.goto(url, { waitUntil: "networkidle2", timeout: NAV_TIMEOUT_MS });
      } catch {
        continue; // page failed to load — try the next entry URL
      }
      await triggerSelects(page);
      await page.waitForNetworkIdle({ idleTime: 1500, timeout: SETTLE_MS }).catch(() => {});
    }

    await Promise.allSettled(pending);
  }, signal);

  return UniversalPricingSchema.parse({ eventAvailability: merged });
}
