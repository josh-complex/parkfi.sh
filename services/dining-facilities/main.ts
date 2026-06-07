/**
 * WDW dining catalog refresh (Railway cron, weekly — e.g. "0 6 * * 1").
 * Single-shot: reuse the maintained OneID session, pull /dine-res/api/dine/
 * facilities, upsert `restaurant_dim`, soft-delete venues that dropped out.
 * The catalog is near-static — this is decoupled from the availability sweep
 * and shares only the session + table. See research/disney-ticket-deep-dive.md.
 *
 * Run:  bun run dining:facilities
 */
import { config as loadEnv } from "dotenv";
loadEnv({ path: [".env.local", ".env"] });

import { notInArray, sql } from "drizzle-orm";

import { db } from "#/db/index.ts";
import { restaurantDim } from "#/db/schema.ts";
import { config } from "#/server/parks/config.ts";
import { ensureLoggedIn, relogin } from "#/server/dining/disney-session.ts";
import { fetchFacilities } from "#/server/dining/facilities.ts";
import { browserlessConfigured, withBrowser } from "#/server/parks/sources/browserless.ts";

async function main() {
  if (!browserlessConfigured()) {
    console.error("[dining-facilities] BROWSER_WS_ENDPOINT not set");
    process.exit(1);
  }
  const now = new Date();

  const rows = await withBrowser(async (browser) => {
    const page = await ensureLoggedIn(browser);
    try {
      return await fetchFacilities(page);
    } catch (err) {
      if (err instanceof Error && err.message.includes("session invalid")) {
        // Stored session passed cookie-check but was rejected by the API — force re-login once.
        await relogin(page);
        return fetchFacilities(page);
      }
      throw err;
    }
  }, AbortSignal.timeout(config.browserlessTimeoutMs));
  if (rows.length === 0) {
    console.warn("[dining-facilities] catalog returned no venues — session invalid?");
    return;
  }

  for (let i = 0; i < rows.length; i += 500) {
    await db
      .insert(restaurantDim)
      .values(
        rows
          .slice(i, i + 500)
          .map((r) => ({ ...r, active: true, lastSeenAt: now, updatedAt: now })),
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
          active: sql`true`,
          lastSeenAt: sql`excluded.last_seen_at`,
          updatedAt: sql`excluded.updated_at`,
          // priority is config/human-controlled — never overwrite it from the catalog
        },
      });
  }

  // Soft-delete: venues no longer listed stay as rows (FK + history) but go inactive.
  const seen = rows.map((r) => r.facilityId);
  const deactivated = await db
    .update(restaurantDim)
    .set({ active: false, updatedAt: now })
    .where(notInArray(restaurantDim.facilityId, seen))
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
