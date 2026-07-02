/**
 * WDW finder facilities refresh (Railway cron, weekly — e.g. "0 6 * * 1").
 * Single-shot, plain HTTPS. One job, several PUBLIC finder point-crawls off the
 * same `list-ancestor-entities/wdw/{destinationId}/{date}/{type}` endpoint:
 *   • dining → upsert `restaurant_dim` (source DISNEY_DIRECT) + the
 *     `dining_location` reference table, soft-delete venues that dropped out,
 *     then enrich each active venue with schedules (`details-entity-simple`,
 *     slug-keyed → `dining_schedule`) and menus (dinemenu API, id-keyed →
 *     `dining_menu_item`) — neither rides the list feed.
 *   • shops → upsert `shop_dim` + soft-delete (see `refreshShops`).
 * Additional point crawls (characters, guest services, …) slot in the same way.
 * No OneID session / Browserless — the old `/dine-res/api/dine/facilities` path
 * is now behind an Akamai bot challenge; these public feeds aren't. The catalog
 * is near-static and decoupled from the availability sweep.
 *
 * Run:  bun run dining:facilities
 */
import { config as loadEnv } from "dotenv";
loadEnv({ path: [".env.local", ".env"] });

import { createHash } from "node:crypto";

import { and, eq, inArray, lt, notInArray, sql } from "drizzle-orm";

import { db } from "#/db/index.ts";
import {
  diningLocation,
  diningMenuItem,
  diningMenuPriceChange,
  diningMenuSnapshot,
  diningSchedule,
  restaurantDim,
  shopDim,
} from "#/db/schema.ts";
import { Source } from "#/server/parks/codes.ts";
import { config } from "#/server/parks/config.ts";
import {
  fetchDiningMenu,
  fetchDiningSchedule,
  type DiningMenuItemRow,
  type DiningScheduleRow,
} from "#/server/dining/disney-dining-detail.ts";
import {
  fetchDisneyDiningCatalog,
  type DiningCatalogRow,
} from "#/server/dining/disney-finder-catalog.ts";
import { fetchDisneyShopsCatalog } from "#/server/shops/disney-finder-shops.ts";

// WDW resort-wide destination — the ancestor the finder lists all dining under.
const WDW_DESTINATION_ID =
  process.env.DISNEY_DINING_DESTINATION ?? "80007798;entityType=destination";

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Stable content hash of a venue's menu — drives change detection. */
function menuHash(rows: Array<DiningMenuItemRow>): string {
  const lines = rows
    .map((r) =>
      [
        r.mealPeriod,
        r.groupName,
        r.itemType,
        r.title,
        r.description,
        r.price,
        r.priceType,
        r.currency,
      ].join(""),
    )
    .sort();
  return createHash("sha256").update(lines.join("")).digest("hex");
}

type PrevMenuRow = Pick<
  DiningMenuItemRow,
  "mealPeriod" | "groupName" | "title" | "price" | "priceType" | "currency"
>;

/**
 * Price moves between the previous generation and the new one. Items are matched
 * by (meal period, group, title, price type) and aligned by occurrence order so
 * duplicate titles (e.g. two beers named alike) line up. Only persisting items
 * whose price actually changed are emitted; adds/removes are left to the
 * snapshot generations.
 */
function priceChanges(
  facilityId: string,
  prev: Array<PrevMenuRow>,
  next: Array<DiningMenuItemRow>,
): Array<typeof diningMenuPriceChange.$inferInsert> {
  const keyOf = (r: PrevMenuRow): string =>
    `${r.mealPeriod}${r.groupName ?? ""}${r.title}${r.priceType ?? ""}`;
  const bucket = (rows: Array<PrevMenuRow>): Map<string, Array<PrevMenuRow>> => {
    const m = new Map<string, Array<PrevMenuRow>>();
    for (const r of rows) {
      const key = keyOf(r);
      const list = m.get(key);
      if (list) list.push(r);
      else m.set(key, [r]);
    }
    return m;
  };
  const prevByKey = bucket(prev);
  const out: Array<typeof diningMenuPriceChange.$inferInsert> = [];
  for (const [key, nextRows] of bucket(next)) {
    const prevRows = prevByKey.get(key) ?? [];
    for (let i = 0; i < Math.min(prevRows.length, nextRows.length); i++) {
      const oldPrice = prevRows[i].price ?? null;
      const newPrice = nextRows[i].price ?? null;
      if (oldPrice === newPrice) continue;
      const r = nextRows[i];
      out.push({
        facilityId,
        mealPeriod: r.mealPeriod,
        groupName: r.groupName,
        title: r.title,
        oldPrice,
        newPrice,
        priceType: r.priceType,
        currency: r.currency,
      });
    }
  }
  return out;
}

