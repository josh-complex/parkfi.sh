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
 * Run:  bun run dining:facilities:universal
 */
import { config as loadEnv } from "dotenv";
loadEnv({ path: [".env.local", ".env"] });

// Imported after loadEnv so the module-level PostHog client sees POSTHOG_KEY.
import { flushTelemetry, reportServiceError } from "../shared/telemetry.ts";

import { and, eq, notInArray, sql } from "drizzle-orm";

import { db } from "#/db/index.ts";
import { restaurantDim } from "#/db/schema.ts";
import {
  Source,
  universalDetailUrl,
  universalDiningBookable,
  universalDiningExperience,
  universalPlaceImages,
} from "#/server/parks/codes.ts";
import { config } from "#/server/parks/config.ts";
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
  const rows = await withUniversalSession(async (page, session) => {
    const places = await fetchPlacesInPage(page, session.headers);
    const dining = places.results
      .map((r) => r.place)
      .filter((p) => p.place_type?.type === "Dining");

    const out: Array<Omit<typeof restaurantDim.$inferInsert, "priority">> = [];
    for (const p of dining) {
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
        // Official copy the places feed already carries (plan item 2.3) —
        // prefer the richer long_description.
        description: p.long_description?.trim() || p.short_description?.trim() || null,
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
          bookable: sql`excluded.bookable`,
          description: sql`coalesce(excluded.description, restaurant_dim.description)`,
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
