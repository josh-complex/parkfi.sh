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
 *   5. Universal parks only, layered onto step 4 (research/universal-content-
 *      parity.md): the mobile-services POI + Venues feeds and the contentdata
 *      `filtersdata` tiles / per-ride pages. These fill the attributes the
 *      places feed has no field for — numeric heights (the reason the
 *      `noHeightReq` chip was dead for every UOR ride), Express Pass, single
 *      rider, child swap, virtual line, accessibility, fun facts and real image
 *      alt text — plus the typed services/entertainment `park_poi` layers. Three
 *      GETs plus a serial crawl of ~61 ride pages; no Browserless and no
 *      session, so step 5 still runs when step 4 is skipped. Park geometry is
 *      NOT taken from it — see `ingestUniversalVenueGeo`.
 *
 * Run:  bun run cron:geo
 */
import { config as loadEnv } from "dotenv";
loadEnv({ path: [".env.local", ".env"] });

// Imported after loadEnv so the module-level PostHog client sees POSTHOG_KEY.
import { flushTelemetry, reportServiceError } from "../shared/telemetry.ts";

import { and, eq, inArray, sql } from "drizzle-orm";

import { db } from "#/db/index.ts";
import {
  attractionMeta,
  externalIds,
  parkPoi,
  shopDim,
  type GeoPolygon,
  type ParkHeroSlide,
  type ParkPoiShowtime,
} from "#/db/schema.ts";
import {
  categoryFromDisneyPin,
  categoryFromDisneyPoi,
  categoryFromEntityType,
  categoryFromUniversalPlace,
  disneyHeroUrl,
  disneyParkHero,
  disneyParkHeroSlides,
  disneyPoiType,
  normalizeUniversalName,
  parseDisneyFacets,
  Source,
  universalDetailUrl,
  universalLandLabel,
  universalPlaceImages,
  universalPlaceTags,
  type MapCategory,
  type PoiCategory,
} from "#/server/parks/codes.ts";
import { config } from "#/server/parks/config.ts";
import {
  buildDisneyEntityIndex,
  disneyEntityAttrs,
  disneyEntityPoiId,
  disneyEntityPoint,
  disneyEntityShowtimes,
  resolveDisneyEntity,
} from "#/server/parks/disney-index.ts";
import { fillMissingThumbhashes } from "#/server/parks/thumbhash.ts";
import { browserlessConfigured } from "#/server/parks/sources/browserless.ts";
import {
  fetchDestinationAttractions,
  fetchEntityDetail,
  fetchParkDetail,
  toNum,
} from "#/server/parks/sources/disney-finder.ts";
import { fetchOsmAmenities, pointInGeometry } from "#/server/parks/sources/osm-amenities.ts";
import {
  fetchThemeParkBoundaries,
  normalizeParkName,
} from "#/server/parks/sources/osm-boundaries.ts";
import { fetchChildren } from "#/server/parks/sources/themeparks.ts";
import {
  fetchAllUniversalRideFacts,
  fetchUniversalFiltersData,
  tileInfo,
} from "#/server/parks/sources/universal-content.ts";
import {
  fetchUniversalPois,
  fetchUniversalVenues,
} from "#/server/parks/sources/universal-mobile.ts";
import { fetchUniversalPlaces } from "#/server/parks/sources/universal-places.ts";
import {
  buildUniversalContentIndex,
  rideJoinKey,
  resolveUniversalRideAttrs,
  UNIVERSAL_VENUE_ID_BY_SLUG,
  universalShowtimes,
  venueBoundary,
  type TypedUniversalPoi,
  type UniversalContentIndex,
} from "#/server/parks/universal-index.ts";
import type {
  UniversalPlace,
  UniversalPlaces,
  UniversalVenue,
  UniversalVenues,
} from "#/server/parks/schemas.ts";

const KIND_ATTRACTION = "attraction";
const KIND_PARK = "park";
// The WDW parks (four theme parks + two water parks) whose slugs equal the
// Disney `urlFriendlyId` finder slug, so the explorer enrichment resolves.
const DISNEY_FINDER_SLUGS = new Set([
  "magic-kingdom",
  "epcot",
  "animal-kingdom",
  "hollywood-studios",
  "typhoon-lagoon",
  "blizzard-beach",
]);

interface ParkRow {
  id: number;
  slug: string;
  name: string;
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
    name: string;
    operator_slug: string | null;
    uuid: string;
  }>(sql`
    SELECT p.id, p.slug, p.name, o.slug AS operator_slug, e.external_id AS uuid
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
    name: r.name,
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

/**
 * Bulk-write lat/lng + default category for resolved attractions. Also
 * re-activates the row: these ids came straight off the current `/children`
 * payload, so if one was previously flagged stale by `deactivateStaleAttractions`
 * and has since come back (a delisted ride reopening, e.g.), it un-deactivates.
 */
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
      SET latitude = v.lat, longitude = v.lng, category = v.category, active = true
      FROM (VALUES ${values}) AS v(id, lat, lng, category)
      WHERE a.id = v.id
    `);
  }
}

/**
 * Persist Disney's numeric facility id as a first-class `external_ids` row.
 *
 * Every Disney enrichment used to hang off a `Map` rebuilt from the TP.wiki
 * `externalId` on each run, so the id existed only for the length of one cron
 * and nothing else could join on it. Writing it down makes the destination-wide
 * catalog joinable by id instead of by display name — the difference between
 * 187/247 and near-total coverage, since Disney decorates live names
 * ("… — New!", sponsor tails) that our board rows never carry.
 */
