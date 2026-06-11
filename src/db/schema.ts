import { sql } from "drizzle-orm";
import {
  bigint,
  bigserial,
  boolean,
  char,
  date,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  smallint,
  text,
  time,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import { user } from "./auth-schema.ts";

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
  // Geo (nullable — enriched monthly by services/geo). `latitude`/`longitude`
  // are the park center; lat/lng min/max are the bounds for a camera fit; the
  // Disney explorer supplies a precise center + `mapZoom`, others are derived
  // from the centroid/bounds of the park's child attractions.
  latitude: doublePrecision("latitude"),
  longitude: doublePrecision("longitude"),
  latMin: doublePrecision("lat_min"),
  latMax: doublePrecision("lat_max"),
  lngMin: doublePrecision("lng_min"),
  lngMax: doublePrecision("lng_max"),
  mapZoom: integer("map_zoom"),
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
    // Geo (nullable — enriched monthly by services/geo from ThemeParks.wiki
    // child coords). `category` is the map-pin class derived from entityType and
    // overridden by the Disney explorer `pin` for WDW:
    // thrill|attraction|water|show|dine|shop|character|info.
    latitude: doublePrecision("latitude"),
    longitude: doublePrecision("longitude"),
    category: text("category"),
  },
  (t) => [index("attractions_park_slug_idx").on(t.parkId, t.slug)],
);

/**
 * Optional per-attraction enrichment from the Disney explorer (one row per
 * enriched attraction, absent for Universal — which has no explorer endpoint).
 * Kept out of `attractions` so that table stays lean: this is the rich card
 * metadata (hero image, official detail page, ride tags, height requirement,
 * land) the finder marker carries. Refreshed by the monthly geo cron.
 */
