/**
 * Daily gated-feed poll (Railway cron, e.g. "0 8 * * *"). Single-shot: capture
 * the WDW + Universal Orlando ticket/Express feeds, snapshot them, exit. Every
 * feed is isolated — a flaky or blocked upstream logs and is skipped, never
 * fails the run (so one resort going dark doesn't lose the other's data).
 *
 * Feeds (see research/gated-feeds-report.md):
 *   D1  Disney ticket-date availability  -> ticket_availability  (plain HTTPS)
 *   D2  Disney date-based ticket pricing -> product_price_obs     (plain HTTPS, cookieless bearer)
 *   U1  Universal Express pricing        -> product_price_obs     (Browserless v2 Chromium)
 *   U2  Universal admission pricing       -> product_price_obs     (Browserless v2 Chromium)
 *
 * Disney's JSON APIs aren't Akamai-sensor-gated, so they run over a plain HTTPS
 * client. Universal's are gated by a real-browser guest session, so they run
 * through the separate Browserless v2 service (BROWSERLESS_URL). If Browserless
 * isn't configured, Universal is skipped and Disney still runs.
 *
 * Run:  bun run cron:tickets
 */
import { config as loadEnv } from "dotenv";
loadEnv({ path: [".env.local", ".env"] });

import { and, eq } from "drizzle-orm";

import { db } from "#/db/index.ts";
import { externalIds, productPriceObs, ticketAvailability } from "#/db/schema.ts";
import {
  availabilityToQueueState,
  Product,
  QueueState,
  Source,
  universalAvailabilityToQueueState,
  universalParkCode,
  universalProductId,
} from "#/server/parks/codes.ts";
import {
  fetchAvailabilityCalendar,
  fetchClientToken,
  fetchTicketPricing,
} from "#/server/parks/sources/disney.ts";
import { browserlessConfigured } from "#/server/parks/sources/browserless.ts";
import { fetchUniversalPricing } from "#/server/parks/sources/universal.ts";
import { config } from "#/server/parks/config.ts";

const SEGMENT = "tickets" as const;
const WINDOW_DAYS = Number(process.env.TICKET_WINDOW_DAYS ?? 60);
// Which Disney numDays buckets to record. The 1-day adult/child series is the
// demand signal; widen via env if longer-stay pricing is wanted.
const DISNEY_DAY_BUCKETS = new Set(
  (process.env.DISNEY_DAY_BUCKETS ?? "1").split(",").map((s) => s.trim()),
);

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function roundCents(amount: number): number {
  return Math.round(amount * 100);
}

/** External-id (by source) -> internal park id, for a given source. */
async function parkMapForSource(source: number): Promise<Map<string, number>> {
  const rows = await db
    .select({ externalId: externalIds.externalId, entityId: externalIds.entityId })
    .from(externalIds)
    .where(and(eq(externalIds.source, source), eq(externalIds.entityKind, "park")));
  return new Map(rows.map((r) => [r.externalId, r.entityId]));
}

