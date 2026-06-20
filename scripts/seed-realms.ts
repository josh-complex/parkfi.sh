/**
 * Living Layer — seed/refresh realms for ALL active parks.
 *
 * Derives realm polygons from each park's attraction lands + coordinates. Safe
 * to re-run (idempotent upsert by park_id + slug). Reads existing tables; writes
 * only the new `realm` table.
 *
 *   bun scripts/seed-realms.ts   (or: bun run living:seed-realms)
 */
import { config as loadEnv } from "dotenv";

loadEnv({ path: [".env.local", ".env"] });

import { seedAllRealms } from "#/server/living/realms.ts";

const result = await seedAllRealms();
console.log(`Seeded ${result.realms} realms across ${result.parks} parks:`);
for (const p of result.perPark) {
  console.log(`  park ${p.parkId}: ${p.realms} realms`);
}
process.exit(0);
