/**
 * Monthly geo enrichment cron (Railway cron, e.g. "0 6 1 * *"). Single-shot,
 * per-step isolated (`runStep` — a blocked upstream logs and is skipped, never
 * fails the run). Populates the nullable geo columns added to `parks` and
 * `attractions`; it's pure dimension enrichment (column updates), so there is no
 * fact table and no new `ref_source`.
 *
 * Per active park:
 *   1. ThemeParks.wiki `/entity/{uuid}/children` — the geo backbone. Resolve our
 *      attraction ids via `external_ids` (THEMEPARKS_WIKI) and write each child's
 *      lat/lng + a default `category` from its entityType. (100% coverage at both
 *      resorts, so Universal is fully covered by this step alone.)
 *   2. Park centroid + bounds from the child coords -> `parks`.
 *   3. Disney parks only: the finder explorer overrides `category` from each
 *      marker's `pin` and sets a precise center/zoom on `parks`; the destinations
 *      feed (fetched once) supplies authoritative park-center coordinates.
 *   4. Universal parks only: the resort-wide "places" feed (fetched once via
 *      Browserless) overrides `category` and fills `attraction_meta` (images,
 *      detail URL, land, tags) — the UOR analog of the Disney finder, joined on
 *      the shared `place_id` / TP `externalId` namespace. Skipped when Browserless
 *      isn't configured.
 *
 * Run:  bun run cron:geo
 */
import { config as loadEnv } from "dotenv";
loadEnv({ path: [".env.local", ".env"] });

import { and, eq, inArray, sql } from "drizzle-orm";

import { db } from "#/db/index.ts";
import { attractionMeta, externalIds } from "#/db/schema.ts";
import {
  categoryFromDisneyPin,
  categoryFromEntityType,
  categoryFromUniversalPlace,
  disneyHeroUrl,
  normalizeUniversalName,
  parseDisneyFacets,
  parseUniversalId,
  Source,
  universalDetailUrl,
  universalLandLabel,
  universalPlaceImages,
  universalPlaceTags,
  type MapCategory,
} from "#/server/parks/codes.ts";
import { config } from "#/server/parks/config.ts";
import { browserlessConfigured } from "#/server/parks/sources/browserless.ts";
import { fetchParkDetail, toNum } from "#/server/parks/sources/disney-finder.ts";
import { fetchChildren } from "#/server/parks/sources/themeparks.ts";
import { fetchUniversalPlaces } from "#/server/parks/sources/universal-places.ts";
import type { UniversalPlace, UniversalPlaces } from "#/server/parks/schemas.ts";

const KIND_ATTRACTION = "attraction";
const KIND_PARK = "park";
// The four WDW parks whose slugs equal the Disney `urlFriendlyId` finder slug.
const DISNEY_FINDER_SLUGS = new Set([
  "magic-kingdom",
  "epcot",
  "animal-kingdom",
  "hollywood-studios",
]);

interface ParkRow {
  id: number;
  slug: string;
  operatorSlug: string | null;
  uuid: string;
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Active parks that have a ThemeParks.wiki UUID, with operator context. */
async function activeParks(): Promise<Array<ParkRow>> {
  const result = await db.execute<{
    id: string;
    slug: string;
    operator_slug: string | null;
    uuid: string;
  }>(sql`
    SELECT p.id, p.slug, o.slug AS operator_slug, e.external_id AS uuid
    FROM parks p
    LEFT JOIN operators o ON o.id = p.operator_id
    JOIN external_ids e
      ON e.entity_kind = ${KIND_PARK} AND e.entity_id = p.id AND e.source = ${Source.THEMEPARKS_WIKI}
    WHERE p.active = true
    ORDER BY p.id
  `);
  return result.rows.map((r) => ({
    id: Number(r.id),
    slug: r.slug,
    operatorSlug: r.operator_slug,
    uuid: r.uuid,
  }));
}

/** Child entity UUID -> our internal attraction id (THEMEPARKS_WIKI mapping). */
async function resolveAttractionIds(childUuids: Array<string>): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (childUuids.length === 0) return map;
  for (let i = 0; i < childUuids.length; i += 500) {
    const rows = await db
      .select({ externalId: externalIds.externalId, entityId: externalIds.entityId })
      .from(externalIds)
      .where(
        and(
          eq(externalIds.source, Source.THEMEPARKS_WIKI),
          eq(externalIds.entityKind, KIND_ATTRACTION),
          inArray(externalIds.externalId, childUuids.slice(i, i + 500)),
        ),
      );
    for (const r of rows) map.set(r.externalId, r.entityId);
  }
  return map;
}

interface AttractionGeo {
  id: number;
  lat: number;
  lng: number;
  category: MapCategory;
}

