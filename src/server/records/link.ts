/**
 * Entity linking (plan §4.3): which of OUR entities a record concerns.
 *
 * Methods run in order, each appending links with its own confidence:
 *   1. polygon  (0.95) — the record's point inside `parks.boundary`
 *                        (polygon-first, never bbox — see the geofence memory).
 *   2. filer    (0.80) — operator/resort from the curated alias table or the
 *                        adapter's jurisdiction default (a resort-level link).
 *   3. name     (0.70–0.90) — attraction names / known abbreviations found in
 *                        the as-filed text, candidates restricted to the linked
 *                        park (or resort) so "Dragon" can't hit both coasts.
 *                        Venue names (restaurants, shops, map POIs) follow the
 *                        same rule at 0.50–0.70 and emit facility/shop/poi links.
 *   4. lexicon  (0.40) — land/area keywords → park, for records that name a
 *                        place but no entity.
 *   4b. parcel  (0.60) — the permit's parcel id is one we've placed inside a
 *                        park (A9: `PARCEL_PARKS`). Applied after the lexicon so
 *                        explicit text beats an address, and only when no other
 *                        pass named a park.
 *   5. admin    (1.00) — `/admin/filings` override; auto links are never
 *                        rewritten on a record that carries one (ingest.ts).
 *
 * `computeLinks` is pure over an in-memory catalog so it's unit-testable and
 * cheap per record; `loadEntityCatalog` fetches that catalog once per run.
 */
import { and, eq, isNotNull, sql } from "drizzle-orm";

import { db } from "#/db/index.ts";
import {
  attractions,
  externalIds,
  operators,
  parkPoi,
  parks,
  resorts,
  restaurantDim,
  shopDim,
} from "#/db/schema.ts";
import { pointInPolygon } from "#/server/achievements/geo.ts";

import type { Operator, ParkGeo } from "./types.ts";

export interface CatalogAttraction {
  id: number;
  parkId: number;
  name: string;
  slug: string;
}

/** Link kinds a venue row can produce: restaurant_dim → facility, shop_dim → shop, park_poi → poi. */
export type VenueKind = "facility" | "shop" | "poi";

export interface CatalogVenue {
  kind: VenueKind;
  /** restaurant_dim.facility_id / shop_dim.facility_id / park_poi.poi_id */
  id: string;
  /** Null for resort-level venues (CityWalk, Disney Springs, hotels). */
  parkId: number | null;
  resortSlug: string | null;
  name: string;
  /** Route slug where the venue has a page (dining facilityId / shop url_friendly_id). */
  slug: string | null;
}

export interface EntityCatalog {
  parks: ParkGeo[];
  attractions: CatalogAttraction[];
  /** Restaurants, shops and map POIs; optional so older callers/tests still work. */
  venues?: CatalogVenue[];
}

export interface LinkInput {
  title: string;
  description?: string | null;
  linkText?: string[];
  /** As-filed entity names; our attraction name may CONTAIN one of these. */
  entityNames?: string[];
  latitude?: number | null;
  longitude?: number | null;
  /** Assessor parcel id(s) as filed; "A * B" lists several. */
  parcelId?: string | null;
  operator?: Operator | null;
  resortSlug?: string | null;
}

export type LinkMethod = "polygon" | "filer" | "name" | "lexicon" | "parcel" | "admin";

export type LinkEntityKind = "park" | "resort" | "attraction" | VenueKind;

export interface EntityLink {
  entityKind: LinkEntityKind;
  entityId: string;
  method: LinkMethod;
  confidence: number;
}

export interface LinkResult {
  /** Park the record concerns (polygon, else name/lexicon), or null. */
  parkId: number | null;
  /** Park id proven by geometry alone — the only park evidence that can keep an
   *  otherwise-unattributed record (plan §4.2 "never persist … unless"). */
  polygonParkId: number | null;
  operator: Operator | null;
  resortSlug: string | null;
  links: EntityLink[];
}

/**
 * Abbreviations the permits and the fan press use for attractions. Matched as
 * whole words in the as-filed text; the value is a substring of the
 * `attractions.name` it stands for.
 */