async function persistDisneyFacilityIds(
  rows: Array<{ attractionId: number; externalId: string }>,
): Promise<void> {
  for (let i = 0; i < rows.length; i += 500) {
    await db
      .insert(externalIds)
      .values(
        rows.slice(i, i + 500).map((r) => ({
          entityKind: KIND_ATTRACTION,
          entityId: r.attractionId,
          source: Source.DISNEY_DIRECT,
          externalId: r.externalId,
        })),
      )
      // PK is (source, entity_kind, external_id) — a re-run is a no-op, and a
      // facility id that moved to another attraction row follows it.
      .onConflictDoUpdate({
        target: [externalIds.source, externalIds.entityKind, externalIds.externalId],
        set: { entityId: sql`excluded.entity_id` },
      });
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
          // image_thumbhash/_src are deliberately untouched: the thumbhash
          // step (below) recomputes any row whose hash_src no longer matches
          // the (possibly just-updated) image_thumb_url.
          detailUrl: sql`excluded.detail_url`,
          land: sql`excluded.land`,
          heightRequirement: sql`excluded.height_requirement`,
          tags: sql`excluded.tags`,
          // Ride attributes (universal-content-parity §3). Coalesced like the
          // copy fields: a UOR run that couldn't reach the mobile services host
          // must leave the last good values in place rather than blank the
          // height chip out. WDW rows never carry these, so `min_height_in` /
          // `max_height_in` keep whatever the prose backfill derived.
          minHeightIn: sql`coalesce(excluded.min_height_in, attraction_meta.min_height_in)`,
          maxHeightIn: sql`coalesce(excluded.max_height_in, attraction_meta.max_height_in)`,
          expressPass: sql`coalesce(excluded.express_pass, attraction_meta.express_pass)`,
          singleRider: sql`coalesce(excluded.single_rider, attraction_meta.single_rider)`,
          childSwap: sql`coalesce(excluded.child_swap, attraction_meta.child_swap)`,
          virtualLine: sql`coalesce(excluded.virtual_line, attraction_meta.virtual_line)`,
          funFact: sql`coalesce(excluded.fun_fact, attraction_meta.fun_fact)`,
          accessibility: sql`case when cardinality(excluded.accessibility) > 0
            then excluded.accessibility else attraction_meta.accessibility end`,
          // Never null out copy/media a re-crawl didn't carry (stale beats
          // none) — a failed per-attraction detail fetch leaves both null.
          description: sql`coalesce(excluded.description, attraction_meta.description)`,
          heroMedia: sql`coalesce(excluded.hero_media, attraction_meta.hero_media)`,
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
          // Never blank published times out on a run that didn't carry them
          // (a fetch racing midnight, or a feed that only posts them same-day).
          schedule: sql`coalesce(excluded.schedule, park_poi.schedule)`,
          source: sql`excluded.source`,
          active: sql`true`,
          lastSeenAt: sql`now()`,
          updatedAt: sql`now()`,
        },
      });
  }
}

/**
 * Soft-delete this park's POIs that fell out of the latest crawl (active=false,
 * keep the row + history), scoped by (park_id, source) so it never touches
 * another park's or operator's rows. An empty `seenIds` (park has no POIs this
 * run) deactivates all of them.
 */
async function deactivateStaleParkPoi(
  parkId: number,
  seenIds: Array<string>,
  source: number = Source.DISNEY_DIRECT,
): Promise<void> {
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
    WHERE park_id = ${parkId} AND source = ${source} AND active = true ${notSeen}
  `);
}

/**
 * Soft-delete this park's THEMEPARKS_WIKI-sourced attractions that fell out of
 * the latest `/children` payload (active=false, keep the row + history — status
 * history, queue history, alerts, etc. all still reference the id). Scoped to
 * attractions with a THEMEPARKS_WIKI external id so degraded queue-times-only
 * rides (which this feed can't see) are never touched. An empty `seenIds` (the
 * children fetch resolved nothing) deactivates all of them.
 */
async function deactivateStaleAttractions(parkId: number, seenIds: Array<number>): Promise<void> {
  const notSeen =
    seenIds.length > 0
      ? sql`AND a.id NOT IN (${sql.join(
          seenIds.map((id) => sql`${id}`),
          sql`, `,
        )})`
      : sql``;
  await db.execute(sql`
    UPDATE attractions AS a
    SET active = false
    WHERE a.park_id = ${parkId}
      AND a.active = true
      ${notSeen}
      AND EXISTS (
        SELECT 1 FROM external_ids e
        WHERE e.entity_kind = ${KIND_ATTRACTION}
          AND e.entity_id = a.id
          AND e.source = ${Source.THEMEPARKS_WIKI}
      )
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
  // Water parks (leisure=water_park); OSM omits the "Water Park" suffix our DB carries.
  "typhoon-lagoon": ["Disney's Typhoon Lagoon"],
  "blizzard-beach": ["Disney's Blizzard Beach"],
  "volcano-bay": ["Universal Volcano Bay", "Volcano Bay"],
};

