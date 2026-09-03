/**
 * Universal Orlando ticket catalog + pricing, from the SAP Commerce (OCC)
 * store — the pure half of `sources/universal-occ.ts`: product/variant records
 * in, `product_dim` + `sku_price_obs` rows out. Unit-testable without a fetch.
 *
 * THE SKU. The orderable part number is the store's *variant* code — an opaque
 * 12-digit id (`180110111028` = 1-Day Epic Universe Adult), one per age band.
 * That is what `fetchCalendarDatesWithPriceAndInventory` keys on and what the
 * cart holds, so it is the `sku`. The *product* code carries the dimensions
 * (`DAY_01D_BSE_EPIC_ICE`, `PASS_12M_PRM_2P_FL`, `AO_UEP_01D_UU_USF_IOA_ICE`),
 * decoded by `universalOccDecode` with the variant's `ageCategory`.
 *
 * WHAT THE STORE PUBLISHES (2026-09-03): 52 admission products (21 standard +
 * 21 Florida-resident day tickets, 8 annual passes, Universal Nights), 14
 * Express products (1-day per park, plus 2–5-day multi-park) and 24 extras
 * (HHN tickets and passes, VIP tours, parking, escape rooms, photo package).
 * Day tickets are now DATE-PRICED — the old store sold them at one list price —
 * so UOR admission gets a real calendar for the first time. Annual passes and
 * merchandise carry no calendar (`dateSelectionRequired: false`) and are
 * recorded flat at the list price. There are no unit/capacity counts anywhere
 * in the new store (the old `availableUnits` was capped at 15 anyway), so those
 * columns are null and sell-outs come from `canBeVisited`/`forceSoldOut`.
 *
 * PRICES. The calendar's `pricing[0].amount` is the rounded PER-DAY figure the
 * store paints on the calendar cell ($169 on a 3-day ticket); the exact ticket
 * total is `fullVariantPrice` ($505.99). The total is what we record — it is
 * the price of the SKU, and it is what the old feed recorded for Express.
 */
import type { UniversalOccCalendar, UniversalOccProduct } from "./schemas.ts";
import type { UniversalOccCategory } from "./sources/universal-occ.ts";

export type UniversalOccFamily = "TICKET" | "ANNUAL" | "EXPRESS" | "EVENT" | "EXTRA";

export interface UniversalOccDims {
  family: UniversalOccFamily;
  durationDays: number | null;
  /** Our park codes: USF / UIOA / EPIC / UVB (the store says `IOA`). */
  parkScope: Array<string>;
  parkToPark: boolean;
  ageGroup: "ADULT" | "CHILD" | null;
  residency: "STD" | "FL";
  passTier: "POWER" | "SEASONAL" | "PREFERRED" | "PREMIER" | null;
}

const PARK_TOKEN: Record<string, string> = { USF: "USF", IOA: "UIOA", EPIC: "EPIC", UVB: "UVB" };

/** Universal Nights at Epic Universe — a bare numeric product code in the tickets category. */
const UNIVERSAL_NIGHTS = /^(170190110008|AO_EPIC_NIGHTS(_[A-Z]+)?)$/;

/**
 * Decode a store product code (+ the variant's age band) into `product_dim`
 * dimensions. Token grammar, observed live:
 *   DAY_{01..07}D_{BSE|PTP|1DPP}_{parks…}[_FL][_PM]_{ICE|SAP}   admission
 *   DAY_UNL_PTP_USF_IOA_FL_PM_ICE                            unlimited-days promo
 *   PASS_12M_{PRM|PRF|PWR|SEA}_{2P|3P}[_FL]                   annual passes
 *   AO_UEP_{01..05}D_{01U|UU}_{parks…}[_PLUS|_STANDARD]_{ICE|SAP}  Express
 *   HHN_*                                                    Halloween Horror Nights
 *   AO_*                                                     everything else
 * `parks…` is either explicit park tokens (USF, IOA, EPIC, UVB) or a pool code
 * (2P = USF+IOA, 3P = +EPIC, 4P = +UVB).
 */