/**
 * Per-venue detail enrichment. Schedules (slug-keyed) full-replace each
 * refreshed venue. Menus (id-keyed) are APPEND-ONLY + change-only: a venue's
 * menu is hashed and a new `dining_menu_item` generation written only when the
 * hash differs from `dining_menu_snapshot`; price moves between generations are
 * logged to `dining_menu_price_change`. Per-venue try/catch isolates a single
 * bad fetch. Schedules fan out at a small concurrency (the finder host allows
 * it); menus go strictly serial and capped per run (the dinemenu API Gateway
 * rejects concurrency + rate-caps per IP) — least-recently-checked first, so
 * the catalog rolls through over successive weekly runs.
 */
async function enrichDetails(rows: Array<DiningCatalogRow>, now: Date): Promise<void> {
  const today = isoDate(now);
  const scheduleRows: Array<DiningScheduleRow> = [];
  const scheduleOk: Array<string> = [];
  const menuByFacility = new Map<string, Array<DiningMenuItemRow>>();
  let schedErr = 0;
  let menuErr = 0;

  // --- Schedules: the finder host tolerates a small concurrent burst. ---
  const window = Math.max(1, config.diningDetailConcurrency);
  const withSlug = rows.filter((r) => r.urlFriendlyId);
  for (let i = 0; i < withSlug.length; i += window) {
    await Promise.all(
      withSlug.slice(i, i + window).map(async (r) => {
        try {
          scheduleRows.push(...(await fetchDiningSchedule(r.facilityId, r.urlFriendlyId!, today)));
          scheduleOk.push(r.facilityId);
        } catch {
          schedErr++;
        }
      }),
    );
    if (i + window < withSlug.length) await new Promise((res) => setTimeout(res, 200));
  }

  // --- Menus: the dinemenu API Gateway rejects concurrency and rate-caps per
  // IP, so go strictly serial with a gap, capped per run. Refresh the least-
  // recently-checked venues first (never-checked lead) so coverage rolls across
  // weekly runs. The change-only generational model makes partial runs correct.
  const existingChecks = await db
    .select({
      facilityId: diningMenuSnapshot.facilityId,
      lastCheckedAt: diningMenuSnapshot.lastCheckedAt,
    })
    .from(diningMenuSnapshot)
    .where(
      inArray(
        diningMenuSnapshot.facilityId,
        rows.map((r) => r.facilityId),
      ),
    );
  const checkedAt = new Map(existingChecks.map((s) => [s.facilityId, s.lastCheckedAt.getTime()]));
  const menuTargets = [...rows]
    .sort((a, b) => (checkedAt.get(a.facilityId) ?? 0) - (checkedAt.get(b.facilityId) ?? 0))
    .slice(0, Math.max(0, config.diningMenuMaxPerRun));
  for (const r of menuTargets) {
    try {
      menuByFacility.set(r.facilityId, await fetchDiningMenu(r.facilityId, 6));
    } catch {
      menuErr++;
    }
    if (config.diningMenuDelayMs > 0) {
      await new Promise((res) => setTimeout(res, config.diningMenuDelayMs));
    }
  }

  // Schedules: full-replace each refreshed venue, then prune past-dated rows so
  // the forward window doesn't accrete history.
  for (let i = 0; i < scheduleOk.length; i += 200) {
    await db
      .delete(diningSchedule)
      .where(inArray(diningSchedule.facilityId, scheduleOk.slice(i, i + 200)));
  }
  for (let i = 0; i < scheduleRows.length; i += 500) {
    await db
      .insert(diningSchedule)
      .values(scheduleRows.slice(i, i + 500))
      .onConflictDoNothing();
  }
  await db.delete(diningSchedule).where(lt(diningSchedule.scheduleDate, today));

  // Menus: change-only generations + price-change log.
  const menuOk = [...menuByFacility.keys()];
  const existing = menuOk.length
    ? await db
        .select({
          facilityId: diningMenuSnapshot.facilityId,
          contentHash: diningMenuSnapshot.contentHash,
          observedAt: diningMenuSnapshot.observedAt,
        })
        .from(diningMenuSnapshot)
        .where(inArray(diningMenuSnapshot.facilityId, menuOk))
    : [];
  const snapByFid = new Map(existing.map((s) => [s.facilityId, s]));

  const newItems: Array<typeof diningMenuItem.$inferInsert> = [];
  const snapUpserts: Array<typeof diningMenuSnapshot.$inferInsert> = [];
  const priceRows: Array<typeof diningMenuPriceChange.$inferInsert> = [];
  const unchanged: Array<string> = [];

  for (const fid of menuOk) {
    const next = menuByFacility.get(fid) ?? [];
    const hash = menuHash(next);
    const snap = snapByFid.get(fid);
    if (snap && snap.contentHash === hash) {
      unchanged.push(fid);
      continue;
    }
    if (snap) {
      const prev = await db
        .select({
          mealPeriod: diningMenuItem.mealPeriod,
          groupName: diningMenuItem.groupName,
          title: diningMenuItem.title,
          price: diningMenuItem.price,
          priceType: diningMenuItem.priceType,
          currency: diningMenuItem.currency,
        })
        .from(diningMenuItem)
        .where(
          and(eq(diningMenuItem.facilityId, fid), eq(diningMenuItem.observedAt, snap.observedAt)),
        );
      priceRows.push(...priceChanges(fid, prev, next));
    }
    for (const r of next) newItems.push({ ...r, observedAt: now });
    snapUpserts.push({
      facilityId: fid,
      contentHash: hash,
      observedAt: now,
      itemCount: next.length,
      lastCheckedAt: now,
    });
  }

  for (let i = 0; i < newItems.length; i += 500) {
    await db.insert(diningMenuItem).values(newItems.slice(i, i + 500));
  }
  for (let i = 0; i < snapUpserts.length; i += 500) {
    await db
      .insert(diningMenuSnapshot)
      .values(snapUpserts.slice(i, i + 500))
      .onConflictDoUpdate({
        target: diningMenuSnapshot.facilityId,
        set: {
          contentHash: sql`excluded.content_hash`,
          observedAt: sql`excluded.observed_at`,
          itemCount: sql`excluded.item_count`,
          lastCheckedAt: sql`excluded.last_checked_at`,
          // first_seen_at is preserved (never in the update set).
        },
      });
  }
  // Unchanged venues: just bump liveness.
  for (let i = 0; i < unchanged.length; i += 200) {
    await db
      .update(diningMenuSnapshot)
      .set({ lastCheckedAt: now })
      .where(inArray(diningMenuSnapshot.facilityId, unchanged.slice(i, i + 200)));
  }
  for (let i = 0; i < priceRows.length; i += 500) {
    await db.insert(diningMenuPriceChange).values(priceRows.slice(i, i + 500));
  }

  console.log(
    `[dining-facilities] schedules: ${scheduleRows.length} rows / ${scheduleOk.length} venues (${schedErr} failed); ` +
      `menus: ${menuOk.length} fetched (${menuErr} failed), ${snapUpserts.length} changed / ${unchanged.length} unchanged, ` +
      `${priceRows.length} price changes`,
  );
}