/**
 * Step 0: outline each active park from OpenStreetMap. One Overpass query returns
 * every theme-park + water-park boundary around Orlando; we match each park to
 * its own polygon by name and store it on `parks.boundary`. Independent of the
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
  // Full hero carousel (plan item 1.9) — Disney parks only; omitted callers
  // leave any previously stored slides untouched.
  heroMedia?: Array<ParkHeroSlide> | null,
): Promise<void> {
  if (!image) return;
  if (heroMedia !== undefined) {
    await db.execute(
      sql`UPDATE parks SET image_url = ${image.url}, image_alt = ${image.alt},
          hero_media = ${heroMedia == null ? null : JSON.stringify(heroMedia)}::jsonb
          WHERE id = ${parkId}`,
    );
    return;
  }
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
  const operatorIds: Array<{ attractionId: number; externalId: string }> = [];
  for (const child of payload.children) {
    const attractionId = idMap.get(child.id);
    const lat = toNum(child.location?.latitude);
    const lng = toNum(child.location?.longitude);
    if (lat != null && lng != null) parkCoords.push({ lat, lng });
    if (attractionId == null) continue;
    // The TP externalId carries a ";entityType=…" suffix; the Disney card.id
    // uses the same numeric prefix but a (sometimes different) suffix, so join on
    // the numeric prefix only.
    //
    // Registered BEFORE the coordinate check: an ungeocoded child used to be
    // `continue`d past this line, so it could never be reached by the finder
    // enrichment either — which is most of the WDW attractions that had neither
    // a point nor a meta row, and 12 UOR ones. The operator's own feed usually
    // publishes the coordinate `/children` is missing.
    if (child.externalId) {
      const numeric = child.externalId.split(";")[0];
      numericToAttraction.set(numeric, attractionId);
      operatorIds.push({ attractionId, externalId: numeric });
    }
    if (lat == null || lng == null) continue;
    geoRows.push({
      id: attractionId,
      lat,
      lng,
      category: categoryFromEntityType(child.entityType),
    });
  }

  if (geoRows.length > 0) await writeAttractionGeo(geoRows);
  if (park.operatorSlug === "disney" && operatorIds.length > 0) {
    await persistDisneyFacilityIds(operatorIds);
  }
  await deactivateStaleAttractions(park.id, [...idMap.values()]);

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

  // Park-level hero photo from the finder's hero carousel, plus the full
  // normalized slide list for the dashboard carousel (plan item 1.9).
  await updateParkImage(
    park.id,
    disneyParkHero(detail.heroData?.mediaEngine?.data, detail.heroData?.media),
    disneyParkHeroSlides(detail.heroData?.mediaEngine?.data, detail.heroData?.media),
  );

  const overrides: Array<{ id: number; category: MapCategory }> = [];
  const metaRows: Array<typeof attractionMeta.$inferInsert> = [];
  // Finder slug per meta row, for the per-attraction description pass below.
  const slugByAttractionId = new Map<number, string>();
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
        // Guest services carry the shared kind vocabulary (`restroom`, `atm`,
        // `first-aid`, …) the Universal buckets and the OSM amenities write, so
        // a services pin means the same thing at both resorts. Entertainment and
        // events-tours keep the finder's own marker type.
        poiType:
          marker.type === "guest-services"
            ? disneyPoiType(marker.card?.name, marker.name)
            : (marker.type ?? ""),
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
    // Finder slug — explicit `urlFriendlyId` first, else the detail path's last
    // segment ("/attractions/magic-kingdom/space-mountain/" -> "space-mountain").
    const slug =
      marker.card?.urlFriendlyId ?? marker.card?.url?.split("/").filter(Boolean).pop() ?? null;
    if (slug) slugByAttractionId.set(attractionId, slug);
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

  // Per-attraction official copy + media collection (plan items 2.3 + 1.9
  // ride-level): one `details-entity-simple` fetch per enriched attraction
  // (~40–60/park, monthly). Small concurrent window like the dining schedules
  // pass; a failed fetch just leaves the row's description/hero_media null
  // (the upsert coalesces, so previously stored values survive).
  let descOk = 0;
  let descErr = 0;
  const descWindow = 4;
  const descTargets = metaRows.filter((r) => slugByAttractionId.has(r.attractionId));
  for (let i = 0; i < descTargets.length; i += descWindow) {
    await Promise.all(
      descTargets.slice(i, i + descWindow).map(async (row) => {
        try {
          const detail = await fetchEntityDetail(
            slugByAttractionId.get(row.attractionId)!,
            today,
            AbortSignal.timeout(config.fetchTimeoutMs),
          );
          if (detail.description) row.description = detail.description;
          if (detail.heroMedia) row.heroMedia = detail.heroMedia;
          if (detail.description || detail.heroMedia) descOk++;
        } catch {
          descErr++;
        }
      }),
    );
    if (i + descWindow < descTargets.length) await new Promise((res) => setTimeout(res, 200));
  }

  if (overrides.length > 0) await overrideCategories(overrides);
  if (metaRows.length > 0) await upsertAttractionMeta(metaRows);
  const poiRows = [...poiById.values()];
  if (poiRows.length > 0) await upsertParkPoi(poiRows);
  await deactivateStaleParkPoi(park.id, [...poiById.keys()]);
  console.log(
    `[geo] ${park.slug}: ${overrides.length} categories enriched, ${metaRows.length} meta rows ` +
      `(${descOk} descriptions, ${descErr} failed), ${poiRows.length} POIs from Disney finder`,
  );
}

// --- Disney typed-facet enrichment (step 3b, WDW only, resort-wide) --------

interface DisneyAttractionRow {
  id: number;
  parkId: number;
  name: string;
  facilityId: string | null;
  hasCoords: boolean;
}

/** Active WDW attractions with their persisted Disney facility id, if any. */
async function resolveDisneyAttractions(
  parkIds: Array<number>,
): Promise<Array<DisneyAttractionRow>> {
  if (parkIds.length === 0) return [];
  const result = await db.execute<{
    id: string;
    park_id: string;
    name: string;
    facility_id: string | null;
    has_coords: boolean;
  }>(sql`
    SELECT a.id, a.park_id, a.name, e.external_id AS facility_id,
           (a.latitude IS NOT NULL AND a.longitude IS NOT NULL) AS has_coords
    FROM attractions a
    LEFT JOIN external_ids e
      ON e.entity_kind = ${KIND_ATTRACTION} AND e.entity_id = a.id
     AND e.source = ${Source.DISNEY_DIRECT}
    WHERE a.active = true AND a.park_id IN (${sql.join(
      parkIds.map((id) => sql`${id}`),
      sql`, `,
    )})
  `);
  return result.rows.map((r) => ({
    id: Number(r.id),
    parkId: Number(r.park_id),
    name: r.name,
    facilityId: r.facility_id,
    hasCoords: r.has_coords,
  }));
}

/**
 * Write ONLY the columns the typed-facet feed owns. Deliberately not
 * `upsertAttractionMeta`: that one refreshes every field from its own row shape,
 * so reusing it here would blank the images, copy and hero media the per-park
 * sweep and the detail pass had just written.
 */
async function upsertDisneyFacetMeta(
  rows: Array<{
    attractionId: number;
    accessibility: Array<string>;
    tags: Array<string>;
    minHeightIn: number | null;
    maxHeightIn: number | null;
    heightRequirement: string | null;
    imageAlt: string | null;
  }>,
): Promise<void> {
  for (let i = 0; i < rows.length; i += 500) {
    await db
      .insert(attractionMeta)
      .values(rows.slice(i, i + 500).map((r) => ({ ...r, source: Source.DISNEY_DIRECT })))
      .onConflictDoUpdate({
        target: attractionMeta.attractionId,
        set: {
          // Typed slugs beat the prose the marker facets carry, but an entity
          // the feed says nothing about keeps what it had.
          accessibility: sql`case when cardinality(excluded.accessibility) > 0
            then excluded.accessibility else attraction_meta.accessibility end`,
          tags: sql`case when cardinality(excluded.tags) > 0
            then excluded.tags else attraction_meta.tags end`,
          minHeightIn: sql`coalesce(excluded.min_height_in, attraction_meta.min_height_in)`,
          maxHeightIn: sql`coalesce(excluded.max_height_in, attraction_meta.max_height_in)`,
          // The operator's own prose is better copy than our regenerated label,
          // so this only fills a row that never had one.
          heightRequirement: sql`coalesce(attraction_meta.height_requirement,
            excluded.height_requirement)`,
          imageAlt: sql`coalesce(attraction_meta.image_alt, excluded.image_alt)`,
          updatedAt: sql`now()`,
        },
      });
  }
}