async function insertPriceRows(rows: Array<typeof productPriceObs.$inferInsert>): Promise<void> {
  for (let i = 0; i < rows.length; i += 500) {
    await db
      .insert(productPriceObs)
      .values(rows.slice(i, i + 500))
      .onConflictDoNothing();
  }
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

async function captureDisneyPricing(
  wdwParkIds: Array<number>,
  todayIso: string,
  endIso: string,
  observedAt: Date,
): Promise<number> {
  const signal = AbortSignal.timeout(config.fetchTimeoutMs);
  const token = await fetchClientToken(signal);
  const pricing = await fetchTicketPricing(
    token.access_token,
    AbortSignal.timeout(config.fetchTimeoutMs),
  );

  const rows: Array<typeof productPriceObs.$inferInsert> = [];
  for (const bucket of pricing.pricingCalendar?.pricingCalendar ?? []) {
    if (!DISNEY_DAY_BUCKETS.has(bucket.numDays)) continue;
    for (const day of bucket.dates) {
      if (day.date < todayIso || day.date > endIso) continue;

      // Disney lists several price points per ageGroup per date (validity
      // windows / ticket options). Collapse to one headline figure per age:
      // the lowest sellable "from" price. This keeps each (park, date, tier)
      // unique (it's the PK) and matches the price Disney advertises.
      const byAge = new Map<string, { amount: number; soldOut: boolean }>();
      for (const p of day.pricing) {
        if (!p.pricePerDay) continue;
        const amount = Number(p.pricePerDay);
        if (!Number.isFinite(amount)) continue;
        const age = p.ageGroup ?? "adult";
        const soldOut = p.stopSale ?? false;
        const prev = byAge.get(age);
        const better =
          !prev ||
          (prev.soldOut && !soldOut) || // prefer a sellable price
          (prev.soldOut === soldOut && amount < prev.amount); // else the lowest
        if (better) byAge.set(age, { amount, soldOut });
      }

      for (const [age, { amount, soldOut }] of byAge) {
        const tier = `${bucket.numDays}day_${age}`;
        const state = soldOut ? QueueState.SOLD_OUT : QueueState.AVAILABLE;
        // WDW date-based tickets are resort-wide (one price admits to any park);
        // record against every WDW park so per-park queries resolve.
        for (const parkId of wdwParkIds) {
          rows.push({
            observedAt,
            parkId,
            productId: Product.DISNEY_TICKET,
            serviceDate: day.date,
            tier,
            priceCents: roundCents(amount),
            currency: "USD",
            state,
            source: Source.DISNEY_DIRECT,
          });
        }
      }
    }
  }

  await insertPriceRows(rows);
  return rows.length;
}

// --- U1/U2: Universal Express + admission pricing -------------------------

async function captureUniversalPricing(
  uniMap: Map<string, number>,
  todayIso: string,
  endIso: string,
  observedAt: Date,
): Promise<number> {
  const pricing = await fetchUniversalPricing(AbortSignal.timeout(config.browserlessTimeoutMs));

  const rows: Array<typeof productPriceObs.$inferInsert> = [];
  const unmappedParks = new Set<string>();
  for (const [partNumber, byDate] of Object.entries(pricing.eventAvailability)) {
    const parkCode = universalParkCode(partNumber);
    const parkId = parkCode ? uniMap.get(parkCode) : undefined;
    if (!parkId) {
      if (parkCode) unmappedParks.add(parkCode);
      continue;
    }
    const productId = universalProductId(partNumber);
    for (const [serviceDate, entry] of Object.entries(byDate)) {
      if (serviceDate < todayIso || serviceDate > endIso) continue;
      const price = entry.pricing[0];
      if (price?.amount === undefined) continue;
      const inv = entry.inventoryEvents[0];
      rows.push({
        observedAt,
        parkId,
        productId,
        serviceDate,
        tier: partNumber,
        priceCents: roundCents(price.amount),
        currency: price.currency ?? "USD",
        state: universalAvailabilityToQueueState(inv?.available, inv?.availableUnits),
        source: Source.UNIVERSAL_DIRECT,
      });
    }
  }

  if (unmappedParks.size > 0) {
    console.warn(
      `[U1/U2] Universal: no park mapping for codes [${[...unmappedParks].join(", ")}] — run db:seed (Volcano Bay isn't seeded yet)`,
    );
  }
  await insertPriceRows(rows);
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
  const universalMap = await parkMapForSource(Source.UNIVERSAL_DIRECT);

  if (disneyMap.size === 0) {
    console.warn("[cron-tickets] no disney_direct park mappings — run db:seed first");
  } else {
    await runStep("D1 Disney availability", () =>
      captureDisneyAvailability(disneyMap, todayIso, endIso, snapshotDate),
    );
    await runStep("D2 Disney ticket pricing", () =>
      captureDisneyPricing([...disneyMap.values()], todayIso, endIso, observedAt),
    );
  }

  if (!browserlessConfigured()) {
    console.warn("[cron-tickets] BROWSERLESS_URL not set — skipping Universal feeds");
  } else if (universalMap.size === 0) {
    console.warn("[cron-tickets] no universal_direct park mappings — run db:seed first");
  } else {
    await runStep("U1/U2 Universal pricing", () =>
      captureUniversalPricing(universalMap, todayIso, endIso, observedAt),
    );
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
