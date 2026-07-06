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

// Imported after loadEnv so the module-level PostHog client sees POSTHOG_KEY.
import { flushTelemetry, reportServiceError } from "../shared/telemetry.ts";

import { and, eq, inArray, sql } from "drizzle-orm";

import { db } from "#/db/index.ts";
import { attractionMeta, externalIds, parkPoi } from "#/db/schema.ts";
import {
  categoryFromDisneyPin,
  categoryFromDisneyPoi,
  categoryFromEntityType,
  categoryFromUniversalPlace,
  disneyHeroUrl,
  disneyParkHero,
  normalizeUniversalName,
  parseDisneyFacets,
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
import {
  fetchThemeParkBoundaries,
  normalizeParkName,
} from "#/server/parks/sources/osm-boundaries.ts";
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

// The finder marker `type`s that aren't attractions/dining/shops — the
// non-facility POIs we land into `park_poi` (dining/shops have their own
// catalog dims; attractions are enriched onto `attraction_meta`).
const POI_MARKER_TYPES = new Set(["guest-services", "entertainment", "events-tours"]);

/** Upsert park POIs, refreshing every field (and re-activating) on re-crawl. */
async function upsertParkPoi(rows: Array<typeof parkPoi.$inferInsert>): Promise<void> {
  for (let i = 0; i < rows.length; i += 500) {
    await db
      .insert(parkPoi)
      .values(rows.slice(i, i + 500))
      .onConflictDoUpdate({
        target: parkPoi.poiId,
        set: {
          parkId: sql`excluded.park_id`,
          poiType: sql`excluded.poi_type`,
          category: sql`excluded.category`,
          mapPin: sql`excluded.map_pin`,
          name: sql`excluded.name`,
          entityName: sql`excluded.entity_name`,
          entityId: sql`excluded.entity_id`,
          urlFriendlyId: sql`excluded.url_friendly_id`,
          latitude: sql`excluded.latitude`,
          longitude: sql`excluded.longitude`,
          land: sql`excluded.land`,
          imageUrl: sql`excluded.image_url`,
          detailUrl: sql`excluded.detail_url`,
          source: sql`excluded.source`,
          active: sql`true`,
          lastSeenAt: sql`now()`,
          updatedAt: sql`now()`,
        },
      });
  }
}

/**
 * Soft-delete this park's Disney POIs that fell out of the latest marker set
 * (active=false, keep the row + history), scoped by (park_id, source) so it
 * never touches another park's or operator's rows. An empty `seenIds` (park has
 * no POIs this run) deactivates all of them.
 */
async function deactivateStaleParkPoi(parkId: number, seenIds: Array<string>): Promise<void> {
  const notSeen =
    seenIds.length > 0
      ? sql`AND poi_id NOT IN (${sql.join(
          seenIds.map((id) => sql`${id}`),
          sql`, `,
        )})`
      : sql``;
  await db.execute(sql`
    UPDATE park_poi
    SET active = false, updated_at = now()
    WHERE park_id = ${parkId} AND source = ${Source.DISNEY_DIRECT} AND active = true ${notSeen}
  `);
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

// Bounding box ([south, west, north, east]) covering both Orlando resorts — the
// single Overpass theme-park query is scoped to this.
const ORLANDO_BBOX: [number, number, number, number] = [28.3, -81.65, 28.62, -81.4];

// Our park slug -> the OSM theme-park name(s) to match against (the DB `name`
// often carries a "Theme Park" suffix the OSM name lacks, so list it explicitly).
// "Walt Disney World" — the property-wide relation — is intentionally absent, so
// it's never selected; only the individual parks get outlined.
const OSM_PARK_NAMES: Record<string, Array<string>> = {
  "magic-kingdom": ["Magic Kingdom"],
  epcot: ["EPCOT"],
  "animal-kingdom": ["Disney's Animal Kingdom"],
  "hollywood-studios": ["Disney's Hollywood Studios"],
  "universal-studios-florida": ["Universal Studios Florida"],
  "islands-of-adventure": ["Universal Islands of Adventure", "Islands of Adventure"],
  "epic-universe": ["Universal Epic Universe", "Epic Universe"],
};

/**
 * Step 0: outline each active park from OpenStreetMap. One Overpass query returns
 * every `tourism=theme_park` boundary around Orlando; we match each park to its
 * own polygon by name and store it on `parks.boundary`. Independent of the
 * per-park feed steps (no ThemeParks UUID needed), so it runs once up front.
 */
async function ingestBoundaries(): Promise<void> {
  const boundaries = await fetchThemeParkBoundaries(
    ORLANDO_BBOX,
    AbortSignal.timeout(config.overpassTimeoutMs),
  );
  const result = await db.execute<{ id: string; slug: string; name: string }>(sql`
    SELECT id, slug, name FROM parks WHERE active = true
  `);
  let matched = 0;
  for (const row of result.rows) {
    const candidates = [...(OSM_PARK_NAMES[row.slug] ?? []), row.name].map(normalizeParkName);
    let geom = null;
    for (const c of candidates) {
      const g = boundaries.get(c);
      if (g) {
        geom = g;
        break;
      }
    }
    if (!geom) {
      console.warn(`[geo] ${row.slug}: no OSM theme_park boundary matched`);
      continue;
    }
    await db.execute(
      sql`UPDATE parks SET boundary = ${JSON.stringify(geom)}::jsonb WHERE id = ${Number(row.id)}`,
    );
    matched++;
  }
  console.log(`[geo] boundaries: ${matched}/${result.rows.length} parks outlined`);
}

/** Write a park's hero photo + alt (from the operator's own enrichment feed). */
async function updateParkImage(
  parkId: number,
  image: { url: string; alt: string | null } | null,
): Promise<void> {
  if (!image) return;
  await db.execute(
    sql`UPDATE parks SET image_url = ${image.url}, image_alt = ${image.alt} WHERE id = ${parkId}`,
  );
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

  // Park-level hero photo from the finder's hero carousel (previously discarded).
  await updateParkImage(park.id, disneyParkHero(detail.heroData?.mediaEngine?.data));

  const overrides: Array<{ id: number; category: MapCategory }> = [];
  const metaRows: Array<typeof attractionMeta.$inferInsert> = [];
  // Non-facility POIs (guest-services / entertainment / events-tours), deduped
  // by their own point-of-interest id (park-center entries repeat across a few
  // guest services — last wins, which is fine: they collapse to one info pin).
  const poiById = new Map<string, typeof parkPoi.$inferInsert>();
  for (const marker of loc?.markers ?? []) {
    if (POI_MARKER_TYPES.has(marker.type ?? "")) {
      const poiId = marker.id?.split(";")[0];
      if (!poiId) continue;
      const thumb = marker.card?.media?.desktop ?? null;
      const { land } = parseDisneyFacets(marker.facets);
      poiById.set(poiId, {
        poiId,
        parkId: park.id,
        poiType: marker.type ?? "",
        category: categoryFromDisneyPoi(marker.pin, marker.type),
        mapPin: marker.pin ?? null,
        name: marker.name ?? marker.card?.name ?? poiId,
        entityName: marker.card?.name ?? null,
        entityId: marker.card?.id?.split(";")[0] ?? null,
        urlFriendlyId: marker.card?.urlFriendlyId ?? null,
        latitude: toNum(marker.lat),
        longitude: toNum(marker.lng),
        // The trailing facet group is [park, land]; for park-wide guest services
        // it degrades to the park name — acceptable as a subtitle.
        land,
        // Guest-service thumbs are flat icon PNGs (look wrong in a photo disc) —
        // drop them so the client renders the category glyph instead. Real
        // entertainment/tour photos are upsized to a crisp hero.
        imageUrl: marker.type === "guest-services" ? null : (disneyHeroUrl(thumb) ?? thumb),
        detailUrl: resolveDetailUrl(marker.card?.url),
        source: Source.DISNEY_DIRECT,
      });
      continue;
    }
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
  const poiRows = [...poiById.values()];
  if (poiRows.length > 0) await upsertParkPoi(poiRows);
  await deactivateStaleParkPoi(park.id, [...poiById.keys()]);
  console.log(
    `[geo] ${park.slug}: ${overrides.length} categories enriched, ${metaRows.length} meta rows, ${poiRows.length} POIs from Disney finder`,
  );
}

// --- Universal places enrichment (step 4, UOR only) -----------------------

// Our park slug -> the places feed's `venue_id` (the authoritative park key;
// place_id prefixes are unreliable). Volcano Bay isn't a seeded park.
const UNIVERSAL_VENUE_BY_SLUG: Record<string, string> = {
  "universal-studios-florida": "uor.usf",
  "islands-of-adventure": "uor.ioa",
  "epic-universe": "uor.eu",
};

interface ParkAttraction {
  id: number;
  name: string;
}

/** Active attractions of a park (matched to places by normalized name). */
async function resolveParkAttractions(parkId: number): Promise<Array<ParkAttraction>> {
  const result = await db.execute<{ id: string; name: string }>(sql`
    SELECT a.id, a.name
    FROM attractions a
    WHERE a.park_id = ${parkId} AND a.active = true
  `);
  return result.rows.map((r) => ({ id: Number(r.id), name: r.name }));
}

/**
 * Indexed view of the resort-wide places feed:
 *  - `byVenueName`: venue_id -> (normalized name -> place), the join lookup.
 *    On a name collision the richer place wins (an attraction beats a same-named
 *    amenity), so a ride matches its real card, not e.g. its photo-op entry.
 *  - `landById`: place_id -> readable name for every `Land`-type place. A ride's
 *    `land_id` references one of these; resolving through it yields proper names
 *    ("uor.eu.snw" -> "SUPER NINTENDO WORLD") that the cryptic slug can't.
 */
interface PlaceIndex {
  byVenueName: Map<string, Map<string, UniversalPlace>>;
  landById: Map<string, string>;
  // venue_id -> the `Park`-type place (carries the park's own hero photo + logo).
  parkByVenue: Map<string, UniversalPlace>;
}

/** Enrichment richness — prefer the place carrying the most card metadata. */
function placeRichness(place: UniversalPlace): number {
  return (
    (place.images.length > 0 ? 1 : 0) +
    (place.land_id ? 1 : 0) +
    (place.urls.length > 0 ? 1 : 0) +
    (place.long_description ? 1 : 0)
  );
}

function buildPlaceIndex(places: UniversalPlaces): PlaceIndex {
  const byVenueName = new Map<string, Map<string, UniversalPlace>>();
  const landById = new Map<string, string>();
  const parkByVenue = new Map<string, UniversalPlace>();
  for (const { place } of places.results) {
    if (place.place_type?.type === "Land" && place.name) {
      landById.set(place.place_id, place.name);
    }
    // The Park-type place carries the park's own hero photo + logo; key it by
    // venue_id (== place_id for parks, e.g. `uor.usf`) for the enrichment step.
    if (place.place_type?.type === "Park" && place.venue_id) {
      parkByVenue.set(place.venue_id, place);
    }
    // Lands/parks are containers, not POIs we enrich onto an attraction.
    if (place.place_type?.type === "Land" || place.place_type?.type === "Park") continue;
    const venue = place.venue_id;
    if (!venue || !place.name) continue;
    const names = byVenueName.get(venue) ?? new Map<string, UniversalPlace>();
    if (!byVenueName.has(venue)) byVenueName.set(venue, names);
    const key = normalizeUniversalName(place.name);
    const existing = names.get(key);
    if (!existing || placeRichness(place) > placeRichness(existing)) names.set(key, place);
  }
  return { byVenueName, landById, parkByVenue };
}

/**
 * Step 4 (Universal only): match each park attraction to its place (by venue +
 * normalized name) and override `category` from `place_type` + fill
 * `attraction_meta` (images, detail URL, land, tags). Mirrors `enrichDisneyPark`;
 * the places feed is shared across all UOR parks (fetched once), so it's passed
 * in as a prebuilt index.
 */
async function enrichUniversalPark(park: ParkRow, index: PlaceIndex): Promise<void> {
  const venue = UNIVERSAL_VENUE_BY_SLUG[park.slug];
  const names = venue ? index.byVenueName.get(venue) : undefined;
  if (!names) {
    console.warn(`[geo] ${park.slug}: no Universal venue mapping — skipping places enrichment`);
    return;
  }

  // Park-level hero photo from the Park-type place (its `heroImage`).
  const parkPlace = venue ? index.parkByVenue.get(venue) : undefined;
  if (parkPlace) {
    const img = universalPlaceImages(parkPlace.images, parkPlace.name);
    if (img.hero) await updateParkImage(park.id, { url: img.hero, alt: img.alt });
  }

  const attractions = await resolveParkAttractions(park.id);
  const overrides: Array<{ id: number; category: MapCategory }> = [];
  const metaRows: Array<typeof attractionMeta.$inferInsert> = [];
  for (const attraction of attractions) {
    const place = names.get(normalizeUniversalName(attraction.name));
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
      // Prefer the feed's own Land-place name; fall back to the slug label.
      land:
        (place.land_id ? index.landById.get(place.land_id) : null) ??
        universalLandLabel(place.land_id),
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
    // reportServiceError also logs to stderr, so this keeps the prior console
    // output while adding PostHog capture for every step failure.
    reportServiceError("geo", label, err);
  }
}

async function main() {
  const today = isoDate(new Date());
  const parks = await activeParks();
  if (parks.length === 0) {
    console.warn("[cron-geo] no active parks with a themeparks_wiki mapping — run db:seed first");
    return;
  }

  // Park outlines from OpenStreetMap — one resort-wide Overpass query up front.
  await runStep("boundaries", ingestBoundaries);

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
  .catch((err) => {
    reportServiceError("geo", "main", err);
    process.exitCode = 1;
  })
  // Flush queued PostHog events BEFORE exiting — process.exit would drop them.
  .finally(async () => {
    await flushTelemetry();
    process.exit(process.exitCode ?? 0);
  });
