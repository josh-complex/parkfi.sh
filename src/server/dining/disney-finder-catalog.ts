import {
  disneyDiningBookable,
  disneyDiningCuisine,
  disneyDiningEntityType,
  disneyDiningPriceRange,
  disneyHeroUrl,
} from "../parks/codes.ts";
import { config } from "../parks/config.ts";
import { DisneyDiningListSchema, type DisneyDiningEntity } from "../parks/schemas.ts";
import { UpstreamError } from "../parks/sources/themeparks.ts";

/**
 * WDW dining catalog from the PUBLIC finder explorer
 * (`list-ancestor-entities/wdw/{destinationId}/{date}/dining`). Same cookieless
 * GET as the geo finder (`disney-finder.ts`) — no OneID session, no Akamai gate
 * (which is what broke the old `/dine-res/api/dine/facilities` path). This is the
 * `restaurant_dim` catalog feed: one row per dining facility with location,
 * cuisine/price/booking facets, hero image, and detail URL. `date` is an ISO
 * `YYYY-MM-DD` the path keys on (irrelevant to the catalog itself).
 */

export interface DiningCatalogRow {
  facilityId: string;
  entityType: "restaurant" | "dinner-show" | "dining-event";
  name: string;
  cuisine: string | null;
  experienceType: string | null;
  priceRange: string | null;
  parkResort: string | null;
  parkResortId: string | null;
  bookable: boolean;
  sellableOnline: boolean;
  imageUrl: string | null;
  detailUrl: string | null;
}

async function getJson(url: string, signal: AbortSignal): Promise<unknown> {
  const res = await fetch(url, {
    signal,
    headers: { "user-agent": config.userAgent, accept: "application/json" },
  });
  if (!res.ok) throw new UpstreamError(`GET ${url} -> ${res.status}`, res.status);
  return res.json();
}

/** Resolve a finder detail link (relative or http) to an absolute https URL. */
function resolveDetailUrl(entity: DisneyDiningEntity): string | null {
  const href = entity.webLinks?.wdwDetail?.href ?? entity.url ?? null;
  if (!href) return null;
  if (/^https?:\/\//i.test(href)) return href.replace(/^http:/, "https:");
  return `${config.disneyTicketBase}${href.startsWith("/") ? "" : "/"}${href}`;
}

function toRow(entity: DisneyDiningEntity): DiningCatalogRow {
  const facets = entity.facets ?? {};
  // finderStandardThumb is the 16:9 card image; its url carries the
  // `/resize/mwImage/1/{w}/{h}/75/` segment disneyHeroUrl upsizes to a hero.
  const thumb = entity.media?.finderStandardThumb?.url ?? null;
  return {
    facilityId: entity.facilityId,
    entityType: disneyDiningEntityType(entity.entityType),
    name: entity.name ?? entity.facilityId,
    cuisine: disneyDiningCuisine(facets.cuisine),
    experienceType: entity.facetGroupType ?? null,
    priceRange: disneyDiningPriceRange(entity.facetsLabel, facets.priceRangeDining),
    parkResort: entity.locationName ?? null,
    parkResortId: entity.parkIds[0]?.split(";")[0] ?? null,
    bookable: disneyDiningBookable(facets),
    sellableOnline: (facets.reservationOfferings ?? []).length > 0,
    imageUrl: disneyHeroUrl(thumb) ?? thumb,
    detailUrl: resolveDetailUrl(entity),
  };
}

export async function fetchDisneyDiningCatalog(
  destinationId: string,
  date: string,
  signal: AbortSignal,
): Promise<Array<DiningCatalogRow>> {
  const url = `${config.disneyFinderBase}/list-ancestor-entities/wdw/${destinationId}/${date}/dining`;
  const payload = DisneyDiningListSchema.parse(await getJson(url, signal));
  // De-dupe on facilityId (a facility can list under multiple ancestors).
  const byId = new Map<string, DiningCatalogRow>();
  for (const entity of payload.results) {
    if (!byId.has(entity.facilityId)) byId.set(entity.facilityId, toRow(entity));
  }
  return [...byId.values()];
}