export const attractionMeta = pgTable("attraction_meta", {
  attractionId: bigint("attraction_id", { mode: "number" })
    .primaryKey()
    .references(() => attractions.id),
  imageThumbUrl: text("image_thumb_url"),
  imageHeroUrl: text("image_hero_url"),
  imageAlt: text("image_alt"),
  detailUrl: text("detail_url"),
  land: text("land"),
  heightRequirement: text("height_requirement"),
  tags: text("tags").array().notNull().default([]),
  source: smallint("source")
    .notNull()
    .references(() => refSource.id),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

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
 * (E) Park calendar: operating hours + ticketed-event windows, captured daily
 * from the ThemeParks.wiki `/schedule` feed (forward ~30 days). One row per
 * (park, service_date, type, opening_time) per daily snapshot, so a date with
 * Operating + Early Entry + Extended Evening windows yields three rows. Daily
 * snapshot (idempotent within a day) — keeps history of how hours/events shift.
 * Plain table (small, slow-moving), not a hypertable.
 */
export const parkSchedule = pgTable(
  "park_schedule",
  {
    snapshotDate: date("snapshot_date").notNull(),
    parkId: bigint("park_id", { mode: "number" })
      .notNull()
      .references(() => parks.id),
    serviceDate: date("service_date").notNull(),
    // OPERATING | TICKETED_EVENT | PRIVATE_EVENT | EXTRA_HOURS | INFO
    type: text("type").notNull(),
    openingTime: timestamp("opening_time", { withTimezone: true }).notNull(),
    closingTime: timestamp("closing_time", { withTimezone: true }),
    // 'Early Entry' | 'Extended Evening' | 'Special Ticketed Event' | null
    description: text("description"),
    source: smallint("source")
      .notNull()
      .references(() => refSource.id),
  },
  (t) => [
    primaryKey({
      columns: [t.parkId, t.serviceDate, t.type, t.openingTime, t.snapshotDate],
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
 * (F) Restaurant catalog (the reservation-availability dimension), shared across
 * operators and partitioned by `source`. WDW rows are seeded weekly from
 * `/dine-res/api/dine/facilities` (OneID session); UOR rows are seeded from the
 * Universal "places" feed (`facilityId` = the `uor.*` place_id). `facilityId` is
 * the join key for the availability sweep. Soft-delete (active=false) on drop —
 * never hard-delete, so `dining_obs` keeps FK integrity + history. Each
 * operator's catalog cron scopes its upsert/soft-delete to its own `source`.
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
  // Optional card metadata (UOR places carry these; WDW leaves them null).
  imageUrl: text("image_url"),
  detailUrl: text("detail_url"),
  // Map metadata from the Disney finder marker (null for UOR). `land` is the
  // granular in-park area (finer than park_resort); `map_pin` is the marker
  // category ('dine' | 'characters' | 'shop').
  latitude: doublePrecision("latitude"),
  longitude: doublePrecision("longitude"),
  mapPin: text("map_pin"),
  land: text("land"),
  // Operator/source that owns this row (DISNEY_DIRECT default backfills the
  // pre-existing WDW catalog). Scopes each catalog cron's upsert + soft-delete.
  source: smallint("source")
    .notNull()
    .default(3)
    .references(() => refSource.id),
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

// ---------------------------------------------------------------------------
// Stays (Disney resort availability) — server-side cache + sweep frontier
// ---------------------------------------------------------------------------

/**
 * (I) Resort-availability observations — the stays analog of `dining_obs`, and
 * the cache that lets `stays.availability` stop calling Disney on every request.
 * Grain = one row per resort per swept (dates, party) query. One Disney call
 * returns ~30 resorts for a (dates, party) tuple, so a sweep writes ~30 rows
 * sharing one `observed_at`. Reads take the latest `observed_at` for the tuple;
 * if it's fresh (< STAYS_CACHE_TTL_MS) it's a cache hit, else we fetch live and
 * insert a new generation. `resort_id` is Disney's numeric facility id (joins
 * the static `RESORT_BY_ID` catalog in app code — no dim table, no FK).
 */
export const stayObs = pgTable(
  "stay_obs",
  {
    observedAt: timestamp("observed_at", { withTimezone: true }).notNull(),
    resortId: text("resort_id").notNull(),
    checkIn: date("check_in").notNull(),
    checkOut: date("check_out").notNull(),
    // Canonical encoding of the non-date dims (party mix + accessible + FL
    // resident); see `buildPartyKey`. The read path and the sweep build it the
    // same way so keys collide correctly.
    partyKey: text("party_key").notNull(),
    available: boolean("available").notNull(),
    // null when unavailable (no bookable subtotal).
    pricePerNight: integer("price_per_night"),
    reasonCode: text("reason_code"),
    source: smallint("source")
      .notNull()
      .references(() => refSource.id),
  },
  (t) => [
    primaryKey({
      columns: [t.resortId, t.checkIn, t.checkOut, t.partyKey, t.observedAt],
    }),
    // Latest-generation lookup for the read path: newest obs for a (dates,party).
    index("stay_obs_latest_idx").on(t.checkIn, t.checkOut, t.partyKey, t.observedAt.desc()),
  ],
);

/**
 * (J) The stays sweep frontier — which (dates, party) tuples the
 * `stays-availability` cron keeps warm, mirroring how `restaurant_dim.priority`
 * + least-recently-swept ordering drive the dining sweep. Rows arrive three
 * ways: a seeded rolling warm set (next weekends × small parties, so cold
 * browse is instant), user searches (which bump `last_requested_at`), and
 * (phase 2) alert subscriptions (`alert_backed`). The raw dims are stored so
 * the sweep can rebuild the Disney request body from a row alone. Demand-only
 * rows age out once cold so the swept space stays bounded.
 */
export const stayQuery = pgTable(
  "stay_query",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    checkIn: date("check_in").notNull(),
    checkOut: date("check_out").notNull(),
    partyKey: text("party_key").notNull(),

    // Raw dims to rebuild the resort-availability request body.
    adults: smallint("adults").notNull(),
    children: smallint("children").notNull(),
    // Comma-joined sorted child ages ("" when none); parsed back on sweep.
    childAges: text("child_ages").notNull().default(""),
    accessible: boolean("accessible").notNull().default(false),
    floridaResident: boolean("florida_resident").notNull().default(false),
    postalCode: text("postal_code"),

    // Demand signal (bumped on user search) + sweeper bookkeeping.
    lastRequestedAt: timestamp("last_requested_at", { withTimezone: true }),
    lastSweptAt: timestamp("last_swept_at", { withTimezone: true }),
    // Has ≥1 active alert (phase 2); pins the row past demand age-out.
    alertBacked: boolean("alert_backed").notNull().default(false),
  },
  (t) => [
    uniqueIndex("stay_query_dims_uq").on(t.checkIn, t.checkOut, t.partyKey),
    index("stay_query_swept_idx").on(t.lastSweptAt),
  ],
);

// ---------------------------------------------------------------------------
// User-facing alerts
// ---------------------------------------------------------------------------

/**
 * Per-user ride wait-time alert subscriptions. Evaluated once per worker tick
 * against each attraction's latest STANDBY `queue_obs` + status — no separate
 * fetch path. Firing uses edge-trigger + cooldown state carried on the row:
 *  - `armed` flips false on fire and re-arms once the condition clears, so a
 *    sustained match notifies once, not every tick.
 *  - `lastFiredAt` enforces a minimum gap between fires (ALERT_COOLDOWN_MS).
 *  - `lastWaitMin` is the change-mode baseline (reset on fire); `lastStatus`
 *    is the carried status used to edge-detect DOWN→OPERATING-style flips.
 *
 * The partial unique index on (user, attraction) WHERE active makes "one active
 * alert per ride" a DB invariant, so create is a clean upsert.
 */
export const rideAlert = pgTable(
  "ride_alert",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    parkId: bigint("park_id", { mode: "number" })
      .notNull()
      .references(() => parks.id),
    attractionId: bigint("attraction_id", { mode: "number" })
      .notNull()
      .references(() => attractions.id),

    // rule: 1 = threshold (fire when standby <= thresholdMin),
    //       2 = change   (fire on status flip or |Δ standby| >= changeDelta)
    mode: smallint("mode").notNull(),
    thresholdMin: integer("threshold_min"),
    changeDelta: integer("change_delta"),

    // firing state (edge-trigger + cooldown)
    armed: boolean("armed").notNull().default(true),
    lastFiredAt: timestamp("last_fired_at", { withTimezone: true }),
    lastWaitMin: integer("last_wait_min"),
    lastStatus: smallint("last_status"),

    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("ride_alert_active_attraction_idx")
      .on(t.attractionId)
      .where(sql`active`),
    index("ride_alert_user_park_idx").on(t.userId, t.parkId),
    uniqueIndex("ride_alert_user_attraction_uq")
      .on(t.userId, t.attractionId)
      .where(sql`active`),
  ],
);

/**
 * Per-user resort-availability alert subscriptions (the stays analog of
 * `ride_alert`). Each row points at a swept `stay_query` (the dates + party the
 * sweeper keeps warm) and is evaluated against that query's latest `stay_obs`
 * generation after every sweep — no separate fetch path. Firing carries the same
 * edge-trigger + cooldown state as ride alerts (`armed`/`last_fired_at`), with
 * `last_available`/`last_price` as the becomes-available / price baseline.
 *
 * `resort_id = ''` means "any resort" (a non-null sentinel so the partial unique
 * index keys on plain columns, like `ride_alert`); a numeric id targets one
 * resort. Cap = 3 active per user *total* (no park axis), enforced in the router.
 * Delivery is logged + retried EMAIL (see `notification`), not best-effort push.
 */
export const stayAlert = pgTable(
  "stay_alert",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    queryId: bigint("query_id", { mode: "number" })
      .notNull()
      .references(() => stayQuery.id, { onDelete: "cascade" }),
    // '' = any resort; otherwise a Disney facility id (joins RESORT_BY_ID).
    resortId: text("resort_id").notNull().default(""),

    // rule: 1 = becomes_available (fire when any room opens),
    //       2 = price_below       (fire when available price <= priceBelow)
    mode: smallint("mode").notNull(),
    priceBelow: integer("price_below"),
    // 'email' (v1) | 'sms' (later) — the queue + worker already accommodate sms.
    channel: text("channel").notNull().default("email"),

    // firing state (edge-trigger + cooldown)
    armed: boolean("armed").notNull().default(true),
    lastFiredAt: timestamp("last_fired_at", { withTimezone: true }),
    lastAvailable: boolean("last_available"),
    lastPrice: integer("last_price"),

    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("stay_alert_active_query_idx")
      .on(t.queryId)
      .where(sql`active`),
    uniqueIndex("stay_alert_user_resort_query_uq")
      .on(t.userId, t.resortId, t.queryId)
      .where(sql`active`),
  ],
);

/**
 * Durable send log for stay-alert delivery — one row per fire, written
 * (status `queued`) BEFORE the send job runs, so it's a dedupe key + audit
 * trail + the "what we sent" inbox + unsubscribe correlation. The worker flips
 * it to `sent` (+ `provider_msg_id`) or `failed` (+ `error`) after Resend.
 */
export const notification = pgTable(
  "notification",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    alertId: bigint("alert_id", { mode: "number" })
      .notNull()
      .references(() => stayAlert.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    channel: text("channel").notNull(),
    // resort, dates, matched price, rendered subject — enough to render + audit.
    payload: jsonb("payload").notNull(),
    // 'queued' | 'sent' | 'failed'
    status: text("status").notNull(),
    providerMsgId: text("provider_msg_id"),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    sentAt: timestamp("sent_at", { withTimezone: true }),
  },
  (t) => [index("notification_user_created_idx").on(t.userId, t.createdAt.desc())],
);

/**
 * Global per-user kill switch for stay-alert email, hit by the one-click
 * unsubscribe link — silences all stay-alert mail without deleting individual
 * alerts. The evaluator skips users whose `stay_email_opt_out` is set.
 */
export const alertOptout = pgTable("alert_optout", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  stayEmailOptOut: boolean("stay_email_opt_out").notNull().default(false),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
