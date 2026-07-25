/**
 * UOR dining catalog refresh (Railway cron, weekly — e.g. "0 7 * * 1"). The
 * Universal analog of `dining-facilities`: seed `restaurant_dim` (source
 * UNIVERSAL_DIRECT) from the resort-wide "places" feed. `facilityId` is the
 * `uor.*` place_id — the join key the availability sweep POSTs.
 *
 * `bookable` is *verified*, not guessed: a place's categories
 * (casual/full/fine/character dining) only make it a candidate; we then probe
 * the reservation-availability endpoint once (same session) and mark it bookable
 * only if that returns 200. Hotel bars/lounges and special-event dinners carry a
 * table-service category but 500 on the endpoint — this filters them out.
 * Bookable rows are seeded `priority=true` on insert (the UOR sweep is cheap — one
 * anonymous POST per restaurant covers the whole horizon — so there's no need to
 * hand-curate a hot tier like WDW). Soft-delete is scoped to
 * source=UNIVERSAL_DIRECT so it never touches the WDW catalog. `priority` is
 * never overwritten on update.
 *
 * After the catalog lands, a menu pass (plan item 2.1) crawls each venue's
 * `/contentdata/` Tridion page — a plain cookieless GET, NOT the Browserless
 * session — into the shared `dining_menu_item` generation pipeline. Toggle off
 * with DINING_DETAILS=0, same as the WDW cron.
 *
 * The places feed also carries per-venue weekly hours (`place_hours`), phone,
 * address, and accessibility slugs (probed 2026-07-23) — the contact fields
 * upsert onto `restaurant_dim`, and the weekly hours pattern expands into a
 * 14-day forward window of `dining_schedule` rows (full-replaced each run),
 * lighting up the same hours surface WDW uses.
 *
 * Run:  bun run dining:facilities:universal
 */
import { config as loadEnv } from "dotenv";
loadEnv({ path: [".env.local", ".env"] });

// Imported after loadEnv so the module-level PostHog client sees POSTHOG_KEY.
import { flushTelemetry, reportServiceError } from "../shared/telemetry.ts";

import { and, eq, inArray, notInArray, sql } from "drizzle-orm";

import { db } from "#/db/index.ts";
import { diningSchedule, restaurantDim } from "#/db/schema.ts";
import {
  Source,
  universalDetailUrl,
  universalDiningBookable,
  universalDiningExperience,
  universalPlaceImages,
} from "#/server/parks/codes.ts";
import { config } from "#/server/parks/config.ts";
import { toNum } from "#/server/parks/sources/disney-finder.ts";
import type { DiningMenuItemRow } from "#/server/dining/disney-dining-detail.ts";
import { persistMenuGenerations } from "#/server/dining/menu-persist.ts";
import {
  parkToday,
  universalAddressLine,
  universalScheduleRows,
  type UniversalPlaceHours,
} from "#/server/dining/universal-hours.ts";
import { fetchUniversalMenu, universalMenuPath } from "#/server/dining/universal-menu.ts";
import { fetchUniversalReservationAvailability } from "#/server/dining/universal-reservations.ts";
import { browserlessConfigured } from "#/server/parks/sources/browserless.ts";
import { fetchPlacesInPage } from "#/server/parks/sources/universal-places.ts";
import { withUniversalSession } from "#/server/parks/sources/universal-session.ts";

// Readable resort/venue labels for the park & CityWalk venues; hotel/other
// venues fall back to a humanized `venue_id`.
const VENUE_LABEL: Record<string, string> = {
  "uor.usf": "Universal Studios Florida",
  "uor.ioa": "Islands of Adventure",
  "uor.eu": "Epic Universe",
  "uor.cw": "Universal CityWalk",
  "uor.vb": "Volcano Bay",
};

