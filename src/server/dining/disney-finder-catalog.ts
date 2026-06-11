import {
  disneyDiningBookable,
  disneyDiningCuisine,
  disneyDiningEntityType,
  disneyDiningPriceRange,
  disneyHeroUrl,
} from "../parks/codes.ts";
import { config } from "../parks/config.ts";
import {
  DisneyDiningListSchema,
  type DisneyDiningEntity,
  type DisneyDiningLocation,
} from "../parks/schemas.ts";
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
  // Finder slug ("jaleo") — the key for `details-entity-simple/wdw/{slug}/{date}/`
  // (schedule/hours) and the menu/detail web URLs. Distinct from `facilityId`
  // (the numeric id, e.g. "19063652") which keys the dinemenu API.
  urlFriendlyId: string | null;
  cuisine: string | null;
  experienceType: string | null;
  priceRange: string | null;
  parkResort: string | null;
  parkResortId: string | null;
  bookable: boolean;
  sellableOnline: boolean;
  imageUrl: string | null;
  detailUrl: string | null;
  // Map metadata from the finder marker (for plotting venues on a map).
  latitude: number | null;
  longitude: number | null;
  mapPin: string | null; // 'dine' | 'characters' | 'shop'
  land: string | null; // granular in-park area, finer than parkResort
  landId: string | null; // land entity id (joins dining_location)
  maximumPartySize: number | null;
  // Catalog attribute flags (derived from the finder facets).
  walkupWaitList: boolean;
  mobileOrder: boolean;
  characterDining: boolean;
  fineDining: boolean;
  annualPassDiscount: boolean;
  disneyVisaDiscount: boolean;
  tripAdvisorAward: boolean;
  diningPlanQs: boolean;
  diningPlanTs: boolean;
  // Recommendation/taxonomy arrays powering the "Disney Picks" shelves.
  disneyFavorites: Array<string>;
  diningInterests: Array<string>;
  entertainmentType: Array<string>;
  eecCategory: Array<string>;
  // Internal dine-product-svc links (menu/product data per venue).
  productUrls: Array<string>;
}

/** A finder ancestor location (theme park / resort / venue) → `dining_location`. */
export interface DiningLocationRow {
  id: string;
  title: string | null;
  urlFriendlyId: string | null;
  locationType: string | null;
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
  // Catalog attribute facets live in mixed arrays: `dining` carries the
  // "walkupWaitList" tag, `features` carries "mobile-orders", and the
  // service/discount tags sit in `tableService` / `discounts`.
  const dining = facets.dining ?? [];
  const features = facets.features ?? [];
  const tableService = facets.tableService ?? [];
  const discounts = facets.discounts ?? [];
  const diningPlan = facets.diningPlan ?? [];
  // maximumPartySize is a string in the feed ("50"); keep null when unparseable.
  const partySize = Number.parseInt(entity.maximumPartySize ?? "", 10);
  return {
    facilityId: entity.facilityId,
    entityType: disneyDiningEntityType(entity.entityType),
    name: entity.name ?? entity.facilityId,
    // Prefer the explicit slug; fall back to the last path segment of the
    // detail url ("/dining/disney-springs/jaleo/" -> "jaleo") for the ~2 venues
    // that omit urlFriendlyId.
    urlFriendlyId: entity.urlFriendlyId ?? entity.url?.split("/").filter(Boolean).pop() ?? null,
    cuisine: disneyDiningCuisine(facets.cuisine),
    experienceType: entity.facetGroupType ?? null,
    priceRange: disneyDiningPriceRange(entity.facetsLabel, facets.priceRangeDining),
    parkResort: entity.locationName ?? null,
    parkResortId: entity.parkIds[0]?.split(";")[0] ?? null,
    bookable: disneyDiningBookable(facets),
    sellableOnline: (facets.reservationOfferings ?? []).length > 0,
    imageUrl: disneyHeroUrl(thumb) ?? thumb,
    detailUrl: resolveDetailUrl(entity),
    latitude: entity.marker?.lat ?? null,
    longitude: entity.marker?.lng ?? null,
    mapPin: entity.marker?.pin ?? null,
    land: entity.marker?.card?.land ?? null,
    landId: entity.landId?.split(";")[0] ?? null,
    maximumPartySize: Number.isFinite(partySize) ? partySize : null,
    walkupWaitList: dining.includes("walkupWaitList"),
    mobileOrder: features.includes("mobile-orders"),
    characterDining: tableService.includes("character-dining"),
    fineDining: tableService.includes("fine-signature-dining"),
    annualPassDiscount: (facets.annualPass ?? []).length > 0,
    disneyVisaDiscount: discounts.some((d) => d.startsWith("disney-visa")),
    tripAdvisorAward: (facets.restaurantAttributes ?? []).includes("trip-advisor-excellence-award"),
    diningPlanQs: diningPlan.some((p) => p.includes("quick-service-meal")),
    diningPlanTs: diningPlan.some((p) => p.includes("table-service-meal")),
    disneyFavorites: facets.disneyFavorites ?? [],
    diningInterests: facets.diningInterests ?? [],
    entertainmentType: facets.entertainmentType ?? [],
    eecCategory: facets["eec-category"] ?? [],
    productUrls: entity.productUrls ?? [],
  };
}

function toLocationRow(loc: DisneyDiningLocation): DiningLocationRow {
  return {
    id: loc.id,
    title: loc.title ?? null,
    urlFriendlyId: loc.urlFriendlyId ?? null,
    locationType: loc.locationType ?? null,
  };
}

export interface DiningCatalog {
  rows: Array<DiningCatalogRow>;
  locations: Array<DiningLocationRow>;
}

export async function fetchDisneyDiningCatalog(
  destinationId: string,
  date: string,
  signal: AbortSignal,
): Promise<DiningCatalog> {
  const url = `${config.disneyFinderBase}/list-ancestor-entities/wdw/${destinationId}/${date}/dining`;
  const payload = DisneyDiningListSchema.parse(await getJson(url, signal));
  // De-dupe on facilityId (a facility can list under multiple ancestors).
  const byId = new Map<string, DiningCatalogRow>();
  for (const entity of payload.results) {
    if (!byId.has(entity.facilityId)) byId.set(entity.facilityId, toRow(entity));
  }
  const locById = new Map<string, DiningLocationRow>();
  for (const loc of payload.locations) {
    if (!locById.has(loc.id)) locById.set(loc.id, toLocationRow(loc));
  }
  return { rows: [...byId.values()], locations: [...locById.values()] };
}