/** Fill lat/lng for attractions `/children` never geocoded. */
async function fillMissingAttractionCoords(
  rows: Array<{ id: number; lat: number; lng: number }>,
): Promise<void> {
  for (let i = 0; i < rows.length; i += 500) {
    const values = sql.join(
      rows
        .slice(i, i + 500)
        .map((r) => sql`(${r.id}::bigint, ${r.lat}::double precision, ${r.lng}::double precision)`),
      sql`, `,
    );
    await db.execute(sql`
      UPDATE attractions AS a
      SET latitude = v.lat, longitude = v.lng
      FROM (VALUES ${values}) AS v(id, lat, lng)
      WHERE a.id = v.id AND (a.latitude IS NULL OR a.longitude IS NULL)
    `);
  }
}

/**
 * Attach published performance times to the POI pins that have them. Only rows
 * that already exist are touched — the feed lists entities from the whole
 * resort, most of which are rides or POIs in parks we don't plot.
 */
async function writePoiSchedules(
  rows: Array<{ poiId: string; schedule: Array<ParkPoiShowtime> }>,
  source: number,
): Promise<number> {
  let written = 0;
  for (let i = 0; i < rows.length; i += 500) {
    const values = sql.join(
      rows
        .slice(i, i + 500)
        .map((r) => sql`(${r.poiId}::text, ${JSON.stringify(r.schedule)}::jsonb)`),
      sql`, `,
    );
    const res = await db.execute(sql`
      UPDATE park_poi AS p
      SET schedule = v.schedule, updated_at = now()
      FROM (VALUES ${values}) AS v(poi_id, schedule)
      WHERE p.poi_id = v.poi_id AND p.source = ${source}
    `);
    written += res.rowCount ?? 0;
  }
  return written;
}

/**
 * Step 3b (WDW only): Disney's own typed facet slugs, in ONE destination-wide
 * GET (research/disney-content-parity.md §2). Fills the accessibility strip
 * (published as data here, prose everywhere else), re-types the ride tags off
 * `thrillFactor`/`interests`, takes numeric heights straight from the slug —
 * including the `-or-shorter` maxima the prose has no form for — fills the
 * coordinates `/children` is missing, and attaches today's performance times to
 * the entertainment pins.
 *
 * Runs after the per-park sweep so its typed values win, and after the POI rows
 * it attaches schedules to exist. Lightning Lane and single rider are NOT read
 * here — see `disney-index.ts`.
 */
async function enrichDisneyFacets(parks: Array<ParkRow>, today: string): Promise<void> {
  const list = await fetchDestinationAttractions(today, AbortSignal.timeout(config.fetchTimeoutMs));
  const index = buildDisneyEntityIndex(list);
  const attractions = await resolveDisneyAttractions(parks.map((p) => p.id));

  const metaRows: Array<Parameters<typeof upsertDisneyFacetMeta>[0][number]> = [];
  const coordRows: Array<{ id: number; lat: number; lng: number }> = [];
  let byId = 0;
  let unmatched = 0;
  for (const row of attractions) {
    const entity = resolveDisneyEntity(index, row.facilityId, row.name);
    if (!entity) {
      unmatched++;
      continue;
    }
    if (row.facilityId && index.byFacilityId.has(row.facilityId)) byId++;
    metaRows.push({ attractionId: row.id, ...disneyEntityAttrs(entity, index.labels) });
    if (!row.hasCoords) {
      const point = disneyEntityPoint(entity);
      if (point) coordRows.push({ id: row.id, lat: point.lat, lng: point.lng });
    }
  }

  const scheduleRows: Array<{ poiId: string; schedule: Array<ParkPoiShowtime> }> = [];
  for (const entity of list.results) {
    const poiId = disneyEntityPoiId(entity);
    const schedule = disneyEntityShowtimes(entity);
    if (poiId && schedule) scheduleRows.push({ poiId, schedule });
  }

  if (metaRows.length > 0) await upsertDisneyFacetMeta(metaRows);
  if (coordRows.length > 0) await fillMissingAttractionCoords(coordRows);
  const scheduled = await writePoiSchedules(scheduleRows, Source.DISNEY_DIRECT);
  console.log(
    `[geo] disney facets: ${list.results.length} entities -> ${metaRows.length}/${attractions.length} ` +
      `attractions enriched (${byId} by facility id, ${unmatched} unmatched), ` +
      `${coordRows.length} coordinates filled, ${scheduled} POI schedules`,
  );
}

// --- OpenStreetMap amenities (both operators) ------------------------------

/**
 * In-park amenity pins from OSM, assigned to parks by point-in-polygon against
 * the boundary the same cron just wrote. This is the one layer where we can beat
 * both operators: Disney plots a single representative pin per service per park
 * and Epic Universe publishes no amenities at all, while OSM maps them
 * individually (30 toilets inside Magic Kingdom alone).
 *
 * Written under `Source.OSM`, so the soft-delete stays scoped to OSM rows and a
 * community-mapped pin can never overwrite an operator-published one.
 */
