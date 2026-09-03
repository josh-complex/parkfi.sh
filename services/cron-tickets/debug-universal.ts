/**
 * Universal store smoke test. Pulls the three store categories and one calendar
 * batch from the SAP Commerce API exactly as the cron does — but writes nothing
 * — and prints what came back. Use it to confirm the host answers from a given
 * network (no browser involved any more) and to eyeball the SKU decode.
 *
 * Run:  bun services/cron-tickets/debug-universal.ts
 */
import { config as loadEnv } from "dotenv";
loadEnv({ path: [".env.local", ".env"] });

import {
  fetchUniversalOccCalendar,
  fetchUniversalOccCategory,
  UNIVERSAL_OCC_CATEGORIES,
  type UniversalOccCategory,
} from "#/server/parks/sources/universal-occ.ts";
import {
  universalOccPriceRows,
  universalOccSkus,
  type UniversalOccSku,
} from "#/server/parks/universal-occ.ts";

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

async function main() {
  const skus: Array<UniversalOccSku> = [];
  for (const category of Object.keys(UNIVERSAL_OCC_CATEGORIES) as Array<UniversalOccCategory>) {
    const products = await fetchUniversalOccCategory(category, AbortSignal.timeout(30_000));
    const rows = universalOccSkus(category, products);
    console.log(`${category}: ${products.length} products → ${rows.length} SKUs`);
    skus.push(...rows);
  }
  console.table(
    skus.map((s) => ({
      sku: s.sku,
      product: s.productCode,
      family: s.dims.family,
      days: s.dims.durationDays,
      parks: s.dims.parkScope.join("+"),
      ptp: s.dims.parkToPark,
      age: s.dims.ageGroup,
      res: s.dims.residency,
      tier: s.dims.passTier,
      from: s.listPriceCents,
      dated: s.datePriced,
      name: s.name?.slice(0, 48),
    })),
  );

  const today = new Date();
  const end = new Date(today);
  end.setDate(end.getDate() + 30);
  const sample = skus.filter((s) => s.datePriced).slice(0, 4);
  const calendar = await fetchUniversalOccCalendar(
    sample.map((s) => ({ partNumber: s.sku, startDate: isoDate(today), endDate: isoDate(end) })),
    AbortSignal.timeout(30_000),
  );
  const rows = universalOccPriceRows(calendar, isoDate(today), isoDate(end));
  console.log(`calendar: ${rows.length} price rows for ${sample.length} SKUs over 30 days`);
  console.table(rows.slice(0, 12));
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