function venueLabel(venueId?: string | null): string | null {
  if (!venueId) return null;
  if (VENUE_LABEL[venueId]) return VENUE_LABEL[venueId];
  return venueId
    .replace(/^uor\./, "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

async function main() {
  if (!browserlessConfigured()) {
    console.error("[dining-facilities-universal] BROWSER_WS_ENDPOINT not set");
    process.exit(1);
  }
  const now = new Date();
  const probeStart = now.toISOString().slice(0, 10);
  const probeEnd = new Date(now.getTime() + 86_400_000).toISOString().slice(0, 10);

  // One session: fetch the catalog, then probe each table-service candidate's
  // reservation-availability to confirm it's actually served by the endpoint.
  // Menu paths and weekly hours are collected here but processed AFTER the
  // session closes — neither needs the browser.
  const menuPaths = new Map<string, string>();
  const hoursByFacility = new Map<string, UniversalPlaceHours>();
  const rows = await withUniversalSession(async (page, session) => {
    const places = await fetchPlacesInPage(page, session.headers);
    const dining = places.results
      .map((r) => r.place)
      .filter((p) => p.place_type?.type === "Dining");

    const out: Array<Omit<typeof restaurantDim.$inferInsert, "priority">> = [];
    for (const p of dining) {
      const menuPath = universalMenuPath(p.urls);
      if (menuPath) menuPaths.set(p.place_id, menuPath);
      if (p.place_hours?.periods?.length) hoursByFacility.set(p.place_id, p.place_hours);
      const candidate = universalDiningBookable(p.place_type?.categories);
      // Probe only candidates; confirmed bookable iff the endpoint returns 200.
      const bookable =
        candidate &&
        (await fetchUniversalReservationAvailability(
          page,
          session.headers,
          p.place_id,
          probeStart,
          probeEnd,
          2,
        )) != null;
      const images = universalPlaceImages(p.images, p.name);
      out.push({
        facilityId: p.place_id,
        entityType: "restaurant",
        name: p.name ?? p.place_id,
        cuisine: null,
        experienceType: universalDiningExperience(p.place_type?.categories),
        priceRange: null,
        parkResort: venueLabel(p.venue_id),
        parkResortId: p.venue_id ?? null,
        // Map coordinates. The places feed carries geometry on all 191 venues
        // and always has; leaving them null kept every UOR restaurant off the
        // map, because `parks.dining` only plots rows with a latitude.
        latitude: toNum(p.geometry?.locations?.[0]?.lat_lng?.lat),
        longitude: toNum(p.geometry?.locations?.[0]?.lat_lng?.lng),
        // Official copy the places feed already carries (plan item 2.3) —
        // prefer the richer long_description.
        description: p.long_description?.trim() || p.short_description?.trim() || null,
        // Contact/access fields Universal publishes (2026-07-23 follow-up).
        phone: p.phone_number?.trim() || null,
        address: universalAddressLine(p.address),
        accessibility: p.accessibility_options ?? null,
        bookable,
        sellableOnline: false,
        imageUrl: images.hero,
        detailUrl: universalDetailUrl(p.urls),
        source: Source.UNIVERSAL_DIRECT,
        active: true,
        lastSeenAt: now,
        updatedAt: now,
      });
    }
    return out;
  }, AbortSignal.timeout(config.browserlessTimeoutMs));

  if (rows.length === 0) {
    console.warn("[dining-facilities-universal] places feed returned no dining venues");
    return;
  }

  for (let i = 0; i < rows.length; i += 500) {
    await db
      .insert(restaurantDim)
      // Seed `priority` = bookable on INSERT only; the update set below omits it.
      .values(rows.slice(i, i + 500).map((r) => ({ ...r, priority: r.bookable })))
      .onConflictDoUpdate({
        target: restaurantDim.facilityId,
        set: {
          entityType: sql`excluded.entity_type`,
          name: sql`excluded.name`,
          experienceType: sql`excluded.experience_type`,
          parkResort: sql`excluded.park_resort`,
          parkResortId: sql`excluded.park_resort_id`,
          latitude: sql`coalesce(excluded.latitude, restaurant_dim.latitude)`,
          longitude: sql`coalesce(excluded.longitude, restaurant_dim.longitude)`,
          bookable: sql`excluded.bookable`,
          description: sql`coalesce(excluded.description, restaurant_dim.description)`,
          phone: sql`excluded.phone`,
          address: sql`excluded.address`,
          accessibility: sql`excluded.accessibility`,
          imageUrl: sql`excluded.image_url`,
          detailUrl: sql`excluded.detail_url`,
          source: sql`excluded.source`,
          active: sql`true`,
          lastSeenAt: sql`excluded.last_seen_at`,
          updatedAt: sql`excluded.updated_at`,
          // priority is human/config-controlled — never overwrite from the catalog
        },
      });
  }

  // Soft-delete dropped UOR venues — scoped to our source so the WDW catalog is untouched.
  const seen = rows.map((r) => r.facilityId);
  const deactivated = await db
    .update(restaurantDim)
    .set({ active: false, updatedAt: now })
    .where(
      and(
        eq(restaurantDim.source, Source.UNIVERSAL_DIRECT),
        notInArray(restaurantDim.facilityId, seen),
      ),
    )
    .returning({ facilityId: restaurantDim.facilityId });

  const bookable = rows.filter((r) => r.bookable).length;
  console.log(
    `[dining-facilities-universal] upserted ${rows.length} venues (${bookable} bookable), deactivated ${deactivated.length}`,
  );

  // Hours: expand each venue's weekly `place_hours` pattern into a 14-day
  // forward window of `dining_schedule` rows. Full-replace across ALL current
  // UOR venues (not just those with hours) so a venue that stops publishing
  // hours sheds its stale rows; UOR facility ids never collide with WDW's, so
  // the WDW schedule surface is untouched.
  const today = parkToday(now);
  const scheduleRows = [...hoursByFacility.entries()].flatMap(([fid, ph]) =>
    universalScheduleRows(fid, ph, today),
  );
  for (let i = 0; i < seen.length; i += 200) {
    await db
      .delete(diningSchedule)
      .where(inArray(diningSchedule.facilityId, seen.slice(i, i + 200)));
  }
  for (let i = 0; i < scheduleRows.length; i += 500) {
    await db
      .insert(diningSchedule)
      .values(scheduleRows.slice(i, i + 500))
      .onConflictDoNothing();
  }
  console.log(
    `[dining-facilities-universal] hours: ${scheduleRows.length} schedule rows / ${hoursByFacility.size} venues with weekly hours`,
  );

  if (config.diningDetailsEnabled) {
    await crawlMenus(menuPaths, now);
  }
}

/**
 * Menu crawl (plan item 2.1): for each venue whose place carried a menu URL,
 * fetch the `/contentdata/` page model + its sub-menu tabs and land the rows
 * in the shared generation pipeline. Serial with a delay — the endpoint is
 * edge-cached and this stays a light, weekly-cron-sized crawl. Per-venue
 * try/catch isolates one bad venue; two outcomes are skipped WITHOUT touching
 * the venue's snapshot (stale beats a phantom wipe):
 *   • no menu page (redirect to oops-sorry) — most quick-service venues;
 *   • a page that parses to zero rows — the drift guard: if the Tridion
 *     markup shifts under us, we must not persist an empty generation and
 *     emit mass "removed" events.
 */
async function crawlMenus(menuPaths: Map<string, string>, now: Date): Promise<void> {
  const menuByFacility = new Map<string, Array<DiningMenuItemRow>>();
  let noPage = 0;
  let empty = 0;
  let failed = 0;

  for (const [facilityId, menuPath] of menuPaths) {
    try {
      const menuRows = await fetchUniversalMenu(facilityId, menuPath);
      if (menuRows == null) noPage++;
      else if (menuRows.length === 0) empty++;
      else menuByFacility.set(facilityId, menuRows);
    } catch {
      failed++;
    }
    if (config.diningMenuDelayMs > 0) {
      await new Promise((res) => setTimeout(res, config.diningMenuDelayMs));
    }
  }

  const stats = await persistMenuGenerations(menuByFacility, now);
  console.log(
    `[dining-facilities-universal] menus: ${menuByFacility.size} fetched of ${menuPaths.size} candidates ` +
      `(${noPage} no page, ${empty} empty, ${failed} failed), ` +
      `${stats.changed} changed / ${stats.unchanged} unchanged, ` +
      `${stats.priceChanges} price changes, ${stats.added} added / ${stats.removed} removed`,
  );
}

main()
  .catch((err) => {
    reportServiceError("dining-facilities-universal", "main", err);
    process.exitCode = 1;
  })
  // Flush queued PostHog events BEFORE exiting — process.exit would drop them.
  .finally(async () => {
    await flushTelemetry();
    process.exit(process.exitCode ?? 0);
  });
