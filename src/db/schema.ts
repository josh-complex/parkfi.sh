import {
  bigint,
  bigserial,
  boolean,
  char,
  date,
  index,
  integer,
  pgTable,
  primaryKey,
  smallint,
  text,
  time,
  timestamp,
} from "drizzle-orm/pg-core";

// better-auth tables (user/session/account/verification) — re-exported so
// drizzle-kit migrations and the `db` schema object include them.
export * from "./auth-schema.ts";

/**
 * Theme-park data platform schema.
 *
 * Design notes (locked decisions):
 * - Queue mechanics are NORMALIZED into `queue_obs` (one row per
 *   attraction/queue_type/tick) rather than widening a fact table with
 *   Disney-specific columns. A park with no paid line simply never emits
 *   PAID_RETURN_TIME rows.
 * - `attraction_status_obs` is a CHANGE-LOG: one row per status transition,
 *   carried forward until the next row. Reads use "latest row <= T".
 * - Two pricing grains: per-attraction demand price (LL Single, à-la-carte
 *   paid returns) lives on `queue_obs.price_cents`; per-park-date bundle price
 *   (LL Multi, Universal Express tiers) lives in `product_price_obs`.
 * - Hot tables use smallint codes + reference tables (great Timescale
 *   compression). Hypertables/compression/retention live in the custom
 *   migration `drizzle/*_timescale_hypertables`; the `queue_hourly` continuous
 *   aggregate is applied via `bun run db:cagg` (see `src/db/cagg.sql`).
 */

// ---------------------------------------------------------------------------
// Reference (lookup) tables — seeded from `src/db/seed.ts`
// ---------------------------------------------------------------------------

export const refQueueType = pgTable("ref_queue_type", {
  id: smallint("id").primaryKey(),
  code: text("code").notNull().unique(),
});

export const refProduct = pgTable("ref_product", {
  id: smallint("id").primaryKey(),
  code: text("code").notNull().unique(),
  // 'attraction' | 'park_date' | 'free'
  pricingGrain: text("pricing_grain").notNull(),
});

export const refAttractionStatus = pgTable("ref_attraction_status", {
  id: smallint("id").primaryKey(),
  code: text("code").notNull().unique(),
});

export const refQueueState = pgTable("ref_queue_state", {
  id: smallint("id").primaryKey(),
  code: text("code").notNull().unique(),
});

export const refSource = pgTable("ref_source", {
  id: smallint("id").primaryKey(),
  code: text("code").notNull().unique(),
});

// ---------------------------------------------------------------------------
// Dimensions
// ---------------------------------------------------------------------------

export const operators = pgTable("operators", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
});

export const resorts = pgTable("resorts", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  operatorId: bigint("operator_id", { mode: "number" }).references(() => operators.id),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
});

export const parks = pgTable("parks", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  resortId: bigint("resort_id", { mode: "number" }).references(() => resorts.id),
  operatorId: bigint("operator_id", { mode: "number" }).references(() => operators.id),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  timezone: text("timezone").notNull(),
  active: boolean("active").notNull().default(true),
});

export const attractions = pgTable(
  "attractions",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    parkId: bigint("park_id", { mode: "number" })
      .notNull()
      .references(() => parks.id),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    // ATTRACTION | SHOW | RESTAURANT
    entityType: text("entity_type").notNull().default("ATTRACTION"),
    active: boolean("active").notNull().default(true),
  },
  (t) => [index("attractions_park_slug_idx").on(t.parkId, t.slug)],
);

/**
 * Source-agnostic ID mapping: add or swap a feed without rewriting facts.
 * entityKind ∈ 'park' | 'attraction' | 'restaurant'
 */
export const externalIds = pgTable(
  "external_ids",
  {
    entityKind: text("entity_kind").notNull(),
    entityId: bigint("entity_id", { mode: "number" }).notNull(),
    source: smallint("source")
      .notNull()
      .references(() => refSource.id),
    externalId: text("external_id").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.source, t.entityKind, t.externalId] }),
    index("external_ids_entity_idx").on(t.entityKind, t.entityId),
  ],
);

// ---------------------------------------------------------------------------
// Capability tables — answer "does this park have a paid line?" without
// touching the time-series.
// ---------------------------------------------------------------------------

export const parkProducts = pgTable(
  "park_products",
  {
    parkId: bigint("park_id", { mode: "number" })
      .notNull()
      .references(() => parks.id),
    productId: smallint("product_id")
      .notNull()
      .references(() => refProduct.id),
    displayName: text("display_name").notNull(),
    active: boolean("active").notNull().default(true),
  },
  (t) => [primaryKey({ columns: [t.parkId, t.productId] })],
);

