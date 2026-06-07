import { config as loadEnv } from "dotenv";
loadEnv({ path: [".env.local", ".env"] });
import { fetchClientToken, fetchTicketPricing } from "#/server/parks/sources/disney.ts";
import { config } from "#/server/parks/config.ts";

console.log("Fetching client token...");
const token = await fetchClientToken(AbortSignal.timeout(config.fetchTimeoutMs));
console.log("Got token, expires_in:", token.expires_in);

for (const addOn of ["false", "park-hopper"]) {
  console.log(`\n--- addOn=${addOn} ---`);
  try {
    const pricing = await fetchTicketPricing(
      token.access_token,
      AbortSignal.timeout(config.fetchTimeoutMs),
      "theme-parks",
    );
    const buckets = pricing.pricingCalendar?.pricingCalendar ?? [];
    console.log("Buckets:", buckets.length);
    // Look at the first date's pricing rows
    const first = buckets[0];
    if (first) {
      console.log("numDays bucket:", first.numDays);
      const firstDate = first.dates[0];
      if (firstDate) {
        console.log("First date:", firstDate.date);
        console.log("Pricing rows:", firstDate.pricing.length);
        firstDate.pricing.forEach((p) =>
          console.log("  id:", p.id, "| subtotal:", p.subtotal, "| pricePerDay:", p.pricePerDay),
        );
      }
    }
  } catch (e) {
    console.log("ERROR:", e instanceof Error ? e.message : e);
  }
}
process.exit(0);
