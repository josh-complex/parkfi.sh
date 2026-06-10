/**
 * WDW dining catalog refresh (Railway cron, weekly — e.g. "0 6 * * 1").
 * Single-shot, plain HTTPS: pull the PUBLIC finder dining list
 * (`list-ancestor-entities/wdw/{destinationId}/{date}/dining`), upsert
 * `restaurant_dim` (source DISNEY_DIRECT), soft-delete venues that dropped out.
 * No OneID session / Browserless — the old `/dine-res/api/dine/facilities` path
 * is now behind an Akamai bot challenge; this public catalog feed isn't. The
 * catalog is near-static and decoupled from the availability sweep.
 *
 * Run:  bun run dining:facilities
 */
import { config as loadEnv } from "dotenv";
loadEnv({ path: [".env.local", ".env"] });

import { and, eq, notInArray, sql } from "drizzle-orm";

import { db } from "#/db/index.ts";
import { restaurantDim } from "#/db/schema.ts";
import { Source } from "#/server/parks/codes.ts";
import { config } from "#/server/parks/config.ts";
import { fetchDisneyDiningCatalog } from "#/server/dining/disney-finder-catalog.ts";

// WDW resort-wide destination — the ancestor the finder lists all dining under.
const WDW_DESTINATION_ID =
  process.env.DISNEY_DINING_DESTINATION ?? "80007798;entityType=destination";

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

async function main() {
  const now = new Date();

  const rows = await fetchDisneyDiningCatalog(
    WDW_DESTINATION_ID,
    isoDate(now),
    AbortSignal.timeout(config.fetchTimeoutMs),
  );
  if (rows.length === 0) {
    console.warn("[dining-facilities] finder returned no dining venues");
    return;
  }

  for (let i = 0; i < rows.length; i += 500) {
    await db
      .insert(restaurantDim)
      .values(
        rows.slice(i, i + 500).map((r) => ({
          ...r,
          source: Source.DISNEY_DIRECT,
          active: true,
          lastSeenAt: now,
          updatedAt: now,
        })),
      )
      .onConflictDoUpdate({
        target: restaurantDim.facilityId,
        set: {
          entityType: sql`excluded.entity_type`,
          name: sql`excluded.name`,
          cuisine: sql`excluded.cuisine`,
          experienceType: sql`excluded.experience_type`,
          priceRange: sql`excluded.price_range`,
          parkResort: sql`excluded.park_resort`,
          parkResortId: sql`excluded.park_resort_id`,
          bookable: sql`excluded.bookable`,
          sellableOnline: sql`excluded.sellable_online`,
          imageUrl: sql`excluded.image_url`,
          detailUrl: sql`excluded.detail_url`,
          active: sql`true`,
          lastSeenAt: sql`excluded.last_seen_at`,
          updatedAt: sql`excluded.updated_at`,
          // priority is config/human-controlled — never overwrite it from the catalog
        },
      });
  }

  // Soft-delete: venues no longer listed stay as rows (FK + history) but go
  // inactive. Scoped to source=DISNEY_DIRECT so the UOR catalog is untouched.
  const seen = rows.map((r) => r.facilityId);
  const deactivated = await db
    .update(restaurantDim)
    .set({ active: false, updatedAt: now })
    .where(
      and(
        eq(restaurantDim.source, Source.DISNEY_DIRECT),
        notInArray(restaurantDim.facilityId, seen),
      ),
    )
    .returning({ facilityId: restaurantDim.facilityId });

  console.log(
    `[dining-facilities] upserted ${rows.length} venues, deactivated ${deactivated.length}`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
