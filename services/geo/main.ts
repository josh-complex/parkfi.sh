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
  disneyHeroUrl,
  parseDisneyFacets,
  Source,
  type MapCategory,
} from "#/server/parks/codes.ts";
import { config } from "#/server/parks/config.ts";
import { fetchParkDetail, toNum } from "#/server/parks/sources/disney-finder.ts";
import { fetchChildren } from "#/server/parks/sources/themeparks.ts";

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
