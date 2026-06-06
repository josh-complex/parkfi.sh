/**
 * Daily gated-feed poll (Railway cron, e.g. "0 8 * * *"). Single-shot: capture
 * the WDW + Universal Orlando ticket/Express feeds, snapshot them, exit. Every
 * feed is isolated — a flaky or blocked upstream logs and is skipped, never
 * fails the run (so one resort going dark doesn't lose the other's data).
 *
 * Feeds (Disney: research/gated-feeds-report.md; Universal: research/universal-ticket-deep-dive.md):
 *   D1     Disney ticket-date availability  -> ticket_availability         (plain HTTPS)
 *   D2     Disney ticket catalog + pricing  -> product_dim + sku_price_obs  (plain HTTPS, cookieless bearer)
 *   U1/U2  Universal ticket + Express        -> product_dim + sku_price_obs  (SKU-keyed, in-browser)
 *
 * Disney's JSON APIs aren't Akamai-sensor-gated, so they run over a plain HTTPS
 * client. Universal is harvested by loading the web-store once in Browserless to
 * mint a guest session, then replaying gettickets + priceAndInventory/v2. If
 * Browserless isn't configured, Universal is skipped and Disney still runs.
 *
 * Run:  bun run cron:tickets
 */
import { config as loadEnv } from "dotenv";
loadEnv({ path: [".env.local", ".env"] });

import { and, eq, sql } from "drizzle-orm";

import { db } from "#/db/index.ts";
import { externalIds, productDim, skuPriceObs, ticketAvailability } from "#/db/schema.ts";
import {
  availabilityToQueueState,
  disneyDecodeSku,
  QueueState,
  Source,
  universalDecodeSku,
  type DisneySkuDims,
} from "#/server/parks/codes.ts";
import {
  fetchAvailabilityCalendar,
  fetchClientToken,
  fetchTicketPricing,
} from "#/server/parks/sources/disney.ts";
import { browserlessConfigured } from "#/server/parks/sources/browserless.ts";
import { fetchUniversalCatalogAndPricing } from "#/server/parks/sources/universal.ts";
import { config } from "#/server/parks/config.ts";

const SEGMENT = "tickets" as const;
const WINDOW_DAYS = Number(process.env.TICKET_WINDOW_DAYS ?? 60);
// How far forward to record Disney per-date pricing (the calendar reaches ~17mo).
const DISNEY_PRICE_WINDOW_DAYS = Number(process.env.DISNEY_PRICE_WINDOW_DAYS ?? 180);
// E2 sweep: product-type slug + add-on variants (verified in the deep dive; the
// FL-resident slug is best-effort and tolerated if it 404s). Residency/park are
// recovered from each row's productInstanceId, so one sweep covers all groups.
const DISNEY_E2: Array<{ slug: string; addOns: Array<string> }> = [
  {
    slug: "theme-parks",
    addOns: ["false", "park-hopper", "park-hopper-plus", "water-parks-sports"],
  },
  { slug: "after-2pm-ticket-offer", addOns: ["false"] },
  { slug: "four-park-magic-ticket-offer", addOns: ["false", "water-parks-sports"] },
  {
    slug: "canada-ticket",
    addOns: ["false", "park-hopper", "park-hopper-plus", "water-parks-sports"],
  },
  {
    slug: "theme-parks-for-fl-resident",
    addOns: ["false", "park-hopper", "park-hopper-plus", "water-parks-sports"],
  },
];

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function roundCents(amount: number): number {
  return Math.round(amount * 100);
}

function roundOrNull(amount: number | null): number | null {
  return amount == null ? null : roundCents(amount);
}

/** External-id (by source) -> internal park id, for a given source. */
async function parkMapForSource(source: number): Promise<Map<string, number>> {
  const rows = await db
    .select({ externalId: externalIds.externalId, entityId: externalIds.entityId })
    .from(externalIds)
    .where(and(eq(externalIds.source, source), eq(externalIds.entityKind, "park")));
  return new Map(rows.map((r) => [r.externalId, r.entityId]));
}

/** Upsert SKU dimension rows (shared by Disney + Universal), refreshing on re-crawl. */
async function upsertProductDims(rows: Array<typeof productDim.$inferInsert>): Promise<void> {
  for (let i = 0; i < rows.length; i += 500) {
    await db
      .insert(productDim)
      .values(rows.slice(i, i + 500))
      .onConflictDoUpdate({
        target: productDim.sku,
        set: {
          resort: sql`excluded.resort`,
          family: sql`excluded.family`,
          durationDays: sql`excluded.duration_days`,
          parkScope: sql`excluded.park_scope`,
          parkToPark: sql`excluded.park_to_park`,
          ageGroup: sql`excluded.age_group`,
          residency: sql`excluded.residency`,
          passTier: sql`excluded.pass_tier`,
          variablePriced: sql`excluded.variable_priced`,
          // keep a known list price/name if a later (priced-only) pass has none
          listPriceCents: sql`coalesce(excluded.list_price_cents, ${productDim.listPriceCents})`,
          name: sql`coalesce(excluded.name, ${productDim.name})`,
          active: sql`true`,
          updatedAt: sql`excluded.updated_at`,
        },
      });
  }
}

