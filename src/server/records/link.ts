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
 *   4. lexicon  (0.40) — land/area keywords → park, for records that name a
 *                        place but no entity.
 *   5. admin    (1.00) — `/admin/filings` override; auto links are never
 *                        rewritten on a record that carries one (ingest.ts).
 *
 * `computeLinks` is pure over an in-memory catalog so it's unit-testable and
 * cheap per record; `loadEntityCatalog` fetches that catalog once per run.
 */
import { and, eq, isNotNull, sql } from "drizzle-orm";

import { db } from "#/db/index.ts";
import { attractions, operators, parks, resorts } from "#/db/schema.ts";
import { pointInPolygon } from "#/server/achievements/geo.ts";

import type { Operator, ParkGeo } from "./types.ts";

export interface CatalogAttraction {
  id: number;
  parkId: number;
  name: string;
  slug: string;
}

export interface EntityCatalog {
  parks: ParkGeo[];
  attractions: CatalogAttraction[];
}

export interface LinkInput {
  title: string;
  description?: string | null;
  linkText?: string[];
  latitude?: number | null;
  longitude?: number | null;
  operator?: Operator | null;
  resortSlug?: string | null;
}

export type LinkMethod = "polygon" | "filer" | "name" | "lexicon" | "admin";

export interface EntityLink {
  entityKind: "park" | "resort" | "attraction";
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
  return {
    parks: parkRows.map((p) => ({
      ...p,
      operator: (p.operator as Operator | null) ?? null,
      boundary: p.boundary ?? null,
    })),
    attractions: attractionRows,
  };
}