export function universalOccDecode(
  productCode: string,
  ageCategory: string | null | undefined,
): UniversalOccDims {
  const tokens = productCode.split(/[-_]/);
  const has = (t: string) => tokens.includes(t);

  const family: UniversalOccFamily = productCode.startsWith("DAY_")
    ? "TICKET"
    : productCode.startsWith("PASS_")
      ? "ANNUAL"
      : productCode.startsWith("AO_UEP_")
        ? "EXPRESS"
        : productCode.startsWith("HHN_") || UNIVERSAL_NIGHTS.test(productCode)
          ? "EVENT"
          : "EXTRA";

  const dur = tokens.find((t) => /^0[1-9]D$/.test(t));
  const durationDays =
    dur && (family === "TICKET" || family === "EXPRESS") ? Number(dur.slice(0, 2)) : null;

  const scope = new Set<string>();
  for (const t of tokens) if (PARK_TOKEN[t]) scope.add(PARK_TOKEN[t]);
  if (has("4P")) ["USF", "UIOA", "EPIC", "UVB"].forEach((p) => scope.add(p));
  else if (has("3P")) ["USF", "UIOA", "EPIC"].forEach((p) => scope.add(p));
  else if (has("2P")) ["USF", "UIOA"].forEach((p) => scope.add(p));
  if (productCode.startsWith("HHN_")) scope.add("USF");
  if (UNIVERSAL_NIGHTS.test(productCode)) scope.add("EPIC");

  const age = (ageCategory ?? "").toUpperCase();

  return {
    family,
    durationDays,
    parkScope: [...scope],
    parkToPark: has("PTP"),
    ageGroup: age === "ADULT" ? "ADULT" : age === "CHILD" ? "CHILD" : null,
    residency: has("FL") ? "FL" : "STD",
    passTier: has("PWR")
      ? "POWER"
      : has("SEA")
        ? "SEASONAL"
        : has("PRF")
          ? "PREFERRED"
          : has("PRM")
            ? "PREMIER"
            : null,
  };
}

/** Strip the store's inline markup (`<br />`, `<sup>®</sup>`) from a display name. */
export function cleanOccName(name: string | null | undefined): string | null {
  const s = (name ?? "")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return s || null;
}

/** One orderable SKU as the cron writes it to `product_dim`. */
export interface UniversalOccSku {
  sku: string;
  productCode: string;
  category: UniversalOccCategory;
  name: string | null;
  dims: UniversalOccDims;
  /** The store's "from" price for this variant, in cents (null if unpublished). */
  listPriceCents: number | null;
  /** Date-selection products get a per-date calendar; the rest are flat. */
  datePriced: boolean;
  purchasable: boolean;
}

function cents(value: number | null | undefined): number | null {
  return value == null || !Number.isFinite(value) ? null : Math.round(value * 100);
}

/**
 * Explode a category's products into SKUs. A product with variants yields one
 * SKU per variant (its own code, age band and from-price); a product without
 * any (Universal Nights) is its own SKU. A product whose only variants are a
 * single "ALL" band takes the PRODUCT's display name — the variant names there
 * are warehouse shorthand ("2PK Express Unlimited").
 */
export function universalOccSkus(
  category: UniversalOccCategory,
  products: Array<UniversalOccProduct>,
): Array<UniversalOccSku> {
  const out: Array<UniversalOccSku> = [];
  for (const p of products) {
    if (!p.code) continue;
    const variants = (p.variantOptions ?? []).filter((v) => v.code);
    const datePriced = p.dateSelectionRequired === true;
    if (variants.length === 0) {
      out.push({
        sku: p.code,
        productCode: p.code,
        category,
        name: cleanOccName(p.name),
        dims: universalOccDecode(p.code, null),
        listPriceCents: cents(p.price?.value),
        datePriced,
        purchasable: p.purchasable !== false,
      });
      continue;
    }
    const preferVariantName = variants.length > 1;
    for (const v of variants) {
      out.push({
        sku: v.code!,
        productCode: p.code,
        category,
        name: preferVariantName
          ? (cleanOccName(v.name) ?? cleanOccName(p.name))
          : (cleanOccName(p.name) ?? cleanOccName(v.name)),
        dims: universalOccDecode(p.code, v.ageCategory),
        listPriceCents: cents(v.startingPrice?.value) ?? cents(p.price?.value),
        datePriced,
        purchasable: v.purchasable !== false && p.purchasable !== false,
      });
    }
  }
  return out;
}

export interface UniversalOccPriceRow {
  sku: string;
  serviceDate: string;
  priceCents: number;
  currency: string;
  available: boolean;
}

/**
 * Calendar response -> per-date price rows, one per (sku, date) inside
 * [fromIso, toIso]. Exact ticket total preferred over the rounded per-day
 * `amount`; a date with no price is skipped. Sold out when the store says the
 * date can't be visited or forces it sold out at either level, or the inventory
 * event is explicitly unavailable.
 */
export function universalOccPriceRows(
  calendar: UniversalOccCalendar,
  fromIso: string,
  toIso: string,
): Array<UniversalOccPriceRow> {
  const out: Array<UniversalOccPriceRow> = [];
  for (const ea of calendar.eventAvailability) {
    if (!ea.partNumber) continue;
    for (const d of ea.calendarDates) {
      if (!d.date || d.date < fromIso || d.date > toIso) continue;
      const price = d.pricing[0];
      const amount = price?.fullVariantPrice ?? price?.amount;
      if (amount == null || !Number.isFinite(amount)) continue;
      const inv = d.inventoryEvents[0];
      const available =
        d.canBeVisited !== false &&
        d.forceSoldOut !== true &&
        inv?.forceSoldOut !== true &&
        inv?.isAvailable !== false;
      out.push({
        sku: ea.partNumber,
        serviceDate: d.date,
        priceCents: Math.round(amount * 100),
        currency: price?.currency ?? "USD",
        available,
      });
    }
  }
  return out;
}
