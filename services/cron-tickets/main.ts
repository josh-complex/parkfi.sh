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

// Imported after loadEnv so the module-level PostHog client sees POSTHOG_KEY.
import { flushTelemetry, reportServiceError } from "../shared/telemetry.ts";

import { and, eq, sql } from "drizzle-orm";

import { db } from "#/db/index.ts";
import {
  externalIds,
  parkSchedule,
  productDim,
  productPriceObs,
  skuPriceObs,
  ticketAvailability,
} from "#/db/schema.ts";
import {
  availabilityToQueueState,
  disneyDecodeSku,
  parseDisneyWaterParkTickets,
  QueueState,
  Source,
  themeparksScheduleProduct,
  universalDecodeSku,
  WDW_WATER_PARK_BLOCKOUT_FAMILY,
  WDW_WATER_PARK_FAMILY,
  type DisneySkuDims,
  type WaterParkTierPrice,
} from "#/server/parks/codes.ts";
import { WDW_WATER_PARK_CODES } from "#/lib/parks.ts";
import {
  fetchAvailabilityCalendar,
  fetchClientToken,
  fetchProductListing,
  fetchTicketPricing,
  fetchWaterParkTicketsPage,
} from "#/server/parks/sources/disney.ts";
import { browserlessConfigured } from "#/server/parks/sources/browserless.ts";
import { fetchSchedule } from "#/server/parks/sources/themeparks.ts";
import { fetchUniversalCatalogAndPricing } from "#/server/parks/sources/universal.ts";
import { config } from "#/server/parks/config.ts";

const SEGMENT = "tickets" as const;
const WINDOW_DAYS = Number(process.env.TICKET_WINDOW_DAYS ?? 60);
// How far forward to record Disney per-date pricing (the calendar reaches ~17mo).
const DISNEY_PRICE_WINDOW_DAYS = Number(process.env.DISNEY_PRICE_WINDOW_DAYS ?? 180);

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

/**
 * Insert SKU price observations, skipping rows where price and availability are
 * unchanged from the most recent observation for that (sku, service_date) pair.
 * Returns the number of rows actually inserted.
 */
async function insertSkuPrices(rows: Array<typeof skuPriceObs.$inferInsert>): Promise<number> {
  if (rows.length === 0) return 0;

  // Deduplicate by (sku, serviceDate) within the batch — last entry wins.
  const deduped = new Map<string, typeof skuPriceObs.$inferInsert>();
  for (const row of rows) deduped.set(`${row.sku}::${row.serviceDate}`, row);
  const batch = [...deduped.values()];

  // Fetch the most recent observation for each (sku, service_date) pair.
  type LatestRow = {
    priceCents: number | null;
    available: boolean | null;
    availableUnits: number | null;
    totalCapacity: number | null;
  };
  const latestMap = new Map<string, LatestRow>();
  const CHUNK = 500;

  for (let i = 0; i < batch.length; i += CHUNK) {
    const chunk = batch.slice(i, i + CHUNK);
    const pairList = sql.join(
      chunk.map((r) => sql`(${r.sku}, ${r.serviceDate as string}::date)`),
      sql`, `,
    );
    const result = await db.execute<{
      sku: string;
      service_date: string;
      price_cents: number | null;
      available: boolean | null;
      available_units: number | null;
      total_capacity: number | null;
    }>(sql`
      SELECT DISTINCT ON (sku, service_date)
        sku, service_date, price_cents, available, available_units, total_capacity
      FROM sku_price_obs
      WHERE (sku, service_date) IN (${pairList})
      ORDER BY sku, service_date, observed_at DESC
    `);
    for (const r of result.rows) {
      latestMap.set(`${r.sku}::${r.service_date}`, {
        priceCents: r.price_cents,
        available: r.available,
        availableUnits: r.available_units,
        totalCapacity: r.total_capacity,
      });
    }
  }

  // Only insert rows where price or availability changed.
  const changed = batch.filter((row) => {
    const prev = latestMap.get(`${row.sku}::${row.serviceDate}`);
    if (!prev) return true;
    return (
      prev.priceCents !== row.priceCents ||
      prev.available !== row.available ||
      prev.availableUnits !== row.availableUnits ||
      prev.totalCapacity !== row.totalCapacity
    );
  });

  for (let i = 0; i < changed.length; i += CHUNK) {
    await db
      .insert(skuPriceObs)
      .values(changed.slice(i, i + CHUNK))
      .onConflictDoNothing();
  }

  return changed.length;
}

/**
 * Insert park-date bundle price observations (LL Multi / Premier), skipping rows
 * unchanged in price+state from the latest observation for that
 * (park, product, service_date, tier). Mirrors `insertSkuPrices`. Returns the
 * number of rows actually inserted.
 */