/**
 * Shops point-crawl — the retail counterpart to the dining catalog, folded into
 * this same weekly job (one finder crawl, not a second cron). Fetch the PUBLIC
 * shops list, upsert `shop_dim` (source DISNEY_DIRECT), soft-delete shops that
 * dropped out. Catalog-only: shops carry their marker + categories inline, so
 * there's no per-shop schedule/menu enrichment to do.
 */
async function refreshShops(now: Date): Promise<void> {
  const rows = await fetchDisneyShopsCatalog(
    WDW_DESTINATION_ID,
    isoDate(now),
    AbortSignal.timeout(config.fetchTimeoutMs),
  );
  if (rows.length === 0) {
    console.warn("[dining-facilities] finder returned no shops");
    return;
  }

  for (let i = 0; i < rows.length; i += 500) {
    await db
      .insert(shopDim)
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
        target: shopDim.facilityId,
        set: {
          name: sql`excluded.name`,
          urlFriendlyId: sql`excluded.url_friendly_id`,
          latitude: sql`excluded.latitude`,
          longitude: sql`excluded.longitude`,
          mapPin: sql`excluded.map_pin`,
          land: sql`excluded.land`,
          landId: sql`excluded.land_id`,
          parkResort: sql`excluded.park_resort`,
          parkResortId: sql`excluded.park_resort_id`,
          imageUrl: sql`excluded.image_url`,
          detailUrl: sql`excluded.detail_url`,
          merchandise: sql`excluded.merchandise`,
          disneyOwned: sql`excluded.disney_owned`,
          active: sql`true`,
          lastSeenAt: sql`excluded.last_seen_at`,
          updatedAt: sql`excluded.updated_at`,
        },
      });
  }

  const seen = rows.map((r) => r.facilityId);
  const deactivated = await db
    .update(shopDim)
    .set({ active: false, updatedAt: now })
    .where(and(eq(shopDim.source, Source.DISNEY_DIRECT), notInArray(shopDim.facilityId, seen)))
    .returning({ facilityId: shopDim.facilityId });

  console.log(
    `[dining-facilities] shops: upserted ${rows.length}, deactivated ${deactivated.length}`,
  );
}