async function ingestOsmAmenities(parks: Array<ParkRow>): Promise<void> {
  const amenities = await fetchOsmAmenities(
    ORLANDO_BBOX,
    AbortSignal.timeout(config.overpassTimeoutMs),
  );
  // A query that comes back empty is an upstream problem, not an empty world —
  // returning here keeps the soft-delete below from wiping every OSM pin we
  // have on the strength of one bad Overpass response.
  if (amenities.length === 0) {
    console.warn("[geo] osm amenities: query returned nothing — leaving existing pins alone");
    return;
  }
  const result = await db.execute<{ id: string; slug: string; boundary: GeoPolygon | null }>(sql`
    SELECT id, slug, boundary FROM parks WHERE active = true AND boundary IS NOT NULL
  `);

  let total = 0;
  for (const park of result.rows) {
    const parkId = Number(park.id);
    if (!parks.some((p) => p.id === parkId) || !park.boundary) continue;
    const inside = amenities.filter((a) => pointInGeometry(a, park.boundary as GeoPolygon));
    const rows = inside.map((a) => ({
      poiId: a.id,
      parkId,
      poiType: a.poiType,
      category: "info" as PoiCategory,
      mapPin: null,
      name: a.name,
      // OSM nodes are anonymous points — the type IS the identity, so there's no
      // generic entity name or operator detail page to link.
      entityName: null,
      entityId: null,
      urlFriendlyId: null,
      latitude: a.lat,
      longitude: a.lng,
      land: null,
      imageUrl: null,
      detailUrl: null,
      source: Source.OSM,
    }));
    if (rows.length > 0) await upsertParkPoi(rows);
    await deactivateStaleParkPoi(
      parkId,
      rows.map((r) => r.poiId),
      Source.OSM,
    );
    total += rows.length;
    console.log(`[geo] ${park.slug}: ${rows.length} OSM amenities`);
  }
  console.log(`[geo] osm amenities: ${amenities.length} fetched, ${total} assigned to parks`);
}

// --- Universal places enrichment (step 4, UOR only) -----------------------

// Our park slug -> the places feed's `venue_id` (the authoritative park key;
// place_id prefixes are unreliable). The tokens are park abbreviations, not the
// slug (Epic Universe is `uor.eu`), so Volcano Bay's `uor.vb` is the expected
// token but unverified against the live feed — if wrong, enrichUniversalPark
// just logs "no Universal venue mapping" and skips (harmless); confirm on the
// next geo run and correct here if needed.
const UNIVERSAL_VENUE_BY_SLUG: Record<string, string> = {
  "universal-studios-florida": "uor.usf",
  "islands-of-adventure": "uor.ioa",
  "epic-universe": "uor.eu",
  "volcano-bay": "uor.vb",
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
  // venue_id -> its Shop / Amenity / Entertainment / Events places (plan item
  // 2.2). In-park venues only get consumed (the per-park enrichment passes its
  // own venue), so CityWalk/hotel entries sit here unused until a park-less
  // home exists.
  shopsByVenue: Map<string, Array<UniversalPlace>>;
  // Every place that becomes a `park_poi` row, pre-typed: Amenity -> services,
  // Entertainment -> the Live layer, Events -> Tours.
  poiPlacesByVenue: Map<
    string,
    Array<{ place: UniversalPlace; poiType: string; category: PoiCategory }>
  >;
}

// places `place_type.type` -> the (poi_type, category) it lands as. NB the
// retail type is "Shop", NOT "Shopping" — the original literal never matched,
// which is why `shop_dim` held zero Universal rows despite 102 shops in the
// feed, and why the map's Shops layer was empty at UOR.
const UNIVERSAL_PLACE_POI: Record<string, { poiType: string; category: PoiCategory }> = {
  Amenity: { poiType: "amenity", category: "info" },
  Entertainment: { poiType: "entertainment", category: "entertainment" },
  Events: { poiType: "events-tours", category: "tour" },
};

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
  const shopsByVenue = new Map<string, Array<UniversalPlace>>();
  const poiPlacesByVenue = new Map<
    string,
    Array<{ place: UniversalPlace; poiType: string; category: PoiCategory }>
  >();
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
    // Shops + POI places land in their own catalogs (plan item 2.2).
    if (place.place_type?.type === "Shop") {
      const list = shopsByVenue.get(venue) ?? [];
      if (!shopsByVenue.has(venue)) shopsByVenue.set(venue, list);
      list.push(place);
    }
    const poiType = UNIVERSAL_PLACE_POI[place.place_type?.type ?? ""];
    if (poiType) {
      const list = poiPlacesByVenue.get(venue) ?? [];
      if (!poiPlacesByVenue.has(venue)) poiPlacesByVenue.set(venue, list);
      list.push({ place, ...poiType });
    }
    const names = byVenueName.get(venue) ?? new Map<string, UniversalPlace>();
    if (!byVenueName.has(venue)) byVenueName.set(venue, names);
    const key = normalizeUniversalName(place.name);
    const existing = names.get(key);
    if (!existing || placeRichness(place) > placeRichness(existing)) names.set(key, place);
  }
  return { byVenueName, landById, parkByVenue, shopsByVenue, poiPlacesByVenue };
}

/**
 * Step 4 (Universal only): match each park attraction to its place (by venue +
 * normalized name) and override `category` from `place_type` + fill
 * `attraction_meta` (images, detail URL, land, tags). Mirrors `enrichDisneyPark`;
 * the places feed is shared across all UOR parks (fetched once), so it's passed
 * in as a prebuilt index.
 *
 * Layered on top: the mobile-services POI feed + the per-ride contentdata pages
 * + `filtersdata` tiles (`content`, resolved through
 * `resolveUniversalRideAttrs`). Those supply everything the places feed drops —
 * numeric heights, Express/single-rider/child-swap/virtual-line, accessibility,
 * fun facts and real image alt text. They're merged into the SAME meta rows
 * rather than upserted separately, because the upsert overwrites the image and
 * tag columns wholesale; two passes would have the second blank the first.
 */