/** Insert SKU price observations (shared by Disney + Universal), idempotent on PK. */
async function insertSkuPrices(rows: Array<typeof skuPriceObs.$inferInsert>): Promise<void> {
  for (let i = 0; i < rows.length; i += 500) {
    await db
      .insert(skuPriceObs)
      .values(rows.slice(i, i + 500))
      .onConflictDoNothing();
  }
}

/** Readable display name from a decoded WDW SKU. */
function disneyName(d: DisneySkuDims): string {
  return [
    d.durationDays ? `${d.durationDays}-Day` : null,
    d.ageGroup === "ADULT" ? "Adult" : d.ageGroup === "CHILD" ? "Child" : null,
    d.family.replace(/-/g, " "),
    d.parkToPark ? "Park Hopper" : null,
    d.residency !== "STD" ? `(${d.residency})` : null,
  ]
    .filter(Boolean)
    .join(" ");
}

// --- D1: Disney ticket-date availability ----------------------------------

async function captureDisneyAvailability(
  parkMap: Map<string, number>,
  todayIso: string,
  endIso: string,
  snapshotDate: string,
): Promise<number> {
  const calendar = await fetchAvailabilityCalendar(
    todayIso,
    endIso,
    SEGMENT,
    AbortSignal.timeout(config.fetchTimeoutMs),
  );

  // Disney returns placeholder entries (e.g. `[{}]`) when there are no
  // restrictions to report — `[{}]` means "all parks available", not a block.
  // Keep only entries with a real date+state.
  const usable = calendar.filter(
    (e): e is { date: string; availability: string; parks: Array<string> } =>
      typeof e.date === "string" && typeof e.availability === "string",
  );
  if (usable.length === 0) {
    console.log(
      "[D1] Disney availability: no per-date restrictions (all dates open) — nothing to record",
    );
    return 0;
  }

  const rows: Array<typeof ticketAvailability.$inferInsert> = [];
  for (const entry of usable) {
    const available = new Set(entry.parks);
    for (const [disneyId, parkId] of parkMap) {
      const state = available.has(disneyId)
        ? availabilityToQueueState(entry.availability)
        : QueueState.SOLD_OUT;
      rows.push({
        snapshotDate,
        parkId,
        serviceDate: entry.date,
        segment: SEGMENT,
        state,
        source: Source.DISNEY_DIRECT,
      });
    }
  }

  for (let i = 0; i < rows.length; i += 500) {
    await db
      .insert(ticketAvailability)
      .values(rows.slice(i, i + 500))
      .onConflictDoNothing();
  }
  return rows.length;
}

// --- D2: Disney date-based ticket pricing ---------------------------------

async function captureDisneyPricing(observedAt: Date): Promise<number> {
  const todayIso = isoDate(observedAt);
  const end = new Date(observedAt);
  end.setDate(end.getDate() + DISNEY_PRICE_WINDOW_DAYS);
  const endIso = isoDate(end);

  // One anonymous client token (~20 min TTL) covers the whole sweep.
  const token = await fetchClientToken(AbortSignal.timeout(config.fetchTimeoutMs));

  const dims = new Map<string, typeof productDim.$inferInsert>();
  const rows: Array<typeof skuPriceObs.$inferInsert> = [];

  for (const { slug, addOns } of DISNEY_E2) {
    for (const addOn of addOns) {
      let pricing;
      try {
        pricing = await fetchTicketPricing(
          token.access_token,
          AbortSignal.timeout(config.fetchTimeoutMs),
          slug,
          addOn,
        );
      } catch {
        continue; // unverified slug / flaky upstream — skip this variant
      }
      for (const bucket of pricing.pricingCalendar?.pricingCalendar ?? []) {
        for (const day of bucket.dates) {
          if (day.date < todayIso || day.date > endIso) continue;
          for (const p of day.pricing) {
            if (!p.id) continue; // id = productInstanceId, the SKU/join key
            const amount = Number(p.subtotal ?? p.pricePerDay);
            if (!Number.isFinite(amount)) continue;
            const sku = p.id.replace(/_progenstr/i, "");
            if (!dims.has(sku)) {
              const d = disneyDecodeSku(p.id);
              dims.set(sku, {
                sku,
                resort: "WDW",
                family: d.family,
                durationDays: d.durationDays,
                parkScope: d.parkScope,
                parkToPark: d.parkToPark,
                ageGroup: d.ageGroup,
                residency: d.residency,
                passTier: null,
                variablePriced: true,
                listPriceCents: null,
                name: disneyName(d),
                updatedAt: observedAt,
              });
            }
            rows.push({
              observedAt,
              sku,
              serviceDate: day.date,
              priceCents: roundCents(amount),
              currency: day.currency ?? "USD",
              available: !p.stopSale, // stopSale=true => sold out
              availableUnits: null,
              totalCapacity: null,
              source: Source.DISNEY_DIRECT,
            });
          }
        }
      }
    }
  }

  await upsertProductDims([...dims.values()]);
  await insertSkuPrices(rows);
  console.log(`[D2] Disney: ${dims.size} SKUs`);
  return rows.length;
}