async function main() {
  const now = new Date();

  const { rows, locations } = await fetchDisneyDiningCatalog(
    WDW_DESTINATION_ID,
    isoDate(now),
    AbortSignal.timeout(config.fetchTimeoutMs),
  );
  if (rows.length === 0) {
    console.warn("[dining-facilities] finder returned no dining venues");
    return;
  }

  // Refresh the ancestor-location reference table (theme parks, resorts, …).
  if (locations.length > 0) {
    await db
      .insert(diningLocation)
      .values(locations.map((l) => ({ ...l, updatedAt: now })))
      .onConflictDoUpdate({
        target: diningLocation.id,
        set: {
          title: sql`excluded.title`,
          urlFriendlyId: sql`excluded.url_friendly_id`,
          locationType: sql`excluded.location_type`,
          updatedAt: sql`excluded.updated_at`,
        },
      });
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
          urlFriendlyId: sql`excluded.url_friendly_id`,
          cuisine: sql`excluded.cuisine`,
          experienceType: sql`excluded.experience_type`,
          priceRange: sql`excluded.price_range`,
          parkResort: sql`excluded.park_resort`,
          parkResortId: sql`excluded.park_resort_id`,
          bookable: sql`excluded.bookable`,
          sellableOnline: sql`excluded.sellable_online`,
          imageUrl: sql`excluded.image_url`,
          detailUrl: sql`excluded.detail_url`,
          latitude: sql`excluded.latitude`,
          longitude: sql`excluded.longitude`,
          mapPin: sql`excluded.map_pin`,
          land: sql`excluded.land`,
          landId: sql`excluded.land_id`,
          maximumPartySize: sql`excluded.maximum_party_size`,
          walkupWaitList: sql`excluded.walkup_wait_list`,
          mobileOrder: sql`excluded.mobile_order`,
          characterDining: sql`excluded.character_dining`,
          fineDining: sql`excluded.fine_dining`,
          diningPackage: sql`excluded.dining_package`,
          annualPassDiscount: sql`excluded.annual_pass_discount`,
          disneyVisaDiscount: sql`excluded.disney_visa_discount`,
          tripAdvisorAward: sql`excluded.trip_advisor_award`,
          diningPlanQs: sql`excluded.dining_plan_qs`,
          diningPlanTs: sql`excluded.dining_plan_ts`,
          disneyFavorites: sql`excluded.disney_favorites`,
          diningInterests: sql`excluded.dining_interests`,
          entertainmentType: sql`excluded.entertainment_type`,
          eecCategory: sql`excluded.eec_category`,
          productUrls: sql`excluded.product_urls`,
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

  // Shops point-crawl — isolated so a shops-feed hiccup can't fail the dining
  // refresh (or its enrichment below).
  try {
    await refreshShops(now);
  } catch (err) {
    console.error("[dining-facilities] shops refresh failed:", err);
  }

  // Enrich the active venues with schedules + menus (catalog feed carries
  // neither). Toggle off with DINING_DETAILS=0 for a fast catalog-only run.
  if (config.diningDetailsEnabled) {
    await enrichDetails(rows, now);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