async function enrichUniversalPark(
  park: ParkRow,
  index: PlaceIndex | null,
  content: UniversalContentIndex | null,
): Promise<void> {
  const venue = UNIVERSAL_VENUE_BY_SLUG[park.slug];
  const venueId = UNIVERSAL_VENUE_ID_BY_SLUG[park.slug] ?? null;
  // Either index alone is enough to enrich: the places feed needs Browserless
  // and a guest session, the content feeds need neither, so a run with
  // Browserless unconfigured still lands heights and the typed POI layers.
  const names = venue && index ? index.byVenueName.get(venue) : undefined;
  if (!names && !content) {
    console.warn(`[geo] ${park.slug}: no Universal feed available — skipping enrichment`);
    return;
  }

  // Park-level hero photo from the Park-type place (its `heroImage`).
  const parkPlace = venue && index ? index.parkByVenue.get(venue) : undefined;
  if (parkPlace) {
    const img = universalPlaceImages(parkPlace.images, parkPlace.name);
    if (img.hero) await updateParkImage(park.id, { url: img.hero, alt: img.alt });
  }

  const attractions = await resolveParkAttractions(park.id);
  const overrides: Array<{ id: number; category: MapCategory }> = [];
  const metaRows: Array<typeof attractionMeta.$inferInsert> = [];
  // Join keys the attraction list already covers — Shows/Parades outside this
  // set become the entertainment POI layer instead of being dropped.
  const claimedNames = new Set<string>();
  let heights = 0;
  for (const attraction of attractions) {
    const place = names?.get(normalizeUniversalName(attraction.name));
    const attrs = content ? resolveUniversalRideAttrs(content, venueId, attraction.name) : null;
    if (!place && !attrs?.matched) continue;
    claimedNames.add(rideJoinKey(attraction.name));

    // Places `place_type` leads; the POI feed's `RideTypes` refine what it
    // can't see (a Volcano Bay slide reads as a generic attraction there but
    // carries "Water Thrill" here).
    const cat =
      categoryFromUniversalPlace(place?.place_type?.type, place?.place_type?.categories) ??
      categoryFromUniversalPlace(null, attrs?.tags);
    if (cat) overrides.push({ id: attraction.id, category: cat });

    const images = universalPlaceImages(place?.images, place?.name ?? attraction.name);
    if (attrs?.minHeightIn != null) heights++;
    metaRows.push({
      attractionId: attraction.id,
      // Places artwork stays the primary (it's the same CDN the rest of the UOR
      // surfaces use); the POI/tile images only fill a gap.
      imageThumbUrl: images.thumb ?? attrs?.imageThumbUrl ?? null,
      imageHeroUrl: images.hero ?? attrs?.imageHeroUrl ?? null,
      // Real alt text from the tile feed, which is the only UOR source that has
      // any — `universalPlaceImages` can only echo the venue name.
      imageAlt: attrs?.imageAlt ?? images.alt,
      detailUrl: universalDetailUrl(place?.urls),
      // Prefer the feed's own Land-place name; fall back to the slug label.
      land:
        (place?.land_id ? index?.landById.get(place.land_id) : null) ??
        universalLandLabel(place?.land_id) ??
        attrs?.land ??
        null,
      heightRequirement: attrs?.heightRequirement ?? null,
      minHeightIn: attrs?.minHeightIn ?? null,
      maxHeightIn: attrs?.maxHeightIn ?? null,
      expressPass: attrs?.expressPass ?? null,
      singleRider: attrs?.singleRider ?? null,
      childSwap: attrs?.childSwap ?? null,
      virtualLine: attrs?.virtualLine ?? null,
      accessibility: attrs?.accessibility ?? [],
      funFact: attrs?.funFact ?? null,
      tags: [
        ...new Set([...universalPlaceTags(place?.place_type?.categories), ...(attrs?.tags ?? [])]),
      ],
      // Official copy the feed already carries (plan item 2.3) — prefer the
      // richer long_description.
      description:
        place?.long_description?.trim() ||
        place?.short_description?.trim() ||
        attrs?.description ||
        null,
      source: Source.UNIVERSAL_DIRECT,
    });
  }
  if (overrides.length > 0) await overrideCategories(overrides);
  if (metaRows.length > 0) await upsertAttractionMeta(metaRows);
  console.log(
    `[geo] ${park.slug}: ${heights}/${metaRows.length} attractions have a published height`,
  );

  // Shops + amenity POIs (plan item 2.2) — in-park scope only: this runs per
  // park venue, so CityWalk/hotel places never reach it (park_poi.park_id is
  // NOT NULL; the park-less home is a phase-2 decision recorded in the plan).
  const shopCount = index ? await upsertUniversalShops(park, venue!, index) : 0;
  const poiCount = await upsertUniversalPoi(park, venueId, index, content, claimedNames);

  console.log(
    `[geo] ${park.slug}: ${overrides.length} categories enriched, ${metaRows.length}/${attractions.length} meta rows, ` +
      `${shopCount} shops, ${poiCount} POIs from Universal feeds`,
  );
}

/** First location's lat/lng from a place's geometry; nulls when absent. */
function placeLatLng(place: UniversalPlace): { lat: number | null; lng: number | null } {
  const ll = place.geometry?.locations?.[0]?.lat_lng;
  return { lat: toNum(ll?.lat), lng: toNum(ll?.lng) };
}

/**
 * `Shop` places → `shop_dim` (source UNIVERSAL_DIRECT) — the UOR analog of
 * the WDW shops point-crawl, riding the same places feed the geo cron already
 * fetches. Slug comes from the official detail URL's last path segment; land
 * resolves through the feed's own Land places. Soft-delete is scoped to
 * (source, park_resort_id) so each venue's pass owns only its rows.
 */