// --- U1/U2: Universal Express + admission pricing -------------------------

async function captureUniversalPricing(todayIso: string, observedAt: Date): Promise<number> {
  const capture = await fetchUniversalCatalogAndPricing(
    AbortSignal.timeout(config.browserlessTimeoutMs),
  );

  function num(v: number | string | null | undefined): number | null {
    if (v == null) return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }

  // (1) product_dim: decode every SKU we have catalog or pricing for.
  const dims = new Map<string, typeof productDim.$inferInsert>();
  const addDim = (
    sku: string,
    listPriceCents: number | null,
    name: string | null,
    variablePriced: boolean,
  ) => {
    if (dims.has(sku)) return;
    const d = universalDecodeSku(sku);
    dims.set(sku, {
      sku,
      resort: "UOR",
      family: d.family,
      durationDays: d.durationDays,
      parkScope: d.parkScope,
      parkToPark: d.parkToPark,
      ageGroup: d.ageGroup,
      residency: d.residency,
      passTier: d.passTier,
      variablePriced,
      listPriceCents,
      name,
      updatedAt: observedAt,
    });
  };
  for (const s of capture.skus) {
    addDim(s.partNumber, roundOrNull(num(s.listPrice)), s.name ?? null, s.variablePriced);
  }
  // Express SKUs (and anything priced but absent from the catalog crawl).
  for (const sku of Object.keys(capture.eventAvailability)) addDim(sku, null, null, true);

  const dimRows = [...dims.values()];
  await upsertProductDims(dimRows);

  // (2) sku_price_obs: per-date demand pricing (day tickets + Express), plus a
  // single flat row today for annual passes (no per-date calendar).
  const rows: Array<typeof skuPriceObs.$inferInsert> = [];
  for (const [sku, byDate] of Object.entries(capture.eventAvailability)) {
    for (const [serviceDate, entry] of Object.entries(byDate)) {
      if (serviceDate < todayIso) continue;
      const price = entry.pricing[0];
      if (price?.amount === undefined) continue;
      const inv = entry.inventoryEvents[0];
      rows.push({
        observedAt,
        sku,
        serviceDate,
        priceCents: roundCents(price.amount),
        currency: price.currency ?? "USD",
        // `available` is the reliable signal; units/capacity are soft (capped).
        available: inv ? inv.available !== "0" : null,
        availableUnits: num(inv?.availableUnits),
        totalCapacity: num(inv?.totalCapacity),
        source: Source.UNIVERSAL_DIRECT,
      });
    }
  }
  const priced = new Set(Object.keys(capture.eventAvailability));
  for (const s of capture.skus) {
    if (s.variablePriced || priced.has(s.partNumber)) continue;
    const amount = num(s.listPrice);
    if (amount == null) continue;
    rows.push({
      observedAt,
      sku: s.partNumber,
      serviceDate: todayIso,
      priceCents: roundCents(amount),
      currency: s.currency ?? "USD",
      available: true,
      availableUnits: null,
      totalCapacity: null,
      source: Source.UNIVERSAL_DIRECT,
    });
  }

  await insertSkuPrices(rows);
  console.log(`[U1/U2] Universal: ${dimRows.length} SKUs in catalog`);
  return rows.length;
}

// --- orchestration --------------------------------------------------------

async function runStep(label: string, fn: () => Promise<number>): Promise<void> {
  try {
    const n = await fn();
    console.log(`[cron-tickets] ${label}: ${n} rows`);
  } catch (err) {
    // Flaky/blocked upstream must not fail the whole run — log and move on.
    console.error(`[cron-tickets] ${label} failed:`, err instanceof Error ? err.message : err);
  }
}

async function main() {
  const today = new Date();
  const end = new Date(today);
  end.setDate(end.getDate() + WINDOW_DAYS);
  const todayIso = isoDate(today);
  const endIso = isoDate(end);
  const snapshotDate = todayIso;
  const observedAt = today;

  const disneyMap = await parkMapForSource(Source.DISNEY_DIRECT);

  if (disneyMap.size === 0) {
    console.warn("[cron-tickets] no disney_direct park mappings — run db:seed first");
  } else {
    await runStep("D1 Disney availability", () =>
      captureDisneyAvailability(disneyMap, todayIso, endIso, snapshotDate),
    );
    await runStep("D2 Disney ticket pricing", () => captureDisneyPricing(observedAt));
  }

  // Universal is SKU-keyed (product_dim + sku_price_obs), not park-mapped.
  if (!browserlessConfigured()) {
    console.warn("[cron-tickets] BROWSERLESS_URL not set — skipping Universal feeds");
  } else {
    await runStep("U1/U2 Universal pricing", () => captureUniversalPricing(todayIso, observedAt));
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
