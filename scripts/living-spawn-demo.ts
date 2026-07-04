/**
 * Living Layer / Kingdom Hearts — conjure a test Darkness spawn from the desk.
 *
 * Picks a real attraction (with coordinates) in the given park, injects a DOWN
 * status for it, and reconciles — so a coral encounter pin appears on the map at
 * that ride. Then refresh /play/<slug> and tap it to test the battle. No park
 * visit, no GPS needed: the battle is map-driven.
 *
 *   bun run living:spawn-demo            # defaults to magic-kingdom
 *   bun run living:spawn-demo epcot      # any active park slug
 *
 * Reset afterwards: bun run living:spawn-demo --clear  (fades all system marks)
 */
import { config as loadEnv } from "dotenv";

loadEnv({ path: [".env.local", ".env"] });

import { sql } from "drizzle-orm";

import { db } from "#/db/index.ts";
import { injectStatus, reconcileNow } from "#/server/living/dev.ts";
import { AttractionStatus } from "#/server/parks/codes.ts";

const arg = process.argv[2] ?? "magic-kingdom";

if (arg === "--clear") {
  const r = await db.execute(
    sql`UPDATE mark SET state = 'faded' WHERE is_system = true AND state = 'active'`,
  );
  console.log(`Cleared ${r.rowCount ?? 0} active system marks.`);
  process.exit(0);
}

const slug = arg;
const picked = await db.execute<{
  id: number;
  name: string;
  latitude: number;
  longitude: number;
}>(sql`
  SELECT a.id, a.name, a.latitude, a.longitude
  FROM attractions a
  JOIN parks p ON p.id = a.park_id
  WHERE p.slug = ${slug}
    AND a.active = true
    AND a.category IS NOT NULL
    AND a.latitude IS NOT NULL
    AND a.longitude IS NOT NULL
  ORDER BY random()
  LIMIT 1
`);
const ride = picked.rows[0];
if (!ride) {
  console.error(`No geocoded attraction found for park "${slug}". Has it been seeded/enriched?`);
  process.exit(1);
}

await injectStatus(Number(ride.id), AttractionStatus.DOWN);
const result = await reconcileNow();
console.log(
  `Darkness spawned at "${ride.name}" (${ride.latitude}, ${ride.longitude}) — reconcile +${result.spawned}/-${result.expired}.`,
);
console.log(`Open /play/${slug}, find the coral pin, and tap it to fight.`);
process.exit(0);