async function upsertUniversalShops(
  park: ParkRow,
  venue: string,
  index: PlaceIndex,
): Promise<number> {
  const places = index.shopsByVenue.get(venue) ?? [];
  const rows = places.map((p) => {
    const { lat, lng } = placeLatLng(p);
    const images = universalPlaceImages(p.images, p.name);
    const detailUrl = universalDetailUrl(p.urls);
    return {
      facilityId: p.place_id,
      name: p.name ?? p.place_id,
      urlFriendlyId: detailUrl?.split("/").filter(Boolean).pop() ?? null,
      latitude: lat,
      longitude: lng,
      mapPin: "shop",
      land: (p.land_id ? index?.landById.get(p.land_id) : null) ?? universalLandLabel(p.land_id),
      landId: p.land_id ?? null,
      parkResort: park.name,
      parkResortId: venue,
      imageUrl: images.hero,
      detailUrl,
      merchandise: p.place_type?.categories ?? [],
      description: p.long_description?.trim() || p.short_description?.trim() || null,
      source: Source.UNIVERSAL_DIRECT,
      active: true,
    };
  });
  for (let i = 0; i < rows.length; i += 500) {
    await db
      .insert(shopDim)
      .values(rows.slice(i, i + 500))
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
          description: sql`coalesce(excluded.description, shop_dim.description)`,
          active: sql`true`,
          lastSeenAt: sql`now()`,
          updatedAt: sql`now()`,
        },
      });
  }
  const seen = rows.map((r) => r.facilityId);
  const notSeen =
    seen.length > 0
      ? sql`AND facility_id NOT IN (${sql.join(
          seen.map((id) => sql`${id}`),
          sql`, `,
        )})`
      : sql``;
  await db.execute(sql`
    UPDATE shop_dim
    SET active = false, updated_at = now()
    WHERE source = ${Source.UNIVERSAL_DIRECT} AND park_resort_id = ${venue}
      AND active = true ${notSeen}
  `);
  return rows.length;
}

/**
 * UOR `park_poi` rows — the services / entertainment layers, which were the two
 * map layers UOR had nothing to fill.
 *
 * Two sources, merged by `poi_id` (they share the `uor.*` place-id namespace):
 *   • places-feed `Amenity` entries, all untyped `info` — the old behaviour,
 *     kept because it's the only amenity source that reaches Epic Universe
 *     (the mobile feed publishes no EU amenities at all);
 *   • the mobile POI feed's typed buckets, which win on conflict: restrooms,
 *     lockers, ATMs, first aid, lost & found, smoking areas, service-animal
 *     areas and rentals get a real `poi_type` instead of a flat "amenity",
 *     plus the entertainment layer (shows/parades our attraction list doesn't
 *     already carry, nightlife, arcades) and weather shelters.
 *
 * `claimedNames` is the set of attraction join keys this park already plots as
 * rides/shows, so a stage show never appears twice — once as a ride marker and
 * once as an entertainment pin.
 */
async function upsertUniversalPoi(
  park: ParkRow,
  venueId: number | null,
  index: PlaceIndex | null,
  content: UniversalContentIndex | null,
  claimedNames: Set<string>,
): Promise<number> {
  const venue = UNIVERSAL_VENUE_BY_SLUG[park.slug];
  const byId = new Map<string, typeof parkPoi.$inferInsert>();

  for (const { place: p, poiType, category } of index?.poiPlacesByVenue.get(venue) ?? []) {
    const { lat, lng } = placeLatLng(p);
    byId.set(p.place_id, {
      poiId: p.place_id,
      parkId: park.id,
      poiType,
      category,
      mapPin: null,
      name: p.name ?? p.place_id,
      entityName: null,
      entityId: null,
      urlFriendlyId: null,
      latitude: lat,
      longitude: lng,
      land: (p.land_id ? index?.landById.get(p.land_id) : null) ?? universalLandLabel(p.land_id),
      // Amenity artwork is mostly flat icons — mirror the Disney guest-services
      // rule and let the client render the category glyph instead. Real
      // entertainment/event photos are worth showing.
      imageUrl: category === "info" ? null : universalPlaceImages(p.images, p.name).hero,
      detailUrl: universalDetailUrl(p.urls),
      source: Source.UNIVERSAL_DIRECT,
    });
  }

  if (content && venueId != null) {
    const typed: Array<TypedUniversalPoi> = [...(content.poisByVenue.get(venueId) ?? [])];
    // Shows and parades the attraction list doesn't already carry become the
    // entertainment layer (street entertainment, character encounters, the
    // shows TP.wiki doesn't list).
    for (const [key, record] of content.ridesByVenue.get(venueId) ?? []) {
      if (claimedNames.has(key)) continue;
      const isShow = record.Category === "Shows" || record.Category === "Parades";
      if (!isShow) continue;
      const meetAndGreet =
        (record as { ShowTypes?: Array<string> }).ShowTypes?.includes("Character") ||
        /^meet\b/i.test(record.MblDisplayName ?? "");
      typed.push({
        poi: record,
        poiType: record.Category === "Parades" ? "parade" : meetAndGreet ? "character" : "show",
        category: meetAndGreet ? "character" : "entertainment",
      });
    }

    for (const { poi, poiType, category } of typed) {
      // Not every record carries a place id (Volcano Bay rides and the arcade
      // entries publish none), so the numeric `Id` is the stable fallback key.
      const poiId =
        poi.ExternalIds?.PlaceId?.trim() || (poi.Id != null ? `uor.poi.${poi.Id}` : null);
      if (!poiId) continue;
      byId.set(poiId, {
        poiId,
        parkId: park.id,
        poiType,
        category,
        mapPin: null,
        name: poi.MblDisplayName ?? poiId,
        entityName: null,
        entityId: poi.Id != null ? String(poi.Id) : null,
        urlFriendlyId: null,
        latitude: poi.Latitude ?? null,
        longitude: poi.Longitude ?? null,
        land: poi.LandId != null ? (content.landById.get(poi.LandId) ?? null) : null,
        // Services keep the glyph (their artwork is flat icons); real
        // entertainment gets its photo, like the Disney POI rule.
        imageUrl: category === "info" ? null : (poi.ListImage ?? poi.ThumbnailImage ?? null),
        detailUrl: poi.SiteUrl ?? null,
        schedule: universalShowtimes(poi),
        source: Source.UNIVERSAL_DIRECT,
      });
    }
  }

  const rows = [...byId.values()];
  if (rows.length > 0) await upsertParkPoi(rows);
  await deactivateStaleParkPoi(
    park.id,
    rows.map((r) => r.poiId),
    Source.UNIVERSAL_DIRECT,
  );
  return rows.length;
}

// --- Universal venue geometry (mobile /api/Venues) ------------------------

