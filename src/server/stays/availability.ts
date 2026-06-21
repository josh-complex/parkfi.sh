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
import { and, asc, eq, max } from "drizzle-orm";

import { db } from "#/db/index.ts";
import { stayObs, stayQuery } from "#/db/schema.ts";
import { Source } from "#/server/parks/codes.ts";
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

  return sortOffers(offers);
}

/** Cheapest available first, then unavailable resorts by name (display order). */
function sortOffers(offers: Array<ResortOffer>): Array<ResortOffer> {
  return offers.sort((a, b) => {
    if (a.available !== b.available) return a.available ? -1 : 1;
    if (a.available && b.available) return (a.pricePerNight ?? 0) - (b.pricePerNight ?? 0);
    return a.name.localeCompare(b.name);
  });
}

// ---------------------------------------------------------------------------
// Server-side cache (stay_obs) + sweep frontier (stay_query)
// ---------------------------------------------------------------------------

/**
 * Canonical string encoding of the non-date search dims (party mix + accessible
 * + Florida resident, plus a billing ZIP override when it actually changes the
 * price). The read path and the sweep both key on this so a returning user's
 * search collides with the swept generation. Child ages are sorted so order
 * doesn't fork the key (Disney prices the multiset, not the sequence), and the
 * ZIP only participates when `floridaResident` makes it matter.
 */
export function buildPartyKey(params: ResortSearchParams): string {
  const ages = [...params.childAges].sort((a, b) => a - b).join(",");
  const acc = params.accessible ? 1 : 0;
  const fl = params.floridaResident ? 1 : 0;
  const zip = params.floridaResident && params.postalCode ? `|zip${params.postalCode}` : "";
  return `a${params.adults}c${params.children}:${ages}|acc${acc}|fl${fl}${zip}`;
}

/** Build a `ResortOffer` from a catalog id + the observed price/availability. */
function catalogOffer(
  resortId: string,
  fields: { available: boolean; pricePerNight: number | null; reasonCode: string | null },
): ResortOffer | null {
  const entry = RESORT_BY_ID.get(resortId);
  if (!entry) return null; // dropped from the catalog since this obs was written
  return {
    id: resortId,
    name: entry.name,
    slug: entry.slug,
    tier: entry.tier,
    area: entry.area,
    image: entry.image,
    detailUrl: entry.detailUrl,
    pricePerNight: fields.pricePerNight,
    available: fields.available,
    reasonCode: fields.reasonCode,
  };
}

/**
 * Read the freshest cached generation for a (dates, party) tuple. Returns the
 * reconstructed offers when the latest `stay_obs` write is younger than
 * `ttlMs`, else null (miss/stale → caller fetches live). One sweep writes all
 * resorts under a single `observed_at`, so "latest generation" = every row at
 * `max(observed_at)`.
 */
export async function readStayObs(
  params: ResortSearchParams,
  partyKey: string,
  ttlMs: number,
  now: number = Date.now(),
): Promise<Array<ResortOffer> | null> {
  const where = and(
    eq(stayObs.checkIn, params.checkInDate),
    eq(stayObs.checkOut, params.checkOutDate),
    eq(stayObs.partyKey, partyKey),
  );
  const [latest] = await db
    .select({ observedAt: max(stayObs.observedAt) })
    .from(stayObs)
    .where(where);
  const observedAt = latest?.observedAt;
  if (!observedAt) return null;
  if (now - observedAt.getTime() > ttlMs) return null;

  const rows = await db
    .select({
      resortId: stayObs.resortId,
      available: stayObs.available,
      pricePerNight: stayObs.pricePerNight,
      reasonCode: stayObs.reasonCode,
    })
    .from(stayObs)
    .where(and(where, eq(stayObs.observedAt, observedAt)));

  const offers: Array<ResortOffer> = [];
  for (const r of rows) {
    const offer = catalogOffer(r.resortId, {
      available: r.available,
      pricePerNight: r.pricePerNight,
      reasonCode: r.reasonCode,
    });
    if (offer) offers.push(offer);
  }
  return sortOffers(offers);
}

