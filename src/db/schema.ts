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

/** (E) Dining availability (later; per-user-auth feed). */
export const diningObs = pgTable(
  "dining_obs",
  {
    observedAt: timestamp("observed_at", { withTimezone: true }).notNull(),
    restaurantId: bigint("restaurant_id", { mode: "number" })
      .notNull()
      .references(() => attractions.id),
    serviceDate: date("service_date").notNull(),
    mealTime: time("meal_time").notNull(),
    partySize: smallint("party_size").notNull(),
    available: boolean("available").notNull(),
    source: smallint("source")
      .notNull()
      .references(() => refSource.id),
  },
  (t) => [
    primaryKey({
      columns: [t.restaurantId, t.serviceDate, t.mealTime, t.partySize, t.observedAt],
    }),
  ],
);
