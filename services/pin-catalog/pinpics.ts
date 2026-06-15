/**
 * PinPics crawler for the pin-catalog seed. PinPics is the broadest clean Disney
 * pin catalog (isolated, front-facing reference images + structured metadata) and
 * sourcing from it is established practice across the pin-trading tooling
 * ecosystem (see docs/plans/pin-traders.md § Legal & ToS).
 *
 * PinPics sits behind Cloudflare's JS challenge (`cf-mitigated: challenge`,
 * "Just a moment…"), so a plain HTTPS client gets a 403 challenge page, never the
 * pin. We therefore drive a REAL browser via Browserless — the exact same infra
 * the repo already uses for Cloudflare/Akamai-gated Universal feeds
 * (`withBrowser`, see src/server/parks/sources/browserless.ts and
 * services/README.md). Run it with `BROWSERLESS_WS_QUERY=stealth&proxy=residential`.
 *
 * We crawl POLITELY: a low request rate and provenance (`source='pinpics'`,
 * `source_ref=<pid>`) on every row so it can be purged wholesale if their stance
 * ever changes.
 *
 * PinPics references pins by a numeric PID (e.g. "Pin 22739"). Env knobs (the
 * detail-page path + range are configurable because the DOM shifts):
 *
 *   PINPICS_PIN_URL_TEMPLATE   default https://pinpics.com/pin/{id}/  ('{id}' = numeric PID)
 *   PINPICS_START_ID / END_ID  inclusive PID range to walk
 *   PINPICS_CONCURRENCY        parallel pages (default 5)
 *   PINPICS_RATE_MS            per-worker delay between page loads (default 250)
 *   PINPICS_MAX                hard ceiling per run (default 100 — fits one
 *                              Browserless session; run ranges across invocations)
 *   PINPICS_CRAWL_TIMEOUT_MS   whole-crawl budget for the browser session
 *   PINPICS_UA                 page User-Agent (a real Chrome UA passes; bot UAs
 *                              get harder-blocked by Cloudflare)
 *
 * Extraction is best-effort against the RENDERED page: OpenGraph/Twitter meta
 * first (most stable), then JSON-LD, then a <title>/<h1> fallback.
 */
import type { Browser } from "puppeteer-core";

import { withBrowser } from "#/server/parks/sources/browserless.ts";

/** A normalized-source listing the catalog pipeline can ingest (shared shape). */
export interface RawListing {
  source: string;
  sourceRef: string;
  title: string;
  imageUrl: string | null;
  priceCents: number | null;
}

const URL_TEMPLATE = process.env.PINPICS_PIN_URL_TEMPLATE ?? "https://pinpics.com/pin/{id}/";
const RATE_MS = Number(process.env.PINPICS_RATE_MS ?? 250);
const MAX = Number(process.env.PINPICS_MAX ?? 100);
/** Concurrent pages. Cloudflare clearance (cf_clearance cookie) is shared across
 *  the browser, so after the warm-up these load without re-challenging. */
const CONCURRENCY = Number(process.env.PINPICS_CONCURRENCY ?? 5);
const CRAWL_TIMEOUT_MS = Number(process.env.PINPICS_CRAWL_TIMEOUT_MS ?? 540_000);
const UA =
  process.env.PINPICS_UA ??
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Load one URL in a FRESH page (Cloudflare's challenge detaches a reused page's
 * frame, so we never reuse one), waiting out the "Just a moment…" interstitial
 * only if it appears. Returns the rendered HTML, or null on failure.
 */
async function loadPage(
  browser: Browser,
  url: string,
  opts: { settle?: boolean } = {},
): Promise<string | null> {
  const page = await browser.newPage();
  try {
    await page.setUserAgent(UA);
    await page.setViewport({ width: 1280, height: 900 });
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 });
    for (let i = 0; i < 6; i++) {
      const t = await page.title().catch(() => "");
      if (!/just a moment/i.test(t)) break;
      await page.waitForNetworkIdle({ idleTime: 800, timeout: 6_000 }).catch(() => {});
      await sleep(1_000);
    }
    // Listing pages populate their grid via JS after load — let it settle so the
    // pin cards are present in the snapshot.
    if (opts.settle)
      await page.waitForNetworkIdle({ idleTime: 1_500, timeout: 12_000 }).catch(() => {});
    return await page.content();
  } finally {
    await page.close().catch(() => {});
  }
}