export const ATTRACTION_ABBREVIATIONS: ReadonlyArray<[abbr: string, nameFragment: string]> = [
  ["HRRR", "Rip Ride Rockit"],
  ["SDMT", "Seven Dwarfs"],
  ["TRON", "TRON"],
  ["BTMRR", "Big Thunder"],
  ["ROTR", "Rise of the Resistance"],
  ["MMRR", "Runaway Railway"],
  ["FOP", "Flight of Passage"],
  ["JTM", "Journey of Water"],
  ["VELOCICOASTER", "VelociCoaster"],
  ["HAGRID", "Hagrid"],
  ["FORBIDDEN JOURNEY", "Forbidden Journey"],
  ["GRINGOTTS", "Gringotts"],
  ["STARDUST RACERS", "Stardust Racers"],
  ["MONSTERS UNCHAINED", "Monsters Unchained"],
];

/**
 * Land / area / nickname keywords → park slug (or resort only). Whole-word,
 * case-insensitive. Low confidence: a permit that says "Volcano Bay" concerns
 * Volcano Bay, but a permit that says "EPIC" might be an address.
 */
export const LEXICON: ReadonlyArray<{ re: RegExp; parkSlug?: string; resortSlug?: string }> = [
  { re: /\bMAGIC KINGDOM\b|\bMK\b/, parkSlug: "magic-kingdom" },
  { re: /\bEPCOT\b/, parkSlug: "epcot" },
  { re: /\bANIMAL KINGDOM\b|\bDAK\b/, parkSlug: "animal-kingdom" },
  { re: /\bHOLLYWOOD STUDIOS\b|\bDHS\b/, parkSlug: "hollywood-studios" },
  { re: /\bTYPHOON LAGOON\b/, parkSlug: "typhoon-lagoon" },
  { re: /\bBLIZZARD BEACH\b/, parkSlug: "blizzard-beach" },
  { re: /\bDISNEY SPRINGS\b|\bFLAMINGO CROSSINGS\b/, resortSlug: "walt-disney-world" },
  {
    re: /\bUNIVERSAL STUDIOS FLORIDA\b|\bUSF\b|\bDIAGON ALLEY\b/,
    parkSlug: "universal-studios-florida",
  },
  {
    re: /\bISLANDS OF ADVENTURE\b|\bIOA\b|\bHOGSMEADE\b|\bJURASSIC PARK\b/,
    parkSlug: "islands-of-adventure",
  },
  {
    re: /\bEPIC UNIVERSE\b|\bCELESTIAL PARK\b|\bSUPER NINTENDO WORLD\b|\bDARK UNIVERSE\b|\bMINISTRY OF MAGIC\b|\bISLE OF BERK\b/,
    parkSlug: "epic-universe",
  },
  { re: /\bVOLCANO BAY\b/, parkSlug: "volcano-bay" },
  { re: /\bCITYWALK\b|\bCITY WALK\b/, resortSlug: "universal-orlando" },
];

/**
 * A9 — Orange County parcel ids we have placed inside a park. Universal's
 * permits carry a parcel and an address but rarely a park keyword, and only
 * ~3 % are geocoded, so without this map four of five Universal permits have
 * no park. Derived 2026-09-12 from the ledger itself: for each parcel, the
 * park the lexicon pass named on that parcel's own permits (USF parcel: 427
 * USF vs 10 IOA hits; IOA parcel: 180 vs 11; Volcano Bay: 127 vs 2). Parcels
 * that are hotels, CityWalk, garages or offices are deliberately absent — they
 * are resort-level, and a park link there would be wrong, not merely weak.
 *
 * Epic Universe is NOT here: its site is permitted by Orange County, not the
 * City of Orlando, so no City permit carries its parcels (verified against the
 * Socrata feed 2026-09-12 — zero rows name Epic, Stardust Racers, Super
 * Nintendo World or Helios). That is an adapter gap (A4), not a linking gap.
 */
export const PARCEL_PARKS: Readonly<Record<string, string>> = {
  // 1000 Universal Studios Plz / 5900 Universal Blvd / 6552 Vineland Rd — the park.
  "282313883300120": "universal-studios-florida",
  // 5900 Universal Blvd — sound stages SS22–SS25 / "USO north campus", inside the USF fence.
  "282313883300060": "universal-studios-florida",
  // 5900–6100 Universal Blvd — the B2xx buildings.
  "282324898100060": "islands-of-adventure",
  // 6801–6965 Turkey Lake Rd — the water park (and its team-member lot).
  "282324750000010": "volcano-bay",
};

