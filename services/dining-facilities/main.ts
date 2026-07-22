/**
 * WDW finder facilities refresh (Railway cron, weekly — e.g. "0 6 * * 1").
 * Single-shot, plain HTTPS. One job, several PUBLIC finder point-crawls off the
 * same `list-ancestor-entities/wdw/{destinationId}/{date}/{type}` endpoint:
 *   • dining → upsert `restaurant_dim` (source DISNEY_DIRECT) + the
 *     `dining_location` reference table, soft-delete venues that dropped out,
 *     refresh today's `dining_schedule` rows from the list feed's INLINE
 *     schedules (one request — what makes a daily DINING_DETAILS=0 run useful),
 *     then enrich each active venue with schedules + description/AP-discount
 *     (`details-entity-simple`, slug-keyed → `dining_schedule` +
 *     `restaurant_dim` copy columns) and menus (dinemenu API, id-keyed →
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

// Imported after loadEnv so the module-level PostHog client sees POSTHOG_KEY.
import { flushTelemetry, reportServiceError } from "../shared/telemetry.ts";

import { createHash } from "node:crypto";

import { and, eq, inArray, lt, notInArray, sql } from "drizzle-orm";

import { db } from "#/db/index.ts";
import {
  diningLocation,
  diningMenuEvent,
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
  fetchDiningDetail,
  fetchDiningMenu,
  type DiningDetailEnrichment,
  type DiningMenuItemRow,
  type DiningScheduleRow,
} from "#/server/dining/disney-dining-detail.ts";
import {
  fetchDisneyDiningCatalog,
  type DiningCatalogRow,
} from "#/server/dining/disney-finder-catalog.ts";
import { diffMenu } from "#/server/dining/menu-diff.ts";
import { fetchDisneyShopsCatalog } from "#/server/shops/disney-finder-shops.ts";

// WDW resort-wide destination — the ancestor the finder lists all dining under.
const WDW_DESTINATION_ID =
  process.env.DISNEY_DINING_DESTINATION ?? "80007798;entityType=destination";

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Retry a query through a transient connection drop. This run holds a pooled
 * client idle across slow serial menu fetches; the server/pooler can reap that
 * socket ("Connection terminated unexpectedly"). The pool discards the dead
 * client (see the `pool.on('error')` handler in db/index.ts), so a retry
 * acquires a fresh one. Matters most on the first post-1.6 run, where the hash
 * churns every venue and the per-venue prev read fires hundreds of times — one
 * dropped read used to kill the whole run before any writes committed, so it
 * re-churned and died again every run. Connection-shaped errors only; a real
 * query error still throws straight through.
 */
async function withDbRetry<T>(op: () => Promise<T>, attempts = 3): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await op();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const transient =
        /Connection terminated|terminating connection|ECONNRESET|ECONNREFUSED|socket hang up|connection error/i.test(
          msg,
        );
      if (!transient || i >= attempts) throw err;
      await new Promise((res) => setTimeout(res, 250 * i));
    }
  }
}

/**
 * Stable content hash of a venue's menu — drives change detection. Includes
 * the full price-tier list (plan item 1.6) so a beyond-first-tier move
 * registers. NB: adding `prices` makes every venue read "changed" on the first
 * run after deploy — one generation of churn, no false diff events (the diff
 * compares values).
 */
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
        r.prices ? JSON.stringify(r.prices) : "",
      ].join(""),
    )
    .sort();
  return createHash("sha256").update(lines.join("")).digest("hex");
}

/**
 * Per-venue detail enrichment. Schedules (slug-keyed) full-replace each
 * refreshed venue; the same detail payload's description + AP discount %
 * update `restaurant_dim` (plan item 2.3 — zero extra requests). Menus (id-keyed) are APPEND-ONLY + change-only: a venue's
 * menu is hashed and a new `dining_menu_item` generation written only when the
 * hash differs from `dining_menu_snapshot`; price moves between generations are
 * logged to `dining_menu_price_change`. Per-venue try/catch isolates a single
 * bad fetch. Schedules fan out at a small concurrency (the finder host allows
 * it); menus go strictly serial and capped per run (the dinemenu API Gateway
 * rejects concurrency + rate-caps per IP) — least-recently-checked first, so
 * anything the per-run cap can't reach leads the next run. The cap is sized to
 * cover the whole catalog in one run, so change detection is only as stale as
 * the cron cadence (see `config.diningMenuMaxPerRun`).
 */