/** Persist one observation generation (~30 resort rows under one timestamp). */
export async function writeStayObs(
  params: ResortSearchParams,
  partyKey: string,
  offers: Array<ResortOffer>,
  observedAt: Date = new Date(),
): Promise<void> {
  if (offers.length === 0) return;
  const rows: Array<typeof stayObs.$inferInsert> = offers.map((o) => ({
    observedAt,
    resortId: o.id,
    checkIn: params.checkInDate,
    checkOut: params.checkOutDate,
    partyKey,
    available: o.available,
    pricePerNight: o.pricePerNight,
    reasonCode: o.reasonCode,
    source: Source.DISNEY_DIRECT,
  }));
  await db.insert(stayObs).values(rows).onConflictDoNothing();
}

/**
 * Record demand for a (dates, party) tuple so the sweeper keeps it warm. Upsert
 * on the dims unique index: bump `last_requested_at` (and refresh the raw dims)
 * without disturbing sweep/alert bookkeeping.
 */
export async function upsertStayQuery(
  params: ResortSearchParams,
  partyKey: string,
  now: Date = new Date(),
): Promise<void> {
  const childAges = [...params.childAges].sort((a, b) => a - b).join(",");
  await db
    .insert(stayQuery)
    .values({
      checkIn: params.checkInDate,
      checkOut: params.checkOutDate,
      partyKey,
      adults: params.adults,
      children: params.children,
      childAges,
      accessible: params.accessible,
      floridaResident: params.floridaResident,
      postalCode: params.postalCode ?? null,
      lastRequestedAt: now,
    })
    .onConflictDoUpdate({
      target: [stayQuery.checkIn, stayQuery.checkOut, stayQuery.partyKey],
      set: {
        lastRequestedAt: now,
        adults: params.adults,
        children: params.children,
        childAges,
        accessible: params.accessible,
        floridaResident: params.floridaResident,
        postalCode: params.postalCode ?? null,
      },
    });
}

export interface StayPricePoint {
  /** Observation time, epoch ms. */
  observedAt: number;
  /** Nightly rate (USD) at this tick, or null when it was unavailable. */
  pricePerNight: number | null;
  available: boolean;
}

/**
 * Every observed price/availability tick for one resort at a fixed (dates,
 * party) tuple, oldest first — the "is now a good time to book?" trend. The
 * filter is a strict prefix of `stay_obs`'s PK
 * (resort_id, check_in, check_out, party_key, observed_at), so this is an
 * index range scan that already returns rows in `observed_at` order.
 */
export async function readStayPriceHistory(
  resortId: string,
  params: ResortSearchParams,
  partyKey: string,
): Promise<Array<StayPricePoint>> {
  const rows = await db
    .select({
      observedAt: stayObs.observedAt,
      pricePerNight: stayObs.pricePerNight,
      available: stayObs.available,
    })
    .from(stayObs)
    .where(
      and(
        eq(stayObs.resortId, resortId),
        eq(stayObs.checkIn, params.checkInDate),
        eq(stayObs.checkOut, params.checkOutDate),
        eq(stayObs.partyKey, partyKey),
      ),
    )
    .orderBy(asc(stayObs.observedAt));
  return rows.map((r) => ({
    observedAt: r.observedAt.getTime(),
    pricePerNight: r.pricePerNight,
    available: r.available,
  }));
}

/** Rebuild the search params from a stored `stay_query` row (for the sweep). */
export function stayQueryToParams(q: typeof stayQuery.$inferSelect): ResortSearchParams {
  return {
    checkInDate: q.checkIn,
    checkOutDate: q.checkOut,
    adults: q.adults,
    children: q.children,
    childAges: q.childAges ? q.childAges.split(",").map(Number).filter(Number.isFinite) : [],
    accessible: q.accessible,
    floridaResident: q.floridaResident,
    postalCode: q.postalCode ?? undefined,
  };
}