/** Bulk-write lat/lng + default category for resolved attractions. */
async function writeAttractionGeo(rows: Array<AttractionGeo>): Promise<void> {
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500);
    const values = sql.join(
      chunk.map(
        (r) =>
          sql`(${r.id}::bigint, ${r.lat}::double precision, ${r.lng}::double precision, ${r.category}::text)`,
      ),
      sql`, `,
    );
    await db.execute(sql`
      UPDATE attractions AS a
      SET latitude = v.lat, longitude = v.lng, category = v.category
      FROM (VALUES ${values}) AS v(id, lat, lng, category)
      WHERE a.id = v.id
    `);
  }
}

/** Override `category` for the given attraction ids (Disney pin enrichment). */
async function overrideCategories(
  rows: Array<{ id: number; category: MapCategory }>,
): Promise<void> {
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500);
    const values = sql.join(
      chunk.map((r) => sql`(${r.id}::bigint, ${r.category}::text)`),
      sql`, `,
    );
    await db.execute(sql`
      UPDATE attractions AS a
      SET category = v.category
      FROM (VALUES ${values}) AS v(id, category)
      WHERE a.id = v.id
    `);
  }
}

/** Upsert per-attraction Disney enrichment, refreshing every field on re-crawl. */
async function upsertAttractionMeta(
  rows: Array<typeof attractionMeta.$inferInsert>,
): Promise<void> {
  for (let i = 0; i < rows.length; i += 500) {
    await db
      .insert(attractionMeta)
      .values(rows.slice(i, i + 500))
      .onConflictDoUpdate({
        target: attractionMeta.attractionId,
        set: {
          imageThumbUrl: sql`excluded.image_thumb_url`,
          imageHeroUrl: sql`excluded.image_hero_url`,
          imageAlt: sql`excluded.image_alt`,
          detailUrl: sql`excluded.detail_url`,
          land: sql`excluded.land`,
          heightRequirement: sql`excluded.height_requirement`,
          tags: sql`excluded.tags`,
          source: sql`excluded.source`,
          updatedAt: sql`now()`,
        },
      });
  }
}