/**
 * Step 0b (Universal only): a LAST-RESORT park outline from `GpsBoundary`, for
 * a UOR park that has no boundary at all.
 *
 * It is not an upgrade over OSM and must never overwrite one. Universal
 * publishes a coarse containing hull — 4–9 vertices per park — where the OSM
 * `tourism=theme_park` way traces the real perimeter in 100–350 points. Writing
 * the hull over OSM (which this step originally did) drew a polygon that
 * visibly swallowed roads and parking outside the park. So the only case it
 * earns its keep is a park OSM can't match by name, where a rough outline beats
 * none.
 *
 * Centre, bounds and zoom are deliberately untouched for the same reason: the
 * child-coordinate centroid from `ingestChildren` is derived from where the
 * rides actually are, which frames the park better than a hull's bounding
 * circle, and it keeps UOR consistent with WDW (whose `map_zoom` is null and
 * whose camera fits `lat/lng_min/max`).
 */
async function ingestUniversalVenueGeo(
  venues: UniversalVenues,
  parks: Array<ParkRow>,
): Promise<void> {
  const byId = new Map<number, UniversalVenue>();
  for (const venue of venues.Results) if (venue.Id != null) byId.set(venue.Id, venue);

  // Read the *stored* boundary rather than tracking what OSM matched this run:
  // if the Overpass step failed, the previously-stored outline is still good
  // and a fallback hull would be a downgrade.
  const missing = await db.execute<{ id: string }>(sql`
    SELECT id FROM parks WHERE active = true AND boundary IS NULL
  `);
  const needsOutline = new Set(missing.rows.map((r) => Number(r.id)));
  if (needsOutline.size === 0) return;

  let outlined = 0;
  for (const park of parks) {
    if (!needsOutline.has(park.id)) continue;
    const venue = byId.get(UNIVERSAL_VENUE_ID_BY_SLUG[park.slug] ?? -1);
    const boundary = venue ? venueBoundary(venue) : null;
    if (!boundary) continue;
    await db.execute(
      sql`UPDATE parks SET boundary = ${JSON.stringify(boundary)}::jsonb WHERE id = ${park.id}`,
    );
    console.warn(
      `[geo] ${park.slug}: no OSM outline — fell back to Universal's ${boundary.coordinates[0].length}-point hull`,
    );
    outlined++;
  }
  console.log(`[geo] universal venues: ${outlined} fallback outlines written`);
}

/** Every land across every venue, flattened for the content index's labels. */
function universalLands(venues: UniversalVenues): Array<{ id: number; name: string }> {
  const out: Array<{ id: number; name: string }> = [];
  for (const venue of venues.Results) {
    for (const land of venue.ContainedLands) {
      if (land.Id != null && land.MblDisplayName)
        out.push({ id: land.Id, name: land.MblDisplayName });
    }
  }
  return out;
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
  const universalParks = parks.filter((p) => p.operatorSlug === "universal");
  let universalIndex: PlaceIndex | null = null;
  let universalContent: UniversalContentIndex | null = null;
  let venues: UniversalVenues | null = null;
  if (universalParks.length > 0) {
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

    // The content-parity feeds (universal-content-parity.md §7 items 1–3, 5):
    // three cookieless/keyed GETs plus a serial crawl of the ~61 ride pages.
    // Each is isolated — a rotated mobile credential costs us the typed POI
    // layers, not the run, and the ride pages still cover heights.
    await runStep("universal venues", async () => {
      venues = await fetchUniversalVenues(AbortSignal.timeout(config.fetchTimeoutMs));
    });
    await runStep("universal content", async () => {
      const [pois, tiles, rideFacts] = await Promise.all([
        fetchUniversalPois(AbortSignal.timeout(config.fetchTimeoutMs)).catch((err) => {
          reportServiceError("geo", "universal pois", err);
          return null;
        }),
        fetchUniversalFiltersData()
          .then((data) => data.Tiles.map(tileInfo))
          .catch((err) => {
            reportServiceError("geo", "universal filtersdata", err);
            return [];
          }),
        fetchAllUniversalRideFacts(AbortSignal.timeout(config.fetchTimeoutMs)).catch((err) => {
          reportServiceError("geo", "universal ride pages", err);
          return [];
        }),
      ]);
      universalContent = buildUniversalContentIndex({
        pois,
        tiles,
        rideFacts,
        lands: venues ? universalLands(venues) : [],
      });
      console.log(
        `[geo] universal content: ${pois?.Rides.length ?? 0} rides, ${tiles.length} tiles, ` +
          `${rideFacts.length} ride pages`,
      );
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
    } else if (park.operatorSlug === "universal" && (universalIndex || universalContent)) {
      await runStep(`universal enrich ${park.slug}`, () =>
        enrichUniversalPark(park, universalIndex, universalContent),
      );
    }
  }

  // Disney's typed facets, resort-wide — one GET for all four theme parks and
  // both water parks. Runs AFTER the per-park sweep (its typed slugs supersede
  // the prose the markers carry) and after the POI rows its schedules attach to.
  const disneyParks = parks.filter(
    (p) => p.operatorSlug === "disney" && DISNEY_FINDER_SLUGS.has(p.slug),
  );
  if (disneyParks.length > 0) {
    await runStep("disney facets", () => enrichDisneyFacets(disneyParks, today));
  }

  // Universal's own park outline + centre + zoom, applied LAST: it supersedes
  // both the OSM boundary from step 0 and the child-centroid bounds `ingest
  // Children` derives, and either would otherwise overwrite it.
  if (venues && universalParks.length > 0) {
    await runStep("universal venue geo", () =>
      ingestUniversalVenueGeo(venues as UniversalVenues, universalParks),
    );
  }

  // Community-mapped amenities for BOTH operators — the only services source
  // that maps each restroom/locker/ATM individually, and the only one that
  // reaches Epic Universe at all. Assigned by point-in-polygon, so it runs after
  // every step that can write a `parks.boundary`.
  await runStep("osm amenities", () => ingestOsmAmenities(parks));

  // ThumbHash placeholders for any artwork that's new or changed this run
  // (the meta upsert NULLs the hash when a thumb URL changes). Also serves as
  // the standing backfill — see scripts/backfill-thumbhashes.ts for the
  // one-shot version.
  await runStep("thumbhashes", async () => {
    const { hashed, failed } = await fillMissingThumbhashes();
    console.log(`[geo] thumbhashes: ${hashed} computed, ${failed} failed (left for next run)`);
  });

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