export const attractionQueueSupport = pgTable(
  "attraction_queue_support",
  {
    attractionId: bigint("attraction_id", { mode: "number" })
      .notNull()
      .references(() => attractions.id),
    queueType: smallint("queue_type")
      .notNull()
      .references(() => refQueueType.id),
  },
  (t) => [primaryKey({ columns: [t.attractionId, t.queueType] })],
);

// ---------------------------------------------------------------------------
// Facts (time-series). Hypertables applied in the timescale_hypertables migration.
// ---------------------------------------------------------------------------

/** (A) Status change-log: one row per transition, carried forward. */
export const attractionStatusObs = pgTable(
  "attraction_status_obs",
  {
    observedAt: timestamp("observed_at", { withTimezone: true }).notNull(),
    attractionId: bigint("attraction_id", { mode: "number" }).notNull(),
    status: smallint("status")
      .notNull()
      .references(() => refAttractionStatus.id),
    source: smallint("source")
      .notNull()
      .references(() => refSource.id),
  },
  (t) => [primaryKey({ columns: [t.attractionId, t.observedAt] })],
);

/** (B) Per-queue observations. STANDBY for everyone; PAID_* only where offered. */
export const queueObs = pgTable(
  "queue_obs",
  {
    observedAt: timestamp("observed_at", { withTimezone: true }).notNull(),
    attractionId: bigint("attraction_id", { mode: "number" }).notNull(),
    queueType: smallint("queue_type")
      .notNull()
      .references(() => refQueueType.id),
    // STANDBY / SINGLE_RIDER / PAID_STANDBY
    waitMin: integer("wait_min"),
    // paid/virtual availability
    state: smallint("state").references(() => refQueueState.id),
    // ONLY attraction-grain pricing (LL Single, à-la-carte paid returns)
    priceCents: integer("price_cents"),
    currency: char("currency", { length: 3 }),
    returnStart: timestamp("return_start", { withTimezone: true }),
    returnEnd: timestamp("return_end", { withTimezone: true }),
    // BOARDING_GROUP only
    boardingGroup: integer("boarding_group"),
    source: smallint("source")
      .notNull()
      .references(() => refSource.id),
  },
  (t) => [primaryKey({ columns: [t.attractionId, t.queueType, t.observedAt] })],
);

/** (C) Park-date bundle pricing/availability: LL Multi, Express tiers, Flash Pass… */
export const productPriceObs = pgTable(
  "product_price_obs",
  {
    observedAt: timestamp("observed_at", { withTimezone: true }).notNull(),
    parkId: bigint("park_id", { mode: "number" }).notNull(),
    productId: smallint("product_id")
      .notNull()
      .references(() => refProduct.id),
    // the date the price is FOR
    serviceDate: date("service_date").notNull(),
    // 'Regular' | 'Unlimited' | 'Gold' | 'Platinum'; '' when single-tier
    // (NOT NULL so it can live in the primary key)
    tier: text("tier").notNull().default(""),
    priceCents: integer("price_cents"),
    currency: char("currency", { length: 3 }),
    state: smallint("state").references(() => refQueueState.id),
    source: smallint("source")
      .notNull()
      .references(() => refSource.id),
  },
  (t) => [
    primaryKey({
      columns: [t.parkId, t.productId, t.serviceDate, t.tier, t.observedAt],
    }),
  ],
);

/** (D) Ticket / park-pass availability (daily snapshot). */
export const ticketAvailability = pgTable(
  "ticket_availability",
  {
    snapshotDate: date("snapshot_date").notNull(),
    parkId: bigint("park_id", { mode: "number" })
      .notNull()
      .references(() => parks.id),
    serviceDate: date("service_date").notNull(),
    // tickets | resort | passholder
    segment: text("segment").notNull(),
    state: smallint("state")
      .notNull()
      .references(() => refQueueState.id),
    source: smallint("source")
      .notNull()
      .references(() => refSource.id),
  },
  (t) => [
    primaryKey({
      columns: [t.parkId, t.serviceDate, t.segment, t.snapshotDate],
    }),
  ],
);

/**
 * (D2) SKU dimension for resorts whose products are SKU-centric, not park-keyed
 * (Universal Orlando: a P2P ticket spans multiple parks; pricing is per-SKU).
 * Keyed by the upstream SKU string (Universal `partNumber`). Populated from the
 * `gettickets` catalog crawl; see research/universal-ticket-deep-dive.md §4.
 */
