import { config as loadEnv } from "dotenv";
loadEnv({ path: [".env.local", ".env"] });
import { fetchClientToken, fetchTicketPricing } from "#/server/parks/sources/disney.ts";
import { config } from "#/server/parks/config.ts";

const token = await fetchClientToken(AbortSignal.timeout(config.fetchTimeoutMs));

for (const addOn of ["false", "park-hopper"]) {
  console.log(`\n=== addOn=${addOn} ===`);
  const pricing = await fetchTicketPricing(
    token.access_token,
    AbortSignal.timeout(config.fetchTimeoutMs),
    "theme-parks",
  );
  const buckets = pricing.pricingCalendar?.pricingCalendar ?? [];
  for (const bucket of buckets) {
    const firstDate = bucket.dates[0];
    const uniqueIds = new Set(
      firstDate?.pricing.map((p) => p.id?.replace(/_progenstr/i, "")) ?? [],
    );
    console.log(
      `numDays=${bucket.numDays}: ${firstDate?.pricing.length ?? 0} rows on ${firstDate?.date}`,
    );
    uniqueIds.forEach((id) => {
      const row = firstDate?.pricing.find((p) => p.id?.includes(id?.split("_progenstr")[0] ?? ""));
      console.log(`  ${id} | subtotal=${row?.subtotal}`);
    });
  }
}
process.exit(0);
