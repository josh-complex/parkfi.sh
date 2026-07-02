import { disneyHeroUrl } from "../parks/codes.ts";
import { config } from "../parks/config.ts";
import { DisneyMerchandiseListSchema, type DisneyMerchandiseEntity } from "../parks/schemas.ts";
import { UpstreamError } from "../parks/sources/themeparks.ts";

/**
 * WDW shops catalog from the PUBLIC finder explorer
 * (`list-ancestor-entities/wdw/{destinationId}/{date}/shops`) — the retail
 * counterpart to `disney-finder-catalog.ts`. Same cookieless GET (no OneID
 * session, no Akamai gate). This is the `shop_dim` catalog feed: one row per
 * `MerchandiseFacility` with its map marker (lat/lng/land), merchandise category
 * facets, hero image, and detail URL. `date` is an ISO `YYYY-MM-DD` the path
 * keys on (irrelevant to the catalog itself).
 */

export interface ShopCatalogRow {
  facilityId: string;
  name: string;
  urlFriendlyId: string | null;
  latitude: number | null;
  longitude: number | null;
  mapPin: string | null;
  land: string | null;
  landId: string | null;
  parkResort: string | null;
  parkResortId: string | null;
  imageUrl: string | null;
  detailUrl: string | null;
  merchandise: Array<string>;
  disneyOwned: boolean;
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
function resolveDetailUrl(entity: DisneyMerchandiseEntity): string | null {
  const href = entity.webLinks?.wdwDetail?.href ?? entity.url ?? null;
  if (!href) return null;
  if (/^https?:\/\//i.test(href)) return href.replace(/^http:/, "https:");
  return `${config.disneyTicketBase}${href.startsWith("/") ? "" : "/"}${href}`;
}

function toRow(entity: DisneyMerchandiseEntity): ShopCatalogRow {
  const thumb = entity.media?.finderStandardThumb?.url ?? null;
  return {
    facilityId: entity.facilityId,
    name: entity.name ?? entity.facilityId,
    // Prefer the explicit slug; fall back to the last path segment of the detail
    // url ("/shops/epcot/gateway-gifts/" -> "gateway-gifts") for the carts/kiosks
    // that omit urlFriendlyId.
    urlFriendlyId: entity.urlFriendlyId ?? entity.url?.split("/").filter(Boolean).pop() ?? null,
    latitude: entity.marker?.lat ?? null,
    longitude: entity.marker?.lng ?? null,
    mapPin: entity.marker?.pin ?? null,
    land: entity.marker?.card?.land ?? null,
    landId: entity.landId?.split(";")[0] ?? null,
    parkResort: entity.locationName ?? null,
    parkResortId: entity.parkIds[0]?.split(";")[0] ?? null,
    imageUrl: disneyHeroUrl(thumb) ?? thumb,
    detailUrl: resolveDetailUrl(entity),
    merchandise: entity.facets?.merchandise ?? [],
    disneyOwned: entity.disneyOwned === "true",
  };
}

export async function fetchDisneyShopsCatalog(
  destinationId: string,
  date: string,
  signal: AbortSignal,
): Promise<Array<ShopCatalogRow>> {
  const url = `${config.disneyFinderBase}/list-ancestor-entities/wdw/${destinationId}/${date}/shops`;
  const payload = DisneyMerchandiseListSchema.parse(await getJson(url, signal));
  // De-dupe on facilityId (a shop can list under multiple ancestors, e.g. the
  // resort-wide "Collectible Medallions" / "Pin Trading" entries).
  const byId = new Map<string, ShopCatalogRow>();
  for (const entity of payload.results) {
    if (!byId.has(entity.facilityId)) byId.set(entity.facilityId, toRow(entity));
  }
  return [...byId.values()];
}