export const productDim = pgTable("product_dim", {
  // upstream SKU id, e.g. 'TPA-01D_PTP_2P_AD_GA_ABP' or 'AO-UEP_UU_USF'
  sku: text("sku").primaryKey(),
  resort: text("resort").notNull(),
  // 'TICKET' | 'ANNUAL' | 'EXPRESS'
  family: text("family").notNull(),
  // 1..7 for day tickets; null for annual passes
  durationDays: integer("duration_days"),
  // park codes the SKU is valid at (USF/UIOA/EPIC/UVB)
  parkScope: text("park_scope").array().notNull(),
  parkToPark: boolean("park_to_park").notNull().default(false),
  // 'ADULT' | 'CHILD' | null
  ageGroup: text("age_group"),
  // 'STD' | 'FL' (Florida resident)
  residency: text("residency").notNull().default("STD"),
  // annual tiers: 'POWER' | 'SEASONAL' | 'PREFERRED' | 'PREMIER' | null
  passTier: text("pass_tier"),
  variablePriced: boolean("variable_priced").notNull().default(false),
  listPriceCents: integer("list_price_cents"),
  name: text("name"),
  active: boolean("active").notNull().default(true),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * (D3) Park-agnostic SKU pricing/availability (Universal day tickets, Express,
 * annual passes). One row per (sku, service_date, tick); annual passes use
 * service_date = the observation date. `available` is the reliable sell-out
 * signal — `available_units`/`total_capacity` are soft (Universal caps them).
 */
export const skuPriceObs = pgTable(
  "sku_price_obs",
  {
    observedAt: timestamp("observed_at", { withTimezone: true }).notNull(),
    sku: text("sku")
      .notNull()
      .references(() => productDim.sku),
    serviceDate: date("service_date").notNull(),
    priceCents: integer("price_cents"),
    currency: char("currency", { length: 3 }),
    available: boolean("available"),
    availableUnits: integer("available_units"),
    totalCapacity: integer("total_capacity"),
    source: smallint("source")
      .notNull()
      .references(() => refSource.id),
  },
  (t) => [primaryKey({ columns: [t.sku, t.serviceDate, t.observedAt] })],
);

/**
 * (F) WDW restaurant catalog (the dine-vas dimension). Seeded weekly from
 * `/dine-res/api/dine/facilities` via the maintained OneID session. `facilityId`
 * is the bare id (the `;entityType=…` suffix is split into `entityType`); it's
 * the join key for the availability sweep. Soft-delete (active=false) on drop —
 * never hard-delete, so `dining_obs` keeps FK integrity + history.
 */
export const restaurantDim = pgTable("restaurant_dim", {
  facilityId: text("facility_id").primaryKey(),
  // 'restaurant' | 'dinner-show' | 'dining-event'
  entityType: text("entity_type").notNull(),
  name: text("name").notNull(),
  cuisine: text("cuisine"),
  experienceType: text("experience_type"),
  priceRange: text("price_range"),
  parkResort: text("park_resort"),
  parkResortId: text("park_resort_id"),
  // reservations-accepted/checkAvail facet + sellableOnline => sweepable candidate
  bookable: boolean("bookable").notNull().default(false),
  sellableOnline: boolean("sellable_online").notNull().default(false),
  // hot tier the availability poller actually sweeps (config-controlled, not catalog)
  priority: boolean("priority").notNull().default(false),
  active: boolean("active").notNull().default(true),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * (G) Dining reservation availability (dine-vas getAvailability). One row per
 * bookable slot from `offersByAccessibility[]`; a sentinel row (empty
 * `meal_period`/`offer_time`) records "(facility,date,party) checked, none
 * available". See research/disney-ticket-deep-dive.md §7.
 */
export const diningObs = pgTable(
  "dining_obs",
  {
    observedAt: timestamp("observed_at", { withTimezone: true }).notNull(),
    facilityId: text("facility_id")
      .notNull()
      .references(() => restaurantDim.facilityId),
    serviceDate: date("service_date").notNull(),
    partySize: smallint("party_size").notNull(),
    // '' on the "none available" sentinel row (NOT NULL so it lives in the PK)
    mealPeriod: text("meal_period").notNull().default(""),
    offerTime: time("offer_time").notNull().default("00:00:00"),
    offerId: text("offer_id"),
    source: smallint("source")
      .notNull()
      .references(() => refSource.id),
  },
  (t) => [
    primaryKey({
      columns: [t.facilityId, t.serviceDate, t.partySize, t.mealPeriod, t.offerTime, t.observedAt],
    }),
  ],
);

/**
 * (H) Encrypted scraper sessions (e.g. the Disney OneID storageState). The blob
 * is a live account credential, so it's AES-256-GCM encrypted (key from
 * SESSION_ENC_KEY, never stored here). Re-seeded on 401.
 */
export const scraperSession = pgTable("scraper_session", {
  name: text("name").primaryKey(),
  accountLabel: text("account_label"),
  ciphertext: text("ciphertext").notNull(),
  iv: text("iv").notNull(),
  authTag: text("auth_tag").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  lastValidatedAt: timestamp("last_validated_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