/** Split an as-filed parcel string ("A * B", "A, B") into candidate ids. */
export function parcelIds(raw: string | null | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(/[\s*,;]+/)
    .map((s) => s.trim())
    .filter((s) => /^\d{12,16}$/.test(s));
}

/** Uppercase, punctuation → space, collapsed — the text both sides are matched in. */
function foldText(...parts: Array<string | null | undefined>): string {
  return parts
    .filter((p): p is string => typeof p === "string" && p.length > 0)
    .join(" ")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function wordBoundaryRe(folded: string): RegExp {
  return new RegExp(`(^|\\s)${folded.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\s|$)`);
}

/** Pure: one record's text + point + attribution → its links. */
export function computeLinks(input: LinkInput, catalog: EntityCatalog): LinkResult {
  const links: EntityLink[] = [];
  const bySlug = new Map(catalog.parks.map((p) => [p.slug, p]));
  const byId = new Map(catalog.parks.map((p) => [p.id, p]));

  let parkId: number | null = null;
  let polygonParkId: number | null = null;
  let operator: Operator | null = input.operator ?? null;
  let resortSlug: string | null = input.resortSlug ?? null;

  // 1. Polygon — the only geometry test; bboxes leave 29–70 % park dead zones.
  if (input.latitude != null && input.longitude != null) {
    const point: [number, number] = [input.longitude, input.latitude];
    const hit = catalog.parks.find((p) => p.boundary && pointInPolygon(point, p.boundary));
    if (hit) {
      parkId = polygonParkId = hit.id;
      links.push({
        entityKind: "park",
        entityId: String(hit.id),
        method: "polygon",
        confidence: 0.95,
      });
      operator ??= hit.operator;
      resortSlug ??= hit.resortSlug;
    }
  }

  const text = foldText(input.title, input.description, ...(input.linkText ?? []));

  // 4 (early, so it can scope the name search). Lexicon → park / resort.
  let lexiconPark: ParkGeo | null = null;
  for (const entry of LEXICON) {
    if (!entry.re.test(text)) continue;
    if (entry.parkSlug) {
      const park = bySlug.get(entry.parkSlug);
      if (park && !lexiconPark) lexiconPark = park;
    } else if (entry.resortSlug) {
      resortSlug ??= entry.resortSlug;
    }
  }
  if (lexiconPark && parkId == null) {
    parkId = lexiconPark.id;
    resortSlug ??= lexiconPark.resortSlug;
    operator ??= lexiconPark.operator;
    links.push({
      entityKind: "park",
      entityId: String(lexiconPark.id),
      method: "lexicon",
      confidence: 0.4,
    });
  }

  // 4b. Parcel → park, only when nothing textual or geometric named one.
  if (parkId == null) {
    for (const id of parcelIds(input.parcelId)) {
      const slug = PARCEL_PARKS[id];
      const park = slug ? bySlug.get(slug) : undefined;
      if (!park) continue;
      parkId = park.id;
      resortSlug ??= park.resortSlug;
      operator ??= park.operator;
      links.push({
        entityKind: "park",
        entityId: String(park.id),
        method: "parcel",
        confidence: 0.6,
      });
      break;
    }
  }

  // 3. Names — candidates restricted to the linked park, else the resort's parks.
  const scopeParkIds = new Set<number>(
    parkId != null
      ? [parkId]
      : resortSlug
        ? catalog.parks.filter((p) => p.resortSlug === resortSlug).map((p) => p.id)
        : [],
  );
  const scopedByPark = parkId != null;
  if (scopeParkIds.size > 0 && text.length > 0) {
    const seen = new Set<number>();
    for (const a of catalog.attractions) {
      if (!scopeParkIds.has(a.parkId) || seen.has(a.id)) continue;
      const folded = foldText(a.name);
      // Short/generic names ("Express", "Single Rider") would false-match addresses.
      if (folded.length >= 8 && wordBoundaryRe(folded).test(text)) {
        seen.add(a.id);
        links.push({
          entityKind: "attraction",
          entityId: String(a.id),
          method: "name",
          confidence: scopedByPark ? 0.9 : 0.7,
        });
        continue;
      }
      for (const [abbr, fragment] of ATTRACTION_ABBREVIATIONS) {
        if (
          a.name.toUpperCase().includes(fragment.toUpperCase()) &&
          wordBoundaryRe(foldText(abbr)).test(text)
        ) {
          seen.add(a.id);
          links.push({
            entityKind: "attraction",
            entityId: String(a.id),
            method: "name",
            confidence: scopedByPark ? 0.8 : 0.6,
          });
          break;
        }
      }
    }
    // 3a. Reverse containment for as-filed entity names: an incident report
    // says "Hogwarts Express", our row is "Hogwarts Express – Hogsmeade
    // Station". Whole-word, ≥10 folded chars, same scope as above.
    for (const raw of input.entityNames ?? []) {
      const needle = foldText(raw);
      if (needle.length < 10) continue;
      const re = wordBoundaryRe(needle);
      for (const a of catalog.attractions) {
        if (!scopeParkIds.has(a.parkId) || seen.has(a.id)) continue;
        if (!re.test(foldText(a.name))) continue;
        seen.add(a.id);
        links.push({
          entityKind: "attraction",
          entityId: String(a.id),
          method: "name",
          confidence: scopedByPark ? 0.8 : 0.6,
        });
      }
    }
    // A name hit inside a resort-wide search pins the park when nothing else did.
    if (parkId == null) {
      const first = links.find((l) => l.entityKind === "attraction");
      if (first) {
        const a = catalog.attractions.find((x) => String(x.id) === first.entityId);
        if (a) {
          parkId = a.parkId;
          operator ??= byId.get(a.parkId)?.operator ?? null;
        }
      }
    }
  }

  // 3b. Venues — restaurants, shops, map POIs. In-park venues only when the
  // park is known; otherwise every venue of the resort, including the
  // resort-level ones (CityWalk, Disney Springs, hotels) that never have a park.
  if (catalog.venues && resortSlug && text.length > 0) {
    const seenVenue = new Set<string>();
    for (const v of catalog.venues) {
      if (v.resortSlug !== resortSlug) continue;
      if (parkId != null ? v.parkId != null && v.parkId !== parkId : false) continue;
      const key = `${v.kind}:${v.id}`;
      if (seenVenue.has(key)) continue;
      const folded = foldText(v.name);
      // Stricter than attractions: venue catalogs are full of "Sand Bar",
      // "Atlantic", "The Kitchen"-style names that would false-match street
      // and trade text, so require two words and ten characters.
      if (folded.length < 10 || !folded.includes(" ")) continue;
      if (!wordBoundaryRe(folded).test(text)) continue;
      seenVenue.add(key);
      links.push({
        entityKind: v.kind,
        entityId: v.id,
        method: "name",
        confidence: parkId != null && v.parkId === parkId ? 0.7 : 0.5,
      });
    }
  }

  // 2. Resort-level link from attribution (alias / jurisdiction / polygon).
  if (resortSlug) {
    links.push({ entityKind: "resort", entityId: resortSlug, method: "filer", confidence: 0.8 });
  }

  return { parkId, polygonParkId, operator, resortSlug, links };
}

/**
 * Active parks (with resort/operator slugs + boundary) and the active,
 * enriched attractions of each — the whole catalog the linker matches against.
 * Ghost duplicate attraction rows have a null category, so they're excluded.
 */
export async function loadEntityCatalog(): Promise<EntityCatalog> {
  const parkRows = await db
    .select({
      id: parks.id,
      slug: parks.slug,
      name: parks.name,
      resortSlug: resorts.slug,
      operator: operators.slug,
      latitude: parks.latitude,
      longitude: parks.longitude,
      boundary: parks.boundary,
    })
    .from(parks)
    .leftJoin(resorts, eq(resorts.id, parks.resortId))
    .leftJoin(operators, eq(operators.id, parks.operatorId))
    .where(eq(parks.active, true));
  const attractionRows = await db
    .select({
      id: attractions.id,
      parkId: attractions.parkId,
      name: attractions.name,
      slug: attractions.slug,
    })
    .from(attractions)
    .where(
      and(
        eq(attractions.active, true),
        isNotNull(attractions.category),
        sql`${attractions.entityType} in ('ATTRACTION', 'SHOW')`,
        // Universal's "Single Rider" / character rows are separate active
        // entities whose names contain the real ride's name — they'd double
        // every name hit (see the single-rider-attraction-rows memory).
        sql`${attractions.name} not ilike '%single rider%'`,
      ),
    );
  const parksOut: ParkGeo[] = parkRows.map((p) => ({
    ...p,
    operator: (p.operator as Operator | null) ?? null,
    boundary: p.boundary ?? null,
  }));
  return {
    parks: parksOut,
    attractions: attractionRows,
    venues: await loadVenues(parksOut),
  };
}

/** Universal's own park/area ids as the dining + shop catalogs carry them. */
const UOR_PARK_SLUGS: Readonly<Record<string, string>> = {
  "uor.usf": "universal-studios-florida",
  "uor.ioa": "islands-of-adventure",
  "uor.eu": "epic-universe",
  "uor.vb": "volcano-bay",
};

/**
 * Restaurants (`restaurant_dim`), shops (`shop_dim`) and map POIs (`park_poi`)
 * as link candidates. A venue's park comes from its `park_resort_id`: the
 * Disney finder's park id (joined through `external_ids`, source
 * `disney_direct`) or Universal's `uor.<park>` code; anything else with a
 * known operator prefix (Disney Springs, CityWalk, hotels) is resort-level.
 */
async function loadVenues(parkList: ParkGeo[]): Promise<CatalogVenue[]> {
  const bySlug = new Map(parkList.map((p) => [p.slug, p]));
  const finderIds = await db
    .select({ parkId: externalIds.entityId, externalId: externalIds.externalId })
    .from(externalIds)
    .where(and(eq(externalIds.entityKind, "park"), eq(externalIds.source, 3)));
  const parkByFinderId = new Map(finderIds.map((r) => [r.externalId, r.parkId]));
  const parkById = new Map(parkList.map((p) => [p.id, p]));

  const resolve = (
    parkResortId: string | null,
  ): { parkId: number | null; resortSlug: string | null } => {
    if (!parkResortId) return { parkId: null, resortSlug: null };
    if (parkResortId.startsWith("uor.")) {
      const slug = UOR_PARK_SLUGS[parkResortId];
      const park = slug ? bySlug.get(slug) : undefined;
      return { parkId: park?.id ?? null, resortSlug: "universal-orlando" };
    }
    const parkId = parkByFinderId.get(parkResortId) ?? null;
    const park = parkId != null ? parkById.get(parkId) : undefined;
    return { parkId: park?.id ?? null, resortSlug: park?.resortSlug ?? "walt-disney-world" };
  };

  const [restaurants, shops, pois] = await Promise.all([
    db
      .select({
        id: restaurantDim.facilityId,
        name: restaurantDim.name,
        parkResortId: restaurantDim.parkResortId,
      })
      .from(restaurantDim)
      .where(eq(restaurantDim.active, true)),
    db
      .select({
        id: shopDim.facilityId,
        name: shopDim.name,
        slug: shopDim.urlFriendlyId,
        parkResortId: shopDim.parkResortId,
      })
      .from(shopDim)
      .where(eq(shopDim.active, true)),
    db.select({ id: parkPoi.poiId, name: parkPoi.name, parkId: parkPoi.parkId }).from(parkPoi),
  ]);

  const out: CatalogVenue[] = [];
  for (const r of restaurants) {
    const { parkId, resortSlug } = resolve(r.parkResortId);
    if (!resortSlug) continue;
    out.push({ kind: "facility", id: r.id, parkId, resortSlug, name: r.name, slug: r.id });
  }
  for (const s of shops) {
    const { parkId, resortSlug } = resolve(s.parkResortId);
    if (!resortSlug) continue;
    out.push({ kind: "shop", id: s.id, parkId, resortSlug, name: s.name, slug: s.slug });
  }
  for (const p of pois) {
    const park = parkById.get(p.parkId);
    if (!park?.resortSlug) continue;
    out.push({
      kind: "poi",
      id: p.id,
      parkId: p.parkId,
      resortSlug: park.resortSlug,
      name: p.name,
      slug: null,
    });
  }
  return out;
}