/** Pull a `<meta property|name="key" content="...">` value (either attr order). */
function metaContent(html: string, ...keys: string[]): string | null {
  for (const key of keys) {
    const re = new RegExp(
      `<meta[^>]+(?:property|name)=["']${key.replace(/[:]/g, "\\$&")}["'][^>]*>`,
      "i",
    );
    const tag = re.exec(html)?.[0];
    // Match the actual quote char and read until the SAME quote, so an apostrophe
    // inside a double-quoted value (e.g. og:title "How Far I'll Go") isn't cut off.
    const content = tag && /content=(["'])([\s\S]*?)\1/i.exec(tag)?.[2];
    if (content) return content.trim();
  }
  return null;
}

/** Try a JSON-LD block for name + image (PinPics emits these on some pages). */
function jsonLd(html: string): { name?: string; image?: string } {
  const blocks = [
    ...html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi),
  ];
  for (const m of blocks) {
    try {
      const data = JSON.parse(m[1].trim());
      const nodes = Array.isArray(data) ? data : [data];
      for (const node of nodes) {
        if (node?.name || node?.image) {
          const image = Array.isArray(node.image) ? node.image[0] : node.image;
          return { name: typeof node.name === "string" ? node.name : undefined, image };
        }
      }
    } catch {
      /* malformed block — try the next */
    }
  }
  return {};
}

function titleTag(html: string): string | null {
  const t = /<title>([^<]+)<\/title>/i.exec(html)?.[1]?.trim();
  if (!t) return null;
  return t.replace(/\s*[-|]\s*PinPics\s*$/i, "").trim() || null;
}

function h1Tag(html: string): string | null {
  return (
    /<h1[^>]*>([\s\S]*?)<\/h1>/i
      .exec(html)?.[1]
      ?.replace(/<[^>]+>/g, "")
      .trim() || null
  );
}

/** Parse a rendered pin page into a RawListing, or null if it has no pin data. */
function parseListing(html: string, pid: number, url: string): RawListing | null {
  const ld = jsonLd(html);
  const title =
    metaContent(html, "og:title", "twitter:title") ?? ld.name ?? titleTag(html) ?? h1Tag(html);
  const rawImage =
    metaContent(html, "og:image:secure_url", "og:image", "twitter:image") ?? ld.image ?? null;
  const imageUrl = rawImage ? new URL(rawImage, url).toString() : null;

  // Skip the Cloudflare interstitial and PinPics's soft-404 ("Sorry, we could
  // not find that!", served as HTTP 200 for gaps in the id range).
  if (!title || /just a moment|attention required|could not find that/i.test(title)) return null;
  return { source: "pinpics", sourceRef: String(pid), title, imageUrl, priceCents: null };
}

/**
 * Walk the configured PID range in a single Browserless session, calling
 * `onListing` for each real pin. A callback (not a generator) because the browser
 * session must stay open for the whole crawl — the caller buffers + flushes.
 *
 * Speed: we WARM UP once (solve the Cloudflare challenge on the site origin so the
 * cf_clearance cookie is set browser-wide), then fan out a pool of `CONCURRENCY`
 * fresh pages. Post-clearance pages load without re-challenging, so throughput is
 * roughly CONCURRENCY × page-load — far faster than the sequential, every-page-
 * challenged path.
 */
export async function crawlPinPics(
  onListing: (listing: RawListing) => void | Promise<void>,
): Promise<void> {
  const start = Number(process.env.PINPICS_START_ID ?? 1);
  const end = Number(process.env.PINPICS_END_ID ?? start + MAX - 1);

  await withBrowser(async (browser) => {
    // Warm-up: clear the Cloudflare challenge once so every worker reuses the
    // cf_clearance cookie instead of all racing the interstitial cold.
    const origin = new URL(URL_TEMPLATE.replace("{id}", String(start))).origin;
    await loadPage(browser, origin).catch(() => null);

    let next = start;
    let fetched = 0;
    let challenged = 0;

    async function worker(): Promise<void> {
      while (fetched < MAX) {
        const pid = next++;
        if (pid > end) return;
        const url = URL_TEMPLATE.replace("{id}", String(pid));
        try {
          const html = await loadPage(browser, url);
          if (!html) continue;
          const listing = parseListing(html, pid, url);
          if (listing) {
            fetched++;
            await onListing(listing);
          } else if (/just a moment|attention required/i.test(html)) {
            challenged++;
          }
        } catch (err) {
          console.error(`[pinpics] pid=${pid} load failed:`, (err as Error)?.message ?? err);
        }
        await sleep(RATE_MS);
      }
    }

    await Promise.all(Array.from({ length: Math.max(1, CONCURRENCY) }, () => worker()));

    if (challenged > 0) {
      console.warn(
        `[pinpics] ${challenged} page(s) stuck on the Cloudflare challenge — ` +
          "set BROWSERLESS_WS_QUERY=stealth&proxy=residential (see services/README.md).",
      );
    }
    console.log(`[pinpics] crawl done — ${fetched} pin(s) from PID ${start}..${end}`);
  }, AbortSignal.timeout(CRAWL_TIMEOUT_MS));
}

/**
 * Load the pins index/listing in the real browser and print the anchor hrefs
 * that look like pin detail pages — so you can read PinPics's actual URL pattern
 * (it's an Invision Community site; records are `/pins/<cat>/<slug>-r<id>/`, not a
 * bare id path) straight from the live DOM. Set the index via PINPICS_INDEX_URL.
 *
 *   bun services/pin-catalog/main.ts pinpics-discover
 */
export async function discoverPinPics(): Promise<void> {
  const indexUrl = process.env.PINPICS_INDEX_URL ?? "https://pinpics.com/pins/";
  await withBrowser(async (browser) => {
    const html = await loadPage(browser, indexUrl, { settle: true });
    if (!html) {
      console.log(`[pinpics-discover] no HTML from ${indexUrl}`);
      return;
    }

    // Collect every distinct same-host link, then bucket by path shape so the
    // real pin-record pattern is obvious (vs. /page/ pagination, nav, etc.).
    const host = new URL(indexUrl).host;
    const paths = new Set<string>();
    for (const m of html.matchAll(/href=["']([^"']+)["']/gi)) {
      try {
        const u = new URL(m[1], indexUrl);
        if (u.host === host) paths.add(u.pathname);
      } catch {
        /* skip unparseable href */
      }
    }
    const all = [...paths].sort();
    const pinish = all.filter((p) => /\/pins?\//i.test(p) && !/\/pins\/page\//i.test(p));

    console.log(`[pinpics-discover] index=${indexUrl}`);
    console.log(`  title: ${titleTag(html) ?? "(none)"}`);
    console.log(`  ${all.length} distinct same-host link path(s); pin-ish (non-paginated):`);
    for (const p of pinish.slice(0, 50)) console.log(`    ${p}`);
    if (pinish.length === 0) {
      console.log("    (none) — pin links may be JS-rendered into cards. Body sample below:");
      // Strip scripts/styles and show a slice of the grid markup to read the card shape.
      const body =
        /<body[\s\S]*?<\/body>/i
          .exec(html)?.[0]
          ?.replace(/<script[\s\S]*?<\/script>/gi, "")
          .replace(/<style[\s\S]*?<\/style>/gi, "")
          .replace(/\s+/g, " ") ?? html;
      console.log(`\n${body.slice(0, 3_000)}`);
    }
  }, AbortSignal.timeout(120_000));
}

/**
 * Load a single pin and return the extracted fields — for validating the URL
 * template + selectors before a full crawl (`pinpics-probe <pid>`).
 */
export async function probePinPics(pid: number): Promise<void> {
  const url = URL_TEMPLATE.replace("{id}", String(pid));
  await withBrowser(async (browser) => {
    const html = await loadPage(browser, url);
    if (!html) {
      console.log(`[pinpics-probe] pid=${pid} — no HTML returned`);
      return;
    }
    const challenged = /just a moment|attention required/i.test(html);
    const listing = parseListing(html, pid, url);
    console.log(`[pinpics-probe] pid=${pid} url=${url}`);
    console.log(`  challenged: ${challenged}`);
    console.log(`  html bytes: ${html.length}`);
    console.log(`  title:      ${listing?.title ?? "(none extracted)"}`);
    console.log(`  imageUrl:   ${listing?.imageUrl ?? "(none extracted)"}`);
    if (!listing) {
      console.log(`  <title> tag: ${titleTag(html) ?? "(none)"}`);
      console.log("  → No listing parsed. Adjust PINPICS_PIN_URL_TEMPLATE or selectors.");
    }
    // Dump the <head> (where og/meta/JSON-LD live) so you can eyeball the real
    // structure when extraction comes back empty — capped so it stays readable.
    const head = /<head[\s\S]*?<\/head>/i.exec(html)?.[0] ?? html;
    console.log("\n--- rendered <head> (first 2 KB) ---");
    console.log(head.slice(0, 2_000));
    console.log("--- end ---");
  }, AbortSignal.timeout(120_000));
}
