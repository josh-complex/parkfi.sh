import { config as loadEnv } from "dotenv";
loadEnv({ path: [".env.local", ".env"] });
import { db } from "#/db/index.ts";
import { sql } from "drizzle-orm";

const rows = await db.execute(sql`
  SELECT sku, family, duration_days, park_scope, park_to_park, age_group, residency
  FROM product_dim
  WHERE resort = 'WDW'
  ORDER BY park_to_park DESC, duration_days, age_group, sku
`);

console.log("Total WDW rows:", rows.rows.length);
const ph = rows.rows.filter((r: any) => r.park_to_park);
const std1 = rows.rows.filter((r: any) => !r.park_to_park && r.duration_days == 1);
console.log("\nPark Hopper (park_to_park=true):", ph.length, "rows");
ph.forEach((r: any) =>
  console.log(
    " ",
    r.sku,
    "| days:",
    r.duration_days,
    "| age:",
    r.age_group,
    "| scope:",
    r.park_scope,
  ),
);
console.log("\n1-day Standard (park_to_park=false):", std1.length, "rows");
std1.forEach((r: any) => console.log(" ", r.sku, "| scope:", r.park_scope));
process.exit(0);
