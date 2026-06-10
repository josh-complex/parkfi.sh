/**
 * Walt Disney World resort availability — a thin proxy over Disney's PUBLIC
 * resort-availability API. The endpoint is cookieless and bearer-free (only an
 * `accept-language` header is required), so there's no ingestion service: we
 * call it on demand from a tRPC procedure and join the numeric resort IDs it
 * returns against the static `RESORT_CATALOG` (names/images/tier/area).
 *
 * Calling it server-side (rather than from the browser) sidesteps CORS and lets
 * us keep the `personalizationId` and Florida-resident postal trick in one place.
 */
import { config } from "../parks/config.ts";
import { RESORT_BY_ID, type ResortTier } from "./resort-catalog.generated.ts";

const RESORT_AVAILABILITY_URL =
  process.env.DISNEY_RESORTS_BASE ??
  "https://disneyworld.disney.go.com/wdpr-resorts-list-api/api/v1/resort-availability";

/** A stable anonymous personalization id (Disney requires the field present). */
const PERSONALIZATION_ID = "6deb8ea6-0081-44ad-96ee-e8bfd0959bc6";

/**
 * Disney attributes the Florida-resident discount tier off the billing postal
 * code, so passing an in-state ZIP surfaces those rates. Default omits it.
 */
const FLORIDA_POSTAL_CODE = "32830"; // Lake Buena Vista, FL (WDW)

export interface ResortSearchParams {
  checkInDate: string; // YYYY-MM-DD
  checkOutDate: string; // YYYY-MM-DD
  adults: number;
  children: number;
  childAges: Array<number>;
  accessible: boolean;
  floridaResident: boolean;
  /** Optional FL billing ZIP override; falls back to a default WDW-area code. */
  postalCode?: string;
}

export interface ResortOffer {
  id: string;
  name: string;
  slug: string;
  tier: ResortTier;
  area: string | null;
  image: string | null;
  detailUrl: string;
  /** Average price per night (USD) when bookable, else null. */
  pricePerNight: number | null;
  available: boolean;
  /** Disney's reason code when unavailable (e.g. sold out), else null. */
  reasonCode: string | null;
}

interface DisneyResortNode {
  displaySequence?: number;
  offers?: {
    annual?: {
      displayPrice?: { basePrice?: { subtotal?: number } };
    };
  };
  reasonsUnavailable?: Array<{ reasonCode?: string }>;
}

interface DisneyResortResponse {
  resorts?: Record<string, DisneyResortNode>;
}

/** Build the resort-availability request body from search params. */
export function buildRequestBody(params: ResortSearchParams): Record<string, unknown> {
  return {
    storeId: "wdw",
    checkInDate: params.checkInDate,
    checkOutDate: params.checkOutDate,
    partyMix: {
      adultCount: params.adults,
      childCount: params.children,
      nonAdultAges: params.childAges,
    },
    accessible: params.accessible,
    region: "us",
    resortGroup: "CORE",
    affiliations: ["STD_GST"],
    marketingOfferId: "room-only",
    personalizationId: PERSONALIZATION_ID,
    ...(params.floridaResident ? { postalCode: params.postalCode || FLORIDA_POSTAL_CODE } : {}),
  };
}

/**
 * Fetch resort availability for a stay and join it to the catalog. Returns one
 * entry per known catalog resort (unknown IDs are skipped), sorted cheapest
 * available first, then unavailable resorts by display order.
 */
export async function fetchResortAvailability(
  params: ResortSearchParams,
  signal: AbortSignal,
): Promise<Array<ResortOffer>> {
  const res = await fetch(RESORT_AVAILABILITY_URL, {
    method: "POST",
    signal,
    headers: {
      "accept-language": "en-us",
      "content-type": "application/json",
      accept: "application/json",
      "user-agent": config.userAgent,
    },
    body: JSON.stringify(buildRequestBody(params)),
  });
  if (!res.ok) {
    throw new Error(`resort-availability -> ${res.status} ${res.statusText}`);
  }
  const data = (await res.json()) as DisneyResortResponse;
  const resorts = data.resorts ?? {};

  const offers: Array<ResortOffer> = [];
  for (const [id, node] of Object.entries(resorts)) {
    const entry = RESORT_BY_ID.get(id);
    if (!entry) continue; // Swan/Dolphin & any feed drift — no catalog row.
    const subtotal = node.offers?.annual?.displayPrice?.basePrice?.subtotal;
    const available = subtotal != null;
    offers.push({
      id,
      name: entry.name,
      slug: entry.slug,
      tier: entry.tier,
      area: entry.area,
      image: entry.image,
      detailUrl: entry.detailUrl,
      pricePerNight: available ? Math.round(subtotal) : null,
      available,
      reasonCode: node.reasonsUnavailable?.[0]?.reasonCode ?? null,
    });
  }

  offers.sort((a, b) => {
    if (a.available !== b.available) return a.available ? -1 : 1;
    if (a.available && b.available) return (a.pricePerNight ?? 0) - (b.pricePerNight ?? 0);
    return a.name.localeCompare(b.name);
  });
  return offers;
}