async function insertProductPrices(
  rows: Array<typeof productPriceObs.$inferInsert>,
): Promise<number> {
  if (rows.length === 0) return 0;

  // Deduplicate within the batch on the natural key — last entry wins.
  const deduped = new Map<string, typeof productPriceObs.$inferInsert>();
  for (const row of rows) {
    deduped.set(`${row.parkId}::${row.productId}::${row.serviceDate}::${row.tier}`, row);
  }
  const batch = [...deduped.values()];

  type LatestRow = { priceCents: number | null; state: number | null };
  const latestMap = new Map<string, LatestRow>();
  const CHUNK = 500;

  for (let i = 0; i < batch.length; i += CHUNK) {
    const chunk = batch.slice(i, i + CHUNK);
    const tuples = sql.join(
      chunk.map(
        (r) =>
          sql`(${r.parkId}, ${r.productId}, ${r.serviceDate as string}::date, ${r.tier as string})`,
      ),
      sql`, `,
    );
    const result = await db.execute<{
      park_id: string;
      product_id: number;
      service_date: string;
      tier: string;
      price_cents: number | null;
      state: number | null;
    }>(sql`
      SELECT DISTINCT ON (park_id, product_id, service_date, tier)
        park_id, product_id, service_date, tier, price_cents, state
      FROM product_price_obs
      WHERE (park_id, product_id, service_date, tier) IN (${tuples})
      ORDER BY park_id, product_id, service_date, tier, observed_at DESC
    `);
    for (const r of result.rows) {
      latestMap.set(`${r.park_id}::${r.product_id}::${r.service_date}::${r.tier}`, {
        priceCents: r.price_cents,
        state: r.state,
      });
    }
  }

  const changed = batch.filter((row) => {
    const prev = latestMap.get(`${row.parkId}::${row.productId}::${row.serviceDate}::${row.tier}`);
    if (!prev) return true;
    return prev.priceCents !== row.priceCents || prev.state !== (row.state ?? null);
  });

  for (let i = 0; i < changed.length; i += CHUNK) {
    await db
      .insert(productPriceObs)
      .values(changed.slice(i, i + CHUNK))
      .onConflictDoNothing();
  }

  return changed.length;
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

  function recordDim(
    instanceId: string,
    sku: string,
    opts: { variablePriced: boolean; listPriceCents: number | null; name: string | null },
  ): void {
    if (dims.has(sku)) return;
    const d = disneyDecodeSku(instanceId);
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
      variablePriced: opts.variablePriced,
      listPriceCents: opts.listPriceCents,
      name: opts.name ?? disneyName(d),
      updatedAt: observedAt,
    });
  }

  // E1 catalog drives the whole sweep: each product key IS the E2 slug, and
  // `isVariablePricing` says whether a demand calendar exists. This auto-adapts
  // to seasonal offers (e.g. FL summer) and — critically — keys E2 off the slug,
  // since the `addOn` query param is ignored (the tier lives in the slug).
  const listing = await fetchProductListing(
    token.access_token,
    AbortSignal.timeout(config.fetchTimeoutMs),
  );
  const products = new Map<string, { variable: boolean; name: string | null }>();
  for (const group of Object.values(listing.discountGroups)) {
    for (const [key, product] of Object.entries(group.products)) {
      // Same key can appear under multiple groups; first writer wins (identical).
      if (!products.has(key)) {
        products.set(key, {
          variable: product.isVariablePricing !== false,
          name: product.names?.text ?? null,
        });
      }
    }
  }

  let flat = 0;
  for (const [slug, { variable, name }] of products) {
    if (variable) {
      // Demand-priced → pull the per-date E2 calendar.
      let pricing;
      try {
        pricing = await fetchTicketPricing(
          token.access_token,
          AbortSignal.timeout(config.fetchTimeoutMs),
          slug,
        );
      } catch {
        continue; // flaky upstream / retired offer — skip, don't fail the run
      }
      for (const bucket of pricing.pricingCalendar?.pricingCalendar ?? []) {
        for (const day of bucket.dates) {
          if (day.date < todayIso || day.date > endIso) continue;
          for (const p of day.pricing) {
            if (!p.id) continue; // id = productInstanceId, the SKU/join key
            const amount = Number(p.subtotal ?? p.pricePerDay);
            if (!Number.isFinite(amount)) continue;
            const sku = p.id.replace(/_progenstr/i, "");
            recordDim(p.id, sku, { variablePriced: true, listPriceCents: null, name });
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
    } else {
      // Flat offer (e.g. FL summer ticket): no E2 calendar — the price is the
      // per-day-count `startingFromPrice` in E1. Record one row at today.
      const listingProduct = Object.values(listing.discountGroups)
        .map((g) => g.products[slug])
        .find(Boolean);
      const days = [
        ...(listingProduct?.ticketDays?.adult ?? []),
        ...(listingProduct?.ticketDays?.child ?? []),
      ];
      for (const entry of days) {
        const amount = Number(entry.startingFromPrice?.subtotal);
        if (!Number.isFinite(amount)) continue;
        const sku = entry.productInstanceId.replace(/_progenstr/i, "");
        recordDim(entry.productInstanceId, sku, {
          variablePriced: false,
          listPriceCents: roundCents(amount),
          name,
        });
        rows.push({
          observedAt,
          sku,
          serviceDate: todayIso,
          priceCents: roundCents(amount),
          currency: entry.startingFromPrice?.currency ?? "USD",
          available: true,
          availableUnits: null,
          totalCapacity: null,
          source: Source.DISNEY_DIRECT,
        });
        flat++;
      }
    }
  }

  await upsertProductDims([...dims.values()]);
  const inserted = await insertSkuPrices(rows);
  console.log(
    `[D2] Disney: ${products.size} products → ${dims.size} SKUs (${flat} flat-priced rows), ${inserted}/${rows.length} price obs inserted`,
  );
  return inserted;
}

// --- D3: Disney water-park pricing (flat, scraped from the tickets page) ---

/**
 * Water-park admission isn't in the demand-priced ticket feed — it's two flat
 * prices hardcoded on the /tickets/water-parks/ marketing page. We model each
 * tier as a `product_dim.family` valid at "whichever water park is open"
 * (park_scope covers both), then stamp a flat per-date row across the pricing
 * window so the calendar/shelf render a normal price series. The blockout tier
 * records NO rows inside its blocked ranges, so the calendar's min-per-date
 * naturally falls back to the full price on those dates.
 */
async function captureDisneyWaterParks(observedAt: Date): Promise<number> {
  const html = await fetchWaterParkTicketsPage(AbortSignal.timeout(config.fetchTimeoutMs));
  const parsed = parseDisneyWaterParkTickets(html);
  if (!parsed.regular && !parsed.blockout) {
    console.warn("[D3] water-park page had no parseable prices — skipping");
    return 0;
  }

  const parkScope = [...WDW_WATER_PARK_CODES];
  const dims = new Map<string, typeof productDim.$inferInsert>();
  const rows: Array<typeof skuPriceObs.$inferInsert> = [];

  const isBlocked = (iso: string): boolean =>
    parsed.blockoutRanges.some((r) => iso >= r.start && iso <= r.end);

  const addTier = (
    family: string,
    displayName: string,
    price: WaterParkTierPrice | null,
    blockedByDate: boolean,
  ): void => {
    if (!price) return;
    for (const [ageGroup, cents] of [
      ["ADULT", price.adultCents],
      ["CHILD", price.childCents],
    ] as const) {
      const sku = `wdw-${family}-1d-${ageGroup.toLowerCase()}`;
      dims.set(sku, {
        sku,
        resort: "WDW",
        family,
        durationDays: 1,
        parkScope,
        parkToPark: false,
        ageGroup,
        residency: "STD",
        passTier: null,
        variablePriced: false,
        listPriceCents: cents,
        name: `${displayName} (${ageGroup === "ADULT" ? "Ages 10+" : "Ages 3-9"})`,
        updatedAt: observedAt,
      });
      // Flat per-date rows across the window; the blockout tier skips its
      // blocked ranges so those dates fall back to the full-price tier.
      for (let i = 0; i <= DISNEY_PRICE_WINDOW_DAYS; i++) {
        const d = new Date(observedAt);
        d.setDate(d.getDate() + i);
        const iso = isoDate(d);
        if (blockedByDate && isBlocked(iso)) continue;
        rows.push({
          observedAt,
          sku,
          serviceDate: iso,
          priceCents: cents,
          currency: "USD",
          available: true,
          availableUnits: null,
          totalCapacity: null,
          source: Source.DISNEY_DIRECT,
        });
      }
    }
  };

  addTier(WDW_WATER_PARK_FAMILY, "1-Day Water Park Ticket", parsed.regular, false);
  addTier(
    WDW_WATER_PARK_BLOCKOUT_FAMILY,
    "1-Day Water Park Ticket with Blockout Dates",
    parsed.blockout,
    true,
  );

  await upsertProductDims([...dims.values()]);
  const inserted = await insertSkuPrices(rows);
  console.log(
    `[D3] Disney water parks: ${dims.size} SKUs, ${inserted}/${rows.length} price obs inserted`,
  );
  return inserted;
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

  const inserted = await insertSkuPrices(rows);
  console.log(
    `[U1/U2] Universal: ${dimRows.length} SKUs in catalog, ${inserted}/${rows.length} price obs inserted`,
  );
  return inserted;
}

// --- TP: ThemeParks.wiki schedule (park hours + LL bundle pricing) --------

/**
 * Secondary source for both resorts. For every park with a ThemeParks.wiki
 * mapping, pull the forward 30-day `/schedule` and capture two things the direct
 * ticket feeds miss:
 *   (1) park_schedule    — operating hours + ticketed-event windows (daily snapshot)
 *   (2) product_price_obs — LL Multi Pass / Premier daily demand pricing (change-only)
 * Per-park isolation: a flaky/blocked park logs and is skipped, never fails the run.
 * NB: schedule `price.amount` is already in cents (1200 == $12.00) — no *100.
 */
async function captureSchedules(
  themeparksMap: Map<string, number>,
  snapshotDate: string,
  observedAt: Date,
): Promise<number> {
  const scheduleRows: Array<typeof parkSchedule.$inferInsert> = [];
  const priceRows: Array<typeof productPriceObs.$inferInsert> = [];

  for (const [uuid, parkId] of themeparksMap) {
    let payload;
    try {
      payload = await fetchSchedule(uuid, AbortSignal.timeout(config.fetchTimeoutMs));
    } catch (err) {
      console.error(`[TP] schedule ${uuid} failed:`, err instanceof Error ? err.message : err);
      continue;
    }

    // Dedupe bundle prices per (product, date, tier) within a park — last wins.
    const bundles = new Map<string, typeof productPriceObs.$inferInsert>();
    for (const entry of payload.schedule) {
      // (1) hours + ticketed events — needs a real opening time (it's in the PK).
      if (entry.openingTime) {
        scheduleRows.push({
          snapshotDate,
          parkId,
          serviceDate: entry.date,
          type: entry.type,
          openingTime: new Date(entry.openingTime),
          closingTime: entry.closingTime ? new Date(entry.closingTime) : null,
          description: entry.description ?? null,
          source: Source.THEMEPARKS_WIKI,
        });
      }

      // (2) park-date bundle pricing from purchases.
      for (const p of entry.purchases) {
        const cls = themeparksScheduleProduct(p.id);
        if (!cls || p.price?.amount == null) continue;
        bundles.set(`${cls.productId}::${entry.date}::${cls.tier}`, {
          observedAt,
          parkId,
          productId: cls.productId,
          serviceDate: entry.date,
          tier: cls.tier,
          priceCents: Math.round(p.price.amount), // already cents in this feed
          currency: p.price.currency ?? "USD",
          state: p.available ? QueueState.AVAILABLE : QueueState.SOLD_OUT,
          source: Source.THEMEPARKS_WIKI,
        });
      }
    }
    priceRows.push(...bundles.values());
  }

  // park_schedule: daily snapshot, idempotent within the day.
  for (let i = 0; i < scheduleRows.length; i += 500) {
    await db
      .insert(parkSchedule)
      .values(scheduleRows.slice(i, i + 500))
      .onConflictDoNothing();
  }
  const inserted = await insertProductPrices(priceRows);
  console.log(
    `[TP] schedule: ${scheduleRows.length} hours/event rows, ${inserted}/${priceRows.length} bundle price obs inserted`,
  );
  return scheduleRows.length + inserted;
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

  // D3 is SKU-keyed (park_scope, not park FKs), so it runs independent of the
  // disney_direct park mappings above.
  await runStep("D3 Disney water-park pricing", () => captureDisneyWaterParks(observedAt));

  // Universal is SKU-keyed (product_dim + sku_price_obs), not park-mapped.
  if (!browserlessConfigured()) {
    console.warn("[cron-tickets] BROWSERLESS_URL not set — skipping Universal feeds");
  } else {
    await runStep("U1/U2 Universal pricing", () => captureUniversalPricing(todayIso, observedAt));
  }

  // TP: secondary source (both resorts) for park hours + LL bundle pricing.
  const themeparksMap = await parkMapForSource(Source.THEMEPARKS_WIKI);
  if (themeparksMap.size === 0) {
    console.warn("[cron-tickets] no themeparks_wiki park mappings — run db:seed first");
  } else {
    await runStep("TP schedule (hours + LL bundles)", () =>
      captureSchedules(themeparksMap, snapshotDate, observedAt),
    );
  }
}

main()
  .catch((err) => {
    reportServiceError("cron-tickets", "main", err);
    process.exitCode = 1;
  })
  // Flush queued PostHog events BEFORE exiting — process.exit would drop them.
  .finally(async () => {
    await flushTelemetry();
    process.exit(process.exitCode ?? 0);
  });