/** Resolve a finder `card.url` (usually a relative path) to an absolute URL. */
function resolveDetailUrl(url?: string | null): string | null {
  if (!url) return null;
  if (/^https?:\/\//i.test(url)) return url;
  return `${config.disneyTicketBase}${url.startsWith("/") ? "" : "/"}${url}`;
}

interface Bounds {
  latMin: number;
  latMax: number;
  lngMin: number;
  lngMax: number;
  latCenter: number;
  lngCenter: number;
}

function computeBounds(coords: Array<{ lat: number; lng: number }>): Bounds | null {
  if (coords.length === 0) return null;
  let latMin = Infinity,
    latMax = -Infinity,
    lngMin = Infinity,
    lngMax = -Infinity,
    latSum = 0,
    lngSum = 0;
  for (const c of coords) {
    latMin = Math.min(latMin, c.lat);
    latMax = Math.max(latMax, c.lat);
    lngMin = Math.min(lngMin, c.lng);
    lngMax = Math.max(lngMax, c.lng);
    latSum += c.lat;
    lngSum += c.lng;
  }
  return {
    latMin,
    latMax,
    lngMin,
    lngMax,
    latCenter: latSum / coords.length,
    lngCenter: lngSum / coords.length,
  };
}

async function updateParkGeo(
  parkId: number,
  fields: {
    latitude?: number | null;
    longitude?: number | null;
    bounds?: Bounds | null;
    mapZoom?: number | null;
  },
): Promise<void> {
  const sets = [];
  if (fields.latitude != null) sets.push(sql`latitude = ${fields.latitude}`);
  if (fields.longitude != null) sets.push(sql`longitude = ${fields.longitude}`);
  if (fields.bounds) {
    sets.push(sql`lat_min = ${fields.bounds.latMin}`);
    sets.push(sql`lat_max = ${fields.bounds.latMax}`);
    sets.push(sql`lng_min = ${fields.bounds.lngMin}`);
    sets.push(sql`lng_max = ${fields.bounds.lngMax}`);
  }
  if (fields.mapZoom != null) sets.push(sql`map_zoom = ${fields.mapZoom}`);
  if (sets.length === 0) return;
  await db.execute(sql`UPDATE parks SET ${sql.join(sets, sql`, `)} WHERE id = ${parkId}`);
}

// --- per-park steps -------------------------------------------------------

/**
 * Step 1+2: children geo backbone -> attraction coords + park centroid/bounds.
 * Returns the Disney-numeric-id -> our-attraction-id map for the optional pin
 * enrichment step (empty for non-Disney parks / when nothing resolves).
 */
async function ingestChildren(park: ParkRow): Promise<Map<string, number>> {
  const payload = await fetchChildren(park.uuid, AbortSignal.timeout(config.fetchTimeoutMs));
  const numericToAttraction = new Map<string, number>();

  const childUuids = payload.children.map((c) => c.id);
  const idMap = await resolveAttractionIds(childUuids);

  const geoRows: Array<AttractionGeo> = [];
  const parkCoords: Array<{ lat: number; lng: number }> = [];
  for (const child of payload.children) {
    const lat = toNum(child.location?.latitude);
    const lng = toNum(child.location?.longitude);
    if (lat == null || lng == null) continue;
    parkCoords.push({ lat, lng });
    const attractionId = idMap.get(child.id);
    if (attractionId == null) continue;
    // The TP externalId carries a ";entityType=…" suffix; the Disney card.id
    // uses the same numeric prefix but a (sometimes different) suffix, so join on
    // the numeric prefix only.
    if (child.externalId) numericToAttraction.set(child.externalId.split(";")[0], attractionId);
    geoRows.push({
      id: attractionId,
      lat,
      lng,
      category: categoryFromEntityType(child.entityType),
    });
  }

  if (geoRows.length > 0) await writeAttractionGeo(geoRows);

  const bounds = computeBounds(parkCoords);
  if (bounds) {
    await updateParkGeo(park.id, {
      latitude: bounds.latCenter,
      longitude: bounds.lngCenter,
      bounds,
    });
  }
  console.log(
    `[geo] ${park.slug}: ${payload.children.length} children, ${geoRows.length} attractions geocoded`,
  );
  return numericToAttraction;
}

/**
 * Step 3 (Disney only): the finder explorer overrides `category` from each
 * marker's `pin` AND captures the rich per-attraction card metadata (hero image,
 * detail page, ride tags, height requirement, land) into `attraction_meta`. The
 * map `defaults` are resort-wide (not per-park), so park center/bounds stay as
 * the child-centroid from step 2 — this step only touches categories + meta.
 */
async function enrichDisneyPark(
  park: ParkRow,
  numericToAttraction: Map<string, number>,
  today: string,
): Promise<void> {
  const detail = await fetchParkDetail(
    park.slug,
    today,
    AbortSignal.timeout(config.fetchTimeoutMs),
  );
  const loc = detail.mapData?.location;

  const overrides: Array<{ id: number; category: MapCategory }> = [];
  const metaRows: Array<typeof attractionMeta.$inferInsert> = [];
  for (const marker of loc?.markers ?? []) {
    // card.id is "80010199;entityType=Attraction" — the numeric prefix joins back.
    const numeric = marker.card?.id?.split(";")[0];
    if (!numeric) continue;
    const attractionId = numericToAttraction.get(numeric);
    if (attractionId == null) continue;

    const cat = categoryFromDisneyPin(marker.pin);
    if (cat) overrides.push({ id: attractionId, category: cat });

    const thumb = marker.card?.media?.desktop ?? null;
    const { land, heightRequirement, tags } = parseDisneyFacets(marker.facets);
    metaRows.push({
      attractionId,
      imageThumbUrl: thumb,
      imageHeroUrl: disneyHeroUrl(thumb),
      imageAlt: marker.card?.media?.alt ?? null,
      detailUrl: resolveDetailUrl(marker.card?.url),
      land,
      heightRequirement,
      tags,
      source: Source.DISNEY_DIRECT,
    });
  }
  if (overrides.length > 0) await overrideCategories(overrides);
  if (metaRows.length > 0) await upsertAttractionMeta(metaRows);
  console.log(
    `[geo] ${park.slug}: ${overrides.length} categories enriched, ${metaRows.length} meta rows from Disney finder`,
  );
}

// --- Universal places enrichment (step 4, UOR only) -----------------------

interface ParkAttraction {
  id: number;
  name: string;
  externalId: string;
}

/** Active attractions of a park with their ThemeParks.wiki `externalId` (the join key). */
async function resolveParkAttractions(parkId: number): Promise<Array<ParkAttraction>> {
  const result = await db.execute<{ id: string; name: string; external_id: string }>(sql`
    SELECT a.id, a.name, e.external_id
    FROM attractions a
    JOIN external_ids e
      ON e.entity_kind = ${KIND_ATTRACTION} AND e.entity_id = a.id AND e.source = ${Source.THEMEPARKS_WIKI}
    WHERE a.park_id = ${parkId} AND a.active = true
  `);
  return result.rows.map((r) => ({ id: Number(r.id), name: r.name, externalId: r.external_id }));
}

/**
 * Lookup over the resort-wide places feed: a primary `<venue>:<leaf>` id key and
 * a `<venue>:<name>` fallback (handles the leaf-slug drift between the feeds,
 * e.g. Hagrid's `_motorcycle_` vs `_motorbike_`). Both keys are venue-scoped, so
 * matching is naturally confined to the same park.
 */
interface PlaceIndex {
  byKey: Map<string, UniversalPlace>;
  byName: Map<string, UniversalPlace>;
}

function buildPlaceIndex(places: UniversalPlaces): PlaceIndex {
  const byKey = new Map<string, UniversalPlace>();
  const byName = new Map<string, UniversalPlace>();
  for (const { place } of places.results) {
    const parsed = parseUniversalId(place.place_id);
    if (!parsed) continue;
    const keyId = `${parsed.venue}:${parsed.leaf}`;
    if (!byKey.has(keyId)) byKey.set(keyId, place);
    if (place.name) {
      const keyName = `${parsed.venue}:${normalizeUniversalName(place.name)}`;
      if (!byName.has(keyName)) byName.set(keyName, place);
    }
  }
  return { byKey, byName };
}

function matchPlace(index: PlaceIndex, attraction: ParkAttraction): UniversalPlace | null {
  const parsed = parseUniversalId(attraction.externalId);
  if (!parsed) return null;
  return (
    index.byKey.get(`${parsed.venue}:${parsed.leaf}`) ??
    index.byName.get(`${parsed.venue}:${normalizeUniversalName(attraction.name)}`) ??
    null
  );
}

/**
 * Step 4 (Universal only): match each park attraction to its place and override
 * `category` from `place_type` + fill `attraction_meta` (images, detail URL,
 * land, tags). Mirrors `enrichDisneyPark`; the places feed is shared across all
 * UOR parks (fetched once), so it's passed in as a prebuilt index.
 */
async function enrichUniversalPark(park: ParkRow, index: PlaceIndex): Promise<void> {
  const attractions = await resolveParkAttractions(park.id);
  const overrides: Array<{ id: number; category: MapCategory }> = [];
  const metaRows: Array<typeof attractionMeta.$inferInsert> = [];
  for (const attraction of attractions) {
    const place = matchPlace(index, attraction);
    if (!place) continue;

    const cat = categoryFromUniversalPlace(place.place_type?.type, place.place_type?.categories);
    if (cat) overrides.push({ id: attraction.id, category: cat });

    const images = universalPlaceImages(place.images, place.name);
    metaRows.push({
      attractionId: attraction.id,
      imageThumbUrl: images.thumb,
      imageHeroUrl: images.hero,
      imageAlt: images.alt,
      detailUrl: universalDetailUrl(place.urls),
      land: universalLandLabel(place.land_id),
      // Universal places carry no height-requirement field — leave null.
      heightRequirement: null,
      tags: universalPlaceTags(place.place_type?.categories),
      source: Source.UNIVERSAL_DIRECT,
    });
  }
  if (overrides.length > 0) await overrideCategories(overrides);
  if (metaRows.length > 0) await upsertAttractionMeta(metaRows);
  console.log(
    `[geo] ${park.slug}: ${overrides.length} categories enriched, ${metaRows.length}/${attractions.length} meta rows from Universal places`,
  );
}

// --- orchestration --------------------------------------------------------

async function runStep(label: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (err) {
    console.error(`[cron-geo] ${label} failed:`, err instanceof Error ? err.message : err);
  }
}

async function main() {
  const today = isoDate(new Date());
  const parks = await activeParks();
  if (parks.length === 0) {
    console.warn("[cron-geo] no active parks with a themeparks_wiki mapping — run db:seed first");
    return;
  }

  // The Universal "places" feed is resort-wide — fetch + index it once, then
  // enrich every UOR park from it (mirrors how the Disney destinations feed is
  // fetched once). Skipped silently when Browserless isn't configured.
  let universalIndex: PlaceIndex | null = null;
  if (parks.some((p) => p.operatorSlug === "universal")) {
    await runStep("universal places", async () => {
      if (!browserlessConfigured()) {
        console.warn(
          "[cron-geo] Browserless not configured — skipping Universal places enrichment",
        );
        return;
      }
      const places = await fetchUniversalPlaces(AbortSignal.timeout(config.browserlessTimeoutMs));
      universalIndex = buildPlaceIndex(places);
      console.log(`[geo] universal: ${places.results.length} places fetched`);
    });
  }

  for (const park of parks) {
    let numericToAttraction = new Map<string, number>();
    await runStep(`children ${park.slug}`, async () => {
      numericToAttraction = await ingestChildren(park);
    });

    // Disney parks only — the finder explorer is WDW-specific.
    if (park.operatorSlug === "disney" && DISNEY_FINDER_SLUGS.has(park.slug)) {
      await runStep(`disney enrich ${park.slug}`, () =>
        enrichDisneyPark(park, numericToAttraction, today),
      );
    } else if (park.operatorSlug === "universal" && universalIndex) {
      await runStep(`universal enrich ${park.slug}`, () =>
        enrichUniversalPark(park, universalIndex as PlaceIndex),
      );
    }
  }

  console.log(`[cron-geo] done — ${parks.length} parks processed`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
