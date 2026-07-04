/**
 * Living Layer / Kingdom Hearts (M5) — seed each land's Disney-character
 * companion for a park.
 *
 * The roster is keyed by **land (World) name**: each land's iconic character
 * becomes its companion, bound to a signature ride in that land — recruiting one
 * requires defeating the Heartless there. Slugs are **globally unique**, so
 * seeding multiple parks ACCUMULATES (a re-run of the same park refreshes in
 * place; it never clobbers another park's roster). Lands not in the roster
 * (utility areas, entrances) are skipped and logged. Edit `ROSTER` to curate.
 *
 *   bun run living:seed-companions            # magic-kingdom
 *   bun run living:seed-companions epcot
 */
import { config as loadEnv } from "dotenv";

loadEnv({ path: [".env.local", ".env"] });

import { sql } from "drizzle-orm";

import { db } from "#/db/index.ts";

const slug = process.argv[2] ?? "magic-kingdom";

type CompanionSeed = {
  name: string;
  slug: string;
  element: string;
  role: "attacker" | "support";
  baseStats: { hp: number; atk: number };
};

// Land (World) name → the land's companion. Keys must match `world.name` exactly.
// A starter roster of iconic characters per land — curate freely.
const ROSTER: Record<string, CompanionSeed> = {
  // --- Magic Kingdom ---
  Adventureland: {
    name: "Jack Sparrow",
    slug: "jack-sparrow",
    element: "water",
    role: "attacker",
    baseStats: { hp: 26, atk: 8 },
  },
  Frontierland: {
    name: "Woody",
    slug: "woody",
    element: "earth",
    role: "support",
    baseStats: { hp: 30, atk: 5 },
  },
  "Liberty Square": {
    name: "Madame Leota",
    slug: "madame-leota",
    element: "dark",
    role: "support",
    baseStats: { hp: 24, atk: 6 },
  },
  Fantasyland: {
    name: "Peter Pan",
    slug: "peter-pan",
    element: "wind",
    role: "attacker",
    baseStats: { hp: 24, atk: 8 },
  },
  Tomorrowland: {
    name: "Buzz Lightyear",
    slug: "buzz-lightyear",
    element: "light",
    role: "attacker",
    baseStats: { hp: 28, atk: 7 },
  },
  "Main Street, U.S.A.": {
    name: "Mickey Mouse",
    slug: "mickey-mouse",
    element: "light",
    role: "support",
    baseStats: { hp: 30, atk: 6 },
  },

  // --- EPCOT ---
  "World Showcase": {
    name: "Elsa",
    slug: "elsa",
    element: "ice",
    role: "attacker",
    baseStats: { hp: 26, atk: 8 },
  },
  "World Celebration": {
    name: "Figment",
    slug: "figment",
    element: "light",
    role: "support",
    baseStats: { hp: 24, atk: 6 },
  },
  "World Nature": {
    name: "Nemo",
    slug: "nemo",
    element: "water",
    role: "support",
    baseStats: { hp: 26, atk: 5 },
  },
  "World Discovery": {
    name: "Star-Lord",
    slug: "star-lord",
    element: "light",
    role: "attacker",
    baseStats: { hp: 27, atk: 8 },
  },

  // --- Hollywood Studios ---
  "Toy Story Land": {
    name: "Jessie",
    slug: "jessie",
    element: "earth",
    role: "attacker",
    baseStats: { hp: 25, atk: 8 },
  },
  "Star Wars: Galaxy's Edge": {
    name: "Rey",
    slug: "rey",
    element: "light",
    role: "attacker",
    baseStats: { hp: 27, atk: 9 },
  },
  "Echo Lake": {
    name: "Indiana Jones",
    slug: "indiana-jones",
    element: "earth",
    role: "attacker",
    baseStats: { hp: 28, atk: 8 },
  },
  "Animation Courtyard": {
    name: "Stitch",
    slug: "stitch",
    element: "light",
    role: "attacker",
    baseStats: { hp: 26, atk: 8 },
  },
  "Pixar Plaza": {
    name: "Mike Wazowski",
    slug: "mike-wazowski",
    element: "dark",
    role: "support",
    baseStats: { hp: 26, atk: 6 },
  },

  // --- Animal Kingdom ---
  Africa: {
    name: "Simba",
    slug: "simba",
    element: "fire",
    role: "attacker",
    baseStats: { hp: 29, atk: 8 },
  },
  Asia: {
    name: "Baloo",
    slug: "baloo",
    element: "earth",
    role: "support",
    baseStats: { hp: 32, atk: 5 },
  },
  "Pandora – The World of Avatar": {
    name: "Neytiri",
    slug: "neytiri",
    element: "wind",
    role: "attacker",
    baseStats: { hp: 26, atk: 9 },
  },
  "Discovery Island": {
    name: "Rafiki",
    slug: "rafiki",
    element: "light",
    role: "support",
    baseStats: { hp: 27, atk: 6 },
  },
};

// Lands in this park + a deterministic signature ride (the land's lowest-id
// geocoded attraction — stable across re-runs, unlike a random pick).
const worlds = await db.execute<{ world_id: number; world_name: string; sig: number | null }>(sql`
  SELECT r.id AS world_id, r.name AS world_name,
    (SELECT a.id FROM attractions a
       JOIN attraction_meta am ON am.attraction_id = a.id
      WHERE a.park_id = r.park_id AND am.land = r.name
        AND a.category IS NOT NULL AND a.latitude IS NOT NULL
      ORDER BY a.id LIMIT 1) AS sig
  FROM world r
  JOIN parks p ON p.id = r.park_id
  WHERE p.slug = ${slug}
`);

let seeded = 0;
const skipped: string[] = [];
for (const w of worlds.rows) {
  const c = ROSTER[w.world_name];
  if (!c) continue; // land not in the roster (utility area, entrance, …)
  if (w.sig == null) {
    skipped.push(`${w.world_name} (no geocoded ride)`);
    continue;
  }
  await db.execute(sql`
    INSERT INTO companion (home_world_id, signature_attraction_id, name, slug, element, role, base_stats)
    VALUES (${w.world_id}, ${w.sig}, ${c.name}, ${c.slug}, ${c.element}, ${c.role}, ${JSON.stringify(c.baseStats)}::jsonb)
    ON CONFLICT (slug) DO UPDATE SET
      home_world_id = EXCLUDED.home_world_id,
      signature_attraction_id = EXCLUDED.signature_attraction_id,
      element = EXCLUDED.element,
      role = EXCLUDED.role,
      base_stats = EXCLUDED.base_stats
  `);
  console.log(`  ${c.name} → world "${w.world_name}" (signature ride id ${w.sig})`);
  seeded++;
}

if (seeded === 0) {
  console.error(
    `No roster lands matched worlds for "${slug}". Run living:seed-worlds first, or check the ROSTER land names.`,
  );
  process.exit(1);
}
if (skipped.length) console.log(`Skipped: ${skipped.join(", ")}`);
console.log(`Seeded ${seeded} companions for ${slug}.`);
process.exit(0);
