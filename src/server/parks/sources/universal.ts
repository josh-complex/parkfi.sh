import { config } from "../config.ts";
import { UniversalPricingSchema, type UniversalPricing } from "../schemas.ts";
import { runBrowserFunction } from "./browserless.ts";

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
 * Entry URLs + the "Select" trigger selectors are env-overridable because the
 * web-store markup drifts; defaults target the public purchase flow.
 */

const EXPRESS_URL =
  process.env.UNIVERSAL_EXPRESS_URL ??
  `${config.universalStoreUrl}/web-store/en/us/universal-express-passes`;
const TICKETS_URL =
  process.env.UNIVERSAL_TICKETS_URL ??
  `${config.universalStoreUrl}/web-store/en/us/theme-park-tickets`;

// The "Select"/"Continue" affordance whose click fires priceAndInventory/v2.
const SELECT_SELECTORS = (
  process.env.UNIVERSAL_SELECT_SELECTORS ??
  'button[data-testid*="select"],button[aria-label*="Select"],button:has-text("Select")'
)
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

/**
 * Browser-side capture. Runs inside Chromium: registers a response sniffer for
 * `priceAndInventory/v2`, loads each entry URL, best-effort clicks the Select
 * affordances to trigger the per-date calls, then merges every captured
 * `eventAvailability` into one map. Returns plain JSON to the cron.
 */
const CAPTURE_FN = `
export default async function ({ page, context }) {
  const { urls, selectors, settleMs } = context;
  const merged = {};
  let captured = 0;

  page.on('response', async (res) => {
    const url = res.url();
    if (!url.includes('priceAndInventory/v2')) return;
    try {
      const json = await res.json();
      const ea = json && json.eventAvailability;
      if (!ea) return;
      captured++;
      for (const part of Object.keys(ea)) {
        merged[part] = Object.assign(merged[part] || {}, ea[part]);
      }
    } catch (_) { /* non-JSON / consumed body — ignore */ }
  });

  for (const url of urls) {
    try {
      await page.goto(url, { waitUntil: 'networkidle2', timeout: 45000 });
    } catch (_) { continue; }
    // Best-effort: click anything that looks like a "Select" to trigger the
    // per-date priceAndInventory/v2 call. Tolerate missing/changed markup.
    for (const sel of selectors) {
      try {
        const handles = await page.$$(sel);
        for (const h of handles) {
          try { await h.click({ delay: 30 }); } catch (_) {}
        }
      } catch (_) {}
    }
    try { await new Promise((r) => setTimeout(r, settleMs)); } catch (_) {}
  }

  return { data: { eventAvailability: merged, captured }, type: 'application/json' };
}
`;

/** Capture Express + ticket pricing for Universal Orlando via Browserless. */
export async function fetchUniversalPricing(signal: AbortSignal): Promise<UniversalPricing> {
  const raw = await runBrowserFunction<{ eventAvailability?: unknown; captured?: number }>(
    CAPTURE_FN,
    {
      urls: [EXPRESS_URL, TICKETS_URL],
      selectors: SELECT_SELECTORS,
      settleMs: 4000,
    },
    signal,
  );
  return UniversalPricingSchema.parse(raw);
}
