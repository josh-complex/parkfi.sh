/**
 * Universal capture debugger. Loads the web-store in Browserless and reports
 * what actually happens — page status, redirects, every api.universalparks.com
 * request, Queue-It/Akamai signals — then runs the full capture and prints a
 * sample. Use it to pin down UNIVERSAL_TICKETS_URL / detect datacenter blocking.
 *
 * Run:  bun services/cron-tickets/debug-universal.ts
 *       UNIVERSAL_TICKETS_URL=... bun services/cron-tickets/debug-universal.ts
 */
import { config as loadEnv } from "dotenv";
loadEnv({ path: [".env.local", ".env"] });

import { config } from "#/server/parks/config.ts";
import { browserlessConfigured, withBrowser } from "#/server/parks/sources/browserless.ts";
import { fetchUniversalCatalogAndPricing } from "#/server/parks/sources/universal.ts";

const URL =
  process.env.UNIVERSAL_TICKETS_URL ?? `${config.universalStoreUrl}/web-store/en/us/park-tickets`;
const UA =
  process.env.UNIVERSAL_BROWSER_UA ??
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

async function probe() {
  await withBrowser(async (browser) => {
    const page = await browser.newPage();
    await page.setUserAgent(UA);
    await page.setViewport({ width: 1366, height: 900 });

    const api: Array<string> = [];
    page.on("request", (r) => {
      const u = r.url();
      if (u.includes("universalparks.com") || u.includes("queue-it")) {
        const h = r.headers();
        const authed = h.authorization || h.wctoken ? " [authed]" : "";
        api.push(`${r.method()} ${u.split("?")[0]}${authed}`);
      }
    });

    console.log(`→ goto ${URL}`);
    const resp = await page
      .goto(URL, { waitUntil: "networkidle2", timeout: 60_000 })
      .catch((e: Error) => {
        console.log(`  goto error: ${e.message}`);
        return null;
      });
    await new Promise((r) => setTimeout(r, 5_000)); // let late XHRs fire

    console.log(`status:    ${resp?.status() ?? "(none)"}`);
    console.log(`final url: ${page.url()}`);
    console.log(`title:     ${await page.title().catch(() => "?")}`);
    const html = await page.content().catch(() => "");
    console.log(`html len:  ${html.length}`);
    console.log(`queue-it:  ${/queue-it|queue\.it/i.test(html)}`);
    console.log(`akamai:    ${/_abck|akam|bm-verify/i.test(html)}`);
    const uniq = new Set(api);
    console.log(`api/queue requests seen (${uniq.size}):`);
    for (const r of uniq) console.log(`  ${r}`);
  }, AbortSignal.timeout(90_000));
}

async function main() {
  if (!browserlessConfigured()) {
    console.error("BROWSER_WS_ENDPOINT / BROWSERLESS_URL not set");
    process.exit(1);
  }

  console.log("=== 1) page probe ===");
  await probe();

  console.log("\n=== 2) full capture ===");
  const cap = await fetchUniversalCatalogAndPricing(
    AbortSignal.timeout(config.browserlessTimeoutMs),
  );
  console.log(`catalog SKUs: ${cap.skus.length}`);
  console.table(cap.skus.slice(0, 12));
  const priced = Object.keys(cap.eventAvailability);
  console.log(`priced SKUs:  ${priced.length}`);
  const sample = priced[0];
  if (sample) {
    const dates = Object.keys(cap.eventAvailability[sample]);
    console.log(
      `${sample}: ${dates.length} dates, first prices`,
      dates.slice(0, 5).map((d) => cap.eventAvailability[sample][d].pricing[0]?.amount),
    );
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
