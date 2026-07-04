/**
 * Living Layer — seed/refresh worlds for ALL active parks.
 *
 * Derives world polygons from each park's attraction lands + coordinates. Safe
 * to re-run (idempotent upsert by park_id + slug). Reads existing tables; writes
 * only the new `world` table.
 *
 *   bun scripts/seed-worlds.ts   (or: bun run living:seed-worlds)
 */
import { config as loadEnv } from "dotenv";

loadEnv({ path: [".env.local", ".env"] });

import { seedAllWorlds } from "#/server/living/worlds.ts";

const result = await seedAllWorlds();
console.log(`Seeded ${result.worlds} worlds across ${result.parks} parks:`);
for (const p of result.perPark) {
  console.log(`  park ${p.parkId}: ${p.worlds} worlds`);
}
process.exit(0);