async function enrichDetails(rows: Array<DiningCatalogRow>, now: Date): Promise<void> {
  const today = isoDate(now);
  const scheduleRows: Array<DiningScheduleRow> = [];
  const scheduleOk: Array<string> = [];
  const menuByFacility = new Map<string, Array<DiningMenuItemRow>>();
  let schedErr = 0;
  let menuErr = 0;

  // --- Schedules + enrichment: one detail fetch per venue (the finder host
  // tolerates a small concurrent burst). The same payload carries the venue's
  // description + AP discount % (plan item 2.3), collected for a batched
  // restaurant_dim update below.
  const enrichmentByFacility = new Map<string, DiningDetailEnrichment>();
  const window = Math.max(1, config.diningDetailConcurrency);
  const withSlug = rows.filter((r) => r.urlFriendlyId);
  for (let i = 0; i < withSlug.length; i += window) {
    await Promise.all(
      withSlug.slice(i, i + window).map(async (r) => {
        try {
          const detail = await fetchDiningDetail(r.facilityId, r.urlFriendlyId!, today);
          scheduleRows.push(...detail.schedule);
          scheduleOk.push(r.facilityId);
          enrichmentByFacility.set(r.facilityId, detail.enrichment);
        } catch {
          schedErr++;
        }
      }),
    );
    if (i + window < withSlug.length) await new Promise((res) => setTimeout(res, 200));
  }

  // Enrichment: batched per-venue update. Descriptions and hero media are
  // never nulled out on an absent field (stale beats none); the AP percentage
  // IS nulled when the modal stops publishing one (the discount genuinely
  // ended).
  const enriched = [...enrichmentByFacility.entries()];
  for (let i = 0; i < enriched.length; i += 100) {
    await Promise.all(
      enriched.slice(i, i + 100).map(([facilityId, e]) =>
        db
          .update(restaurantDim)
          .set({
            ...(e.description != null ? { description: e.description } : {}),
            ...(e.heroMedia != null ? { heroMedia: e.heroMedia } : {}),
            apDiscountPct: e.apDiscountPct,
            updatedAt: now,
          })
          .where(eq(restaurantDim.facilityId, facilityId)),
      ),
    );
  }

  // --- Menus: the dinemenu API Gateway rejects concurrency and rate-caps per
  // IP, so go strictly serial with a gap, capped per run. Refresh the least-
  // recently-checked venues first (never-checked lead) so a cap that can't cover
  // the catalog still rolls through. The change-only generational model makes
  // partial runs correct.
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
  const eventRows: Array<typeof diningMenuEvent.$inferInsert> = [];
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
      const prev = await withDbRetry(() =>
        db
          .select({
            mealPeriod: diningMenuItem.mealPeriod,
            groupName: diningMenuItem.groupName,
            itemType: diningMenuItem.itemType,
            title: diningMenuItem.title,
            description: diningMenuItem.description,
            price: diningMenuItem.price,
            priceType: diningMenuItem.priceType,
            currency: diningMenuItem.currency,
            prices: diningMenuItem.prices,
          })
          .from(diningMenuItem)
          .where(
            and(eq(diningMenuItem.facilityId, fid), eq(diningMenuItem.observedAt, snap.observedAt)),
          ),
      );
      const diff = diffMenu(fid, prev, next);
      priceRows.push(...diff.priceRows);
      eventRows.push(...diff.eventRows);
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
  for (let i = 0; i < eventRows.length; i += 500) {
    await db.insert(diningMenuEvent).values(eventRows.slice(i, i + 500));
  }

  const added = eventRows.filter((e) => e.changeType === "added").length;
  const removed = eventRows.filter((e) => e.changeType === "removed").length;
  console.log(
    `[dining-facilities] schedules: ${scheduleRows.length} rows / ${scheduleOk.length} venues (${schedErr} failed); ` +
      `enrichment: ${enriched.length} venues; ` +
      `menus: ${menuOk.length} fetched (${menuErr} failed), ${snapUpserts.length} changed / ${unchanged.length} unchanged, ` +
      `${priceRows.length} price changes, ${added} added / ${removed} removed`,
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

  const { rows, locations, todaySchedules } = await fetchDisneyDiningCatalog(
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
          quickService: sql`excluded.quick_service`,
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

  // Inline TODAY hours from the list feed (~372/409 venues carry them): full-
  // replace each carrying venue's today rows so a daily DINING_DETAILS=0 run
  // keeps `dining_schedule` fresh at ONE request. The weekly per-venue detail
  // pass below still owns the forward week (and re-replaces today identically).
  if (todaySchedules.length > 0) {
    const today = isoDate(now);
    const fids = [...new Set(todaySchedules.map((r) => r.facilityId))];
    for (let i = 0; i < fids.length; i += 200) {
      await db
        .delete(diningSchedule)
        .where(
          and(
            inArray(diningSchedule.facilityId, fids.slice(i, i + 200)),
            eq(diningSchedule.scheduleDate, today),
          ),
        );
    }
    for (let i = 0; i < todaySchedules.length; i += 500) {
      await db
        .insert(diningSchedule)
        .values(todaySchedules.slice(i, i + 500))
        .onConflictDoNothing();
    }
    console.log(
      `[dining-facilities] inline today hours: ${todaySchedules.length} rows / ${fids.length} venues`,
    );
  }

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
  .catch((err) => {
    reportServiceError("dining-facilities", "main", err);
    process.exitCode = 1;
  })
  // Flush queued PostHog events BEFORE exiting — process.exit would drop them.
  .finally(async () => {
    await flushTelemetry();
    process.exit(process.exitCode ?? 0);
  });
