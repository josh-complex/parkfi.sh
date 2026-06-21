import { sql } from "drizzle-orm";
import {
  bigint,
  bigserial,
  boolean,
  char,
  customType,
  date,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  real,
  smallint,
  text,
  time,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/** Raw Postgres `bytea` — used for serialized model artifacts (F8). */
const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() {
    return "bytea";
  },
});

/**
 * pgvector column (pin-traders). Serializes a JS number[] to the `[1,2,3]`
 * literal pgvector wants on the wire and parses it back on read. The actual ANN
 * lookups run as raw SQL (`embedding <=> $1`) in the identify worker; this type
 * just lets the table live in the drizzle schema object + migrations.
 */
const vector = (name: string, dim: number) =>
  customType<{ data: number[]; driverData: string }>({
    dataType() {
      return `vector(${dim})`;
    },
    toDriver(value: number[]): string {
      return `[${value.join(",")}]`;
    },
    fromDriver(value: string): number[] {
      return value
        .slice(1, -1)
        .split(",")
        .map((v) => Number(v));
    },
  })(name);

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
 * - `attraction_status_obs` is a CHANGE-LOG: a row on each status transition,
 *   carried forward until the next row. Reads use "latest row <= T". Ingest also
 *   re-asserts the current status on a heartbeat (config.statusHeartbeatMs) so a
 *   missed transition self-heals, so consecutive rows may repeat a status —
 *   transition queries must compare against the prior row, not assume distinctness.
 * - Two pricing grains: per-attraction demand price (LL Single, à-la-carte
 *   paid returns) lives on `queue_obs.price_cents`; per-park-date bundle price
 *   (LL Multi, Universal Express tiers) lives in `product_price_obs`.
 * - Hot tables use smallint codes + reference tables (great Timescale
 *   compression). Hypertables/compression/retention live in the custom
 *   migration `drizzle/*_timescale_hypertables`; the `queue_hourly` and
 *   `queue_15min` continuous aggregates are applied via `bun run db:cagg`
 *   (see `src/db/cagg.sql`).
 * - `queue_15min` is the permanent feature store for wait-time forecasting:
 *   a 15-minute continuous aggregate with NO retention (raw `queue_obs` keeps
 *   its 90-day drop). Models train on the aggregate, not raw rows.
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
  // GeoJSON geometry ([lng,lat] Polygon | MultiPolygon) outlining the actual
  // theme-park area, enriched monthly by services/geo from OpenStreetMap
  // (`tourism=theme_park`, matched by name). Nullable — absent until the geo cron
  // runs. Drawn on the map so we outline just the park, not the whole resort
  // property (which is only an artifact of the OSM basemap tiles).
  boundary: jsonb("boundary").$type<GeoPolygon>(),
  // Park-level hero photo + alt, enriched monthly by services/geo from the
  // operator's own feed (Disney finder `heroData`; Universal places `Park`
  // entry `heroImage`). Nullable — absent until the geo cron runs.
  imageUrl: text("image_url"),
  imageAlt: text("image_alt"),
});

/** GeoJSON geometry stored on `parks.boundary` — a park's outline in [lng,lat]. */
export type GeoPolygon =
  | { type: "Polygon"; coordinates: Array<Array<[number, number]>> }
  | { type: "MultiPolygon"; coordinates: Array<Array<Array<[number, number]>>> };

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
    // Sample time = the poll tick that captured this row, NOT the feed's
    // `lastUpdated`. Stamping at tick time gives uniform poll-cadence sampling;
    // keying on the feed timestamp (its old behavior) deduped every unchanged
    // poll away, so buckets ended up with wildly uneven sample counts.
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
    // The feed's own `lastUpdated` for this reading (when upstream last refreshed
    // the value). Retained for staleness checks; the sample cadence lives on
    // `observed_at`. Nullable: some sources / readings don't report one.
    lastUpdated: timestamp("last_updated", { withTimezone: true }),
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
  // Finder slug ("jaleo") — keys the `details-entity-simple` schedule endpoint
  // and the detail/menu web URLs (the numeric `facility_id` keys the dinemenu API).
  urlFriendlyId: text("url_friendly_id"),
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
  // Granular in-park land entity id from the finder ("80007973"), finer than
  // `land` (a label) and `park_resort`. FK-shaped against `dining_location`.
  landId: text("land_id"),
  // Booking party-size cap (mostly dining-events); null when unbounded.
  maximumPartySize: integer("maximum_party_size"),
  // Catalog attribute flags (DISNEY_DIRECT only; UOR leaves them at default).
  // Derived in `disney-finder-catalog.toRow` from the finder facets. Power the
  // "no reservation needed" / "mobile order" / "character dining" filters.
  walkupWaitList: boolean("walkup_wait_list").notNull().default(false),
  mobileOrder: boolean("mobile_order").notNull().default(false),
  characterDining: boolean("character_dining").notNull().default(false),
  fineDining: boolean("fine_dining").notNull().default(false),
  // Dining package / dining-event: fireworks dessert parties, Fantasmic! &
  // fireworks dining packages, festival concert packages. Derived from the
  // finder `tableService` "dine-events" / "dessert-events" tags.
  diningPackage: boolean("dining_package").notNull().default(false),
  annualPassDiscount: boolean("annual_pass_discount").notNull().default(false),
  disneyVisaDiscount: boolean("disney_visa_discount").notNull().default(false),
  tripAdvisorAward: boolean("trip_advisor_award").notNull().default(false),
  // Which Disney Dining Plan credit tiers apply (2026/2027 QS + TS meals).
  diningPlanQs: boolean("dining_plan_qs").notNull().default(false),
  diningPlanTs: boolean("dining_plan_ts").notNull().default(false),
  // Recommendation/taxonomy arrays that feed the "Disney Picks" shelves:
  // franchise affinity (`star-wars-rec`…), rec buckets (`character-dining-rec`…),
  // venue entertainment (`live-music`…), and premium-events categories.
  disneyFavorites: text("disney_favorites").array().notNull().default([]),
  diningInterests: text("dining_interests").array().notNull().default([]),
  entertainmentType: text("entertainment_type").array().notNull().default([]),
  eecCategory: text("eec_category").array().notNull().default([]),
  // Internal `dine-product-svc` product links (menu/product data per venue).
  productUrls: text("product_urls").array().notNull().default([]),
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
 * (F.1) Dining ancestor locations — the 43 reference entities the WDW finder
 * lists dining under (4 theme parks, 2 water parks, Disney Springs/ESPN/
 * BoardWalk, + the resorts). Near-static; refreshed by the same weekly catalog
 * cron as `restaurant_dim`. A proper lookup for `restaurant_dim.park_resort_id`
 * / `land_id` (no FK enforced — the catalog and this table refresh together and
 * either can lead). `id` is the finder entity id ("80007944;entityType=theme-park").
 */
export const diningLocation = pgTable("dining_location", {
  id: text("id").primaryKey(),
  title: text("title"),
  urlFriendlyId: text("url_friendly_id"),
  // 'theme-park' | 'water-park' | 'Entertainment-Venue' | 'resort-area' | 'resort'
  locationType: text("location_type"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * (F.2) Per-venue operating hours, enriched weekly by the `dining-facilities`
 * cron from `details-entity-simple` (`structuredData.openingHoursSpecification`).
 * One row per (venue, date, schedule type, start). `schedule_type` is
 * "Operating" / "Extended Evening" / etc. Powers "open now / open late / open
 * for breakfast" filters without hitting Disney per request. The forward ~7-day
 * window is re-fetched weekly and stale rows pruned, so this stays bounded.
 */
export const diningSchedule = pgTable(
  "dining_schedule",
  {
    facilityId: text("facility_id")
      .notNull()
      .references(() => restaurantDim.facilityId),
    scheduleDate: date("schedule_date").notNull(),
    scheduleType: text("schedule_type").notNull().default("Operating"),
    startTime: time("start_time").notNull(),
    endTime: time("end_time").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.facilityId, t.scheduleDate, t.scheduleType, t.startTime] }),
    // "what's open on date D" reads scan by date.
    index("dining_schedule_date_idx").on(t.scheduleDate),
  ],
);

/**
 * (F.3) Menu items, enriched weekly by the `dining-facilities` cron from the
 * public `dining/dinemenu/api/menu?searchTerm={facility_id}` feed (numeric id,
 * NOT the slug). Flattened meal-period → group → item; `price` is the first
 * priced entry's `withoutTax` (dollars, nullable for section/description rows).
 *
 * APPEND-ONLY, change-only: each run hashes a venue's menu and writes a NEW
 * generation (all rows stamped with that run's `observed_at`) ONLY when the
 * hash changed vs `dining_menu_snapshot`. So history accrues just when menus
 * actually change. The current menu = the rows whose `observed_at` matches the
 * venue's `dining_menu_snapshot.observed_at` pointer; diffing two generations
 * shows what was added/removed. Surrogate `id` PK — titles repeat within a menu
 * (e.g. duplicate beers, identical lunch/dinner wine lists).
 */
export const diningMenuItem = pgTable(
  "dining_menu_item",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    facilityId: text("facility_id")
      .notNull()
      .references(() => restaurantDim.facilityId),
    // Generation key: the run timestamp this snapshot was captured at.
    observedAt: timestamp("observed_at", { withTimezone: true }).notNull(),
    mealPeriod: text("meal_period").notNull(),
    groupName: text("group_name"),
    itemType: text("item_type"),
    title: text("title").notNull(),
    description: text("description"),
    price: real("price"),
    priceType: text("price_type"),
    currency: text("currency"),
  },
  (t) => [
    index("dining_menu_item_facility_idx").on(t.facilityId, t.observedAt),
    // Trigram index powering omni-search menu-item lookup (search.menuItems).
    // Created out-of-band in drizzle/20260614130000_menu_item_trgm — mirrored
    // here for documentation; we hand-write migrations (no drizzle-kit generate).
    index("dining_menu_item_title_trgm").using("gin", sql`lower(${t.title}) gin_trgm_ops`),
  ],
);

/**
 * (F.4) One row per venue: the current menu generation pointer + the content
 * hash that drives change detection. The cron hashes each venue's fetched menu;
 * on a hash change it writes a new `dining_menu_item` generation and advances
 * `observed_at` here. `last_checked_at` bumps every run (proves liveness even
 * when unchanged); `first_seen_at` is when we first captured a menu.
 */
export const diningMenuSnapshot = pgTable("dining_menu_snapshot", {
  facilityId: text("facility_id")
    .primaryKey()
    .references(() => restaurantDim.facilityId),
  contentHash: text("content_hash").notNull(),
  observedAt: timestamp("observed_at", { withTimezone: true }).notNull(),
  itemCount: integer("item_count").notNull().default(0),
  firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
  lastCheckedAt: timestamp("last_checked_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * (F.5) Price-change log — one row per item whose price moved between two
 * generations. Derived by the cron when a venue's menu changes: items matched
 * by (meal period, group, title, price type) with a differing price emit a
 * delta here. Append-only; powers cheap price-trend queries without diffing
 * full menu generations. New/removed items are NOT logged here (the snapshot
 * generations capture those) — only genuine price moves on persisting items.
 */
export const diningMenuPriceChange = pgTable(
  "dining_menu_price_change",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    facilityId: text("facility_id")
      .notNull()
      .references(() => restaurantDim.facilityId),
    mealPeriod: text("meal_period").notNull(),
    groupName: text("group_name"),
    title: text("title").notNull(),
    oldPrice: real("old_price"),
    newPrice: real("new_price"),
    priceType: text("price_type"),
    currency: text("currency"),
    changedAt: timestamp("changed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("dining_menu_price_change_facility_idx").on(t.facilityId, t.changedAt)],
);

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
    // Retained for single-resort display; `scope` is the canonical selector.
    resortId: text("resort_id").notNull().default(""),
    // Canonical match selector (generalizes resort_id so the alert can target a
    // set of resorts, not just one): '' = any resort, 'r:<id>' = one resort,
    // 't:<tier>' = a resort tier, 'a:<area>' = a resort area. The evaluator
    // resolves a tier/area scope to its resort-id set from RESORT_CATALOG.
    scope: text("scope").notNull().default(""),

    // rule: 1 = becomes_available (fire when any room opens; honours an optional
    //           priceBelow ceiling when set),
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
    uniqueIndex("stay_alert_user_scope_query_uq")
      .on(t.userId, t.scope, t.queryId)
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
  diningEmailOptOut: boolean("dining_email_opt_out").notNull().default(false),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Per-user dining-availability alert subscriptions (the eats analog of
 * `stay_alert`). The dining sweep already polls every priority+bookable venue ×
 * party sizes 1–10 × a rolling day horizon, so — unlike stays — there is no
 * `stay_query`-style frontier to pin: an alert just names what to watch and the
 * evaluator reads the latest `dining_obs` generation directly after each sweep.
 *
 * `facility_id = ''` means "any priority restaurant" (non-null sentinel, same
 * trick as `stay_alert.resort_id`). The date axis is exactly one of:
 *   - `service_date` set → watch that single day, or
 *   - `window_days` set  → watch any day within the next N days.
 * Cap = 3 active per user (no park axis), enforced in the router. Firing carries
 * the same edge-trigger + cooldown state as stay alerts. Delivery is logged +
 * retried EMAIL (see `dining_notification`).
 */
export const diningAlert = pgTable(
  "dining_alert",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    // '' = any priority restaurant; otherwise a restaurant_dim facility id.
    facilityId: text("facility_id").notNull().default(""),
    partySize: smallint("party_size").notNull(),
    // Exactly one of these is set (a CHECK enforces it): a single service date,
    // or a rolling "any day in the next N" window.
    serviceDate: date("service_date"),
    windowDays: smallint("window_days"),
    // 'email' (v1) — the queue + worker accommodate more channels later.
    channel: text("channel").notNull().default("email"),

    // firing state (edge-trigger + cooldown)
    armed: boolean("armed").notNull().default(true),
    lastFiredAt: timestamp("last_fired_at", { withTimezone: true }),
    lastAvailable: boolean("last_available"),

    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("dining_alert_active_facility_idx")
      .on(t.facilityId)
      .where(sql`active`),
    uniqueIndex("dining_alert_user_facility_party_date_uq")
      .on(t.userId, t.facilityId, t.partySize, t.serviceDate, t.windowDays)
      .where(sql`active`),
  ],
);

/** Durable send log for dining-alert delivery — mirror of `notification`. */
export const diningNotification = pgTable(
  "dining_notification",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    alertId: bigint("alert_id", { mode: "number" })
      .notNull()
      .references(() => diningAlert.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    channel: text("channel").notNull(),
    // restaurant, party, matched date(s), rendered subject — enough to render + audit.
    payload: jsonb("payload").notNull(),
    // 'queued' | 'sent' | 'failed'
    status: text("status").notNull(),
    providerMsgId: text("provider_msg_id"),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    sentAt: timestamp("sent_at", { withTimezone: true }),
  },
  (t) => [index("dining_notification_user_created_idx").on(t.userId, t.createdAt.desc())],
);

// ===========================================================================
// Wait-time forecasting (see docs/plans + services/cron-weather, cron-calendar,
// and the out-of-app ml-train/cron-eval pipeline). Postgres is the integration
// boundary: the app only READS from these; the Python model service WRITES
// `queue_forecast` / `model_run` / `forecast_eval` / `model_metrics`.
//
// Hypertable + retention DDL for `weather_obs` / `queue_forecast` /
// `forecast_eval` lives in the custom migration `drizzle/*_forecast_timescale`
// (drizzle-kit can't emit create_hypertable), same pattern as the queue_obs
// hypertable. Plain tables here carry no Timescale DDL.
// ===========================================================================

/**
 * (F1) Per-park weather, both forecast and actual, keyed by the time the
 * weather is FOR (`observed_at`). `kind` separates the forecast we'll have at
 * inference time from the actual used to backtest — train on FORECAST, evaluate
 * against ACTUAL (avoids leakage). One row per (park, kind, hour); the weather
 * cron upserts the latest forecast and appends the current-conditions actual.
 * Hypertable on `observed_at` (7-day chunks), NO retention — this is a feature
 * store. Populated by services/cron-weather from OpenWeather One Call 3.0.
 */
export const weatherObs = pgTable(
  "weather_obs",
  {
    parkId: bigint("park_id", { mode: "number" })
      .notNull()
      .references(() => parks.id),
    observedAt: timestamp("observed_at", { withTimezone: true }).notNull(),
    // 'FORECAST' (predicted, available at inference) | 'ACTUAL' (for backtest)
    kind: text("kind").notNull(),
    tempC: real("temp_c"),
    precipMm: real("precip_mm"),
    // probability of precipitation 0..1 (forecast only; null on actuals)
    precipProb: real("precip_prob"),
    windKph: real("wind_kph"),
    humidity: smallint("humidity"),
    // OpenWeather `weather[0].main`, e.g. 'Rain' | 'Clear' | 'Clouds'
    condition: text("condition"),
    source: smallint("source")
      .notNull()
      .references(() => refSource.id),
  },
  (t) => [primaryKey({ columns: [t.parkId, t.kind, t.observedAt] })],
);

/**
 * (F2) School/holiday calendar — a tiny seeded dimension keyed by region. US
 * federal holidays come from Nager.Date; school breaks are a coarse heuristic
 * for v1 (real per-district calendars need a richer source). `region` matches
 * `park_calendar_map.region`. Populated weekly by services/cron-calendar.
 */
export const calendarDay = pgTable(
  "calendar_day",
  {
    // e.g. 'US' (federal) — finer state/district regions can be added later
    region: text("region").notNull(),
    date: date("date").notNull(),
    isUsFederalHoliday: boolean("is_us_federal_holiday").notNull().default(false),
    isSchoolBreak: boolean("is_school_break").notNull().default(false),
    // e.g. 'Independence Day', 'Summer break', 'Winter break'; null on plain days
    breakLabel: text("break_label"),
  },
  (t) => [primaryKey({ columns: [t.region, t.date] })],
);

/** (F3) Which calendar region each park keys off (one region per park). */
export const parkCalendarMap = pgTable("park_calendar_map", {
  parkId: bigint("park_id", { mode: "number" })
    .primaryKey()
    .references(() => parks.id),
  region: text("region").notNull(),
});

/**
 * (F4) Emitted forecasts: predicted standby wait at `target_ts` for a given
 * `horizon_min` ahead, with a confidence band (`lower`/`upper` from the p10/p90
 * quantile models). Hypertable on `target_ts` (7-day chunks), ~30-day retention
 * (forecasts are disposable). Written by the model service, NOT the app.
 */
export const queueForecast = pgTable(
  "queue_forecast",
  {
    attractionId: bigint("attraction_id", { mode: "number" }).notNull(),
    queueType: smallint("queue_type")
      .notNull()
      .references(() => refQueueType.id),
    targetTs: timestamp("target_ts", { withTimezone: true }).notNull(),
    horizonMin: integer("horizon_min").notNull(),
    predictedWait: real("predicted_wait").notNull(),
    lower: real("lower"),
    upper: real("upper"),
    modelVersion: text("model_version").notNull(),
    generatedAt: timestamp("generated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({
      columns: [t.attractionId, t.queueType, t.horizonMin, t.modelVersion, t.targetTs],
    }),
    index("queue_forecast_target_idx").on(t.attractionId, t.targetTs.desc()),
  ],
);

/** (F5) One row per trained model version (the training-run ledger). */
export const modelRun = pgTable("model_run", {
  modelVersion: text("model_version").primaryKey(),
  trainedAt: timestamp("trained_at", { withTimezone: true }).notNull(),
  trainRows: bigint("train_rows", { mode: "number" }),
  // human label of the feature set used, e.g. 'v1:lags+weather+calendar'
  featureSet: text("feature_set"),
  metricsJson: jsonb("metrics_json"),
  // 'training' | 'active' | 'retired' | 'failed'
  status: text("status").notNull(),
});

/**
 * (F6) Backtest ledger: each emitted forecast joined to the actual wait once
 * `target_ts` is in the past. Powers `model_metrics`. Hypertable on `target_ts`
 * (7-day chunks), ~90-day retention. Written by the eval job, NOT the app.
 */
export const forecastEval = pgTable(
  "forecast_eval",
  {
    modelVersion: text("model_version").notNull(),
    attractionId: bigint("attraction_id", { mode: "number" }).notNull(),
    queueType: smallint("queue_type").notNull(),
    targetTs: timestamp("target_ts", { withTimezone: true }).notNull(),
    horizonMin: integer("horizon_min").notNull(),
    predictedWait: real("predicted_wait").notNull(),
    actualWait: real("actual_wait"),
    absErr: real("abs_err"),
    generatedAt: timestamp("generated_at", { withTimezone: true }).notNull(),
    evaluatedAt: timestamp("evaluated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({
      columns: [t.modelVersion, t.attractionId, t.queueType, t.horizonMin, t.targetTs],
    }),
  ],
);

/**
 * (F7) Rolled-up accuracy per model + window — the numbers the /predictions
 * dashboard tiles read directly (MAE → "±9.8 min", coverage_pct → "% verified",
 * etc.). Plain table (tiny), recomputed by the eval job.
 */
export const modelMetrics = pgTable(
  "model_metrics",
  {
    modelVersion: text("model_version").notNull(),
    // '24h' | '7d' | '30d' | 'all'
    window: text("window").notNull(),
    computedAt: timestamp("computed_at", { withTimezone: true }).notNull().defaultNow(),
    mae: real("mae"),
    rmse: real("rmse"),
    mape: real("mape"),
    r2: real("r2"),
    nPredictions: bigint("n_predictions", { mode: "number" }),
    // evaluated / generated within the window — the "verified coverage" tile
    coveragePct: real("coverage_pct"),
  },
  (t) => [primaryKey({ columns: [t.modelVersion, t.window] })],
);

/**
 * (F8) Serialized model artifact, one row per trained `model_version`. Postgres
 * is the only contract between the (daily) `train` and (15-min) `infer` runs of
 * the Python ml-train service — they run in separate Railway containers with no
 * shared volume, so the booster bundle rides the DB rather than a filesystem.
 * `artifact` is a tar of the three quantile LightGBM `.txt` boosters + a
 * `meta.json` (feature order, categoricals); `format` versions that layout.
 * Written + read ONLY by the model service; the app never touches it.
 */
export const modelArtifact = pgTable("model_artifact", {
  modelVersion: text("model_version")
    .primaryKey()
    .references(() => modelRun.modelVersion),
  // layout of the blob, e.g. 'lgb-quantile-tar-v1'
  format: text("format").notNull(),
  artifact: bytea("artifact").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// Blog — park-news content pipeline
// ---------------------------------------------------------------------------

/**
 * Dedup ledger for pulled park-news RSS items. The `cron-park-news` service
 * records every item it sees (keyed by a hash of the canonical URL) so it only
 * ever sends *new* items to the LLM. `clusteredInto` links an item to the
 * `blog_post` draft it contributed to, for provenance.
 */
export const newsItem = pgTable(
  "news_item",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    source: text("source").notNull(),
    url: text("url").notNull(),
    // sha256(url) — the dedup key (URLs can exceed btree's index size limit).
    urlHash: char("url_hash", { length: 64 }).notNull(),
    title: text("title").notNull(),
    summary: text("summary"),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
    clusteredInto: bigint("clustered_into", { mode: "number" }),
  },
  (t) => [uniqueIndex("news_item_url_hash_uq").on(t.urlHash)],
);

/**
 * Blog posts. LLM-generated drafts land here as `status = 'draft'`; an admin
 * approves them to `'published'` (the only status the public /blog read path
 * serves). `bodyMd` is markdown rendered server-side; `sourceUrls` are the
 * citations to link back to, `parkSlugs` the internal links to weave in.
 */
export const blogPost = pgTable(
  "blog_post",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    slug: text("slug").notNull(),
    title: text("title").notNull(),
    // One-line dek / meta description.
    dek: text("dek").notNull(),
    bodyMd: text("body_md").notNull(),
    // Dense, factual 1–2 sentence summary written for the LLM (not shown to
    // readers). The news cron feeds recent posts' summaries back into the prompt
    // so new drafts don't repeat coverage and can cross-reference prior posts.
    aiSummary: text("ai_summary"),
    // 'draft' | 'published' | 'archived'
    status: text("status").notNull().default("draft"),
    tags: text("tags")
      .array()
      .notNull()
      .default(sql`'{}'`),
    // Park slugs referenced — drives internal links + edge-purge on publish.
    parkSlugs: text("park_slugs")
      .array()
      .notNull()
      .default(sql`'{}'`),
    // [{ title, url }] citations to the source articles.
    sourceUrls: jsonb("source_urls")
      .notNull()
      .default(sql`'[]'::jsonb`),
    heroImageUrl: text("hero_image_url"),
    // Alt text + visible photo credit for the hero image (the cron pulls the
    // source article's OpenGraph image and attributes it back to that source).
    heroImageAlt: text("hero_image_alt"),
    heroImageCredit: text("hero_image_credit"),
    heroImageCreditUrl: text("hero_image_credit_url"),
    // LLM model that drafted it, for auditing.
    model: text("model"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    publishedAt: timestamp("published_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("blog_post_slug_uq").on(t.slug),
    index("blog_post_status_published_idx").on(t.status, t.publishedAt),
  ],
);

// ---------------------------------------------------------------------------
// Pin traders — cold photo identification + trading board.
//
// The reference catalog (pin/pin_image/pin_embedding) is the moat; the trading
// layer (have/want/offer) is the differentiator; pin_scan is the confirmation
// flywheel. Vector search rides on pgvector in this same DB. Tables are created
// by drizzle/*_pin_traders/migration.sql (it owns CREATE EXTENSION + the HNSW
// index, which drizzle's schema DSL can't express); these declarations mirror
// that SQL so the `db` object + query builder are typed.
// ---------------------------------------------------------------------------

/** Reference catalog entry — one canonical pin (a PinPics/eBay/Disney record). */
export const pin = pgTable(
  "pin",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    series: text("series"),
    characters: text("characters")
      .array()
      .notNull()
      .default(sql`'{}'`),
    year: smallint("year"),
    // 'open' | 'LE' | 'LR' | 'cast' | ...
    editionType: text("edition_type"),
    // limited-edition size; null = open edition.
    leCount: integer("le_count"),
    park: text("park"),
    // Estimated value in cents, from eBay sold comps.
    estValueCents: integer("est_value_cents"),
    // 'ebay' | 'pinpics' | 'disney' | 'user' | 'community' — tracked for provenance
    // so a source can be purged wholesale if a license/takedown ever requires it.
    source: text("source").notNull(),
    sourceRef: text("source_ref"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("pin_source_ref_uq")
      .on(t.source, t.sourceRef)
      .where(sql`source_ref IS NOT NULL`),
    index("pin_series_idx").on(t.series),
    index("pin_year_idx").on(t.year),
  ],
);

/** A reference image for a pin (canonical front-facing shot stored in R2). */
export const pinImage = pgTable(
  "pin_image",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    pinId: uuid("pin_id")
      .notNull()
      .references(() => pin.id, { onDelete: "cascade" }),
    r2Key: text("r2_key").notNull(),
    isPrimary: boolean("is_primary").notNull().default(false),
    source: text("source").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("pin_image_pin_idx").on(t.pinId),
    uniqueIndex("pin_image_primary_uq")
      .on(t.pinId)
      .where(sql`is_primary`),
  ],
);

/**
 * CLIP embedding of a reference image. One row per `pin_image`. The HNSW index
 * (`pin_embedding_hnsw`, cosine) is created in the migration; nearest-neighbour
 * lookups run as raw `embedding <=> $1` SQL in the identify worker.
 */
export const pinEmbedding = pgTable("pin_embedding", {
  pinImageId: uuid("pin_image_id")
    .primaryKey()
    .references(() => pinImage.id, { onDelete: "cascade" }),
  pinId: uuid("pin_id")
    .notNull()
    .references(() => pin.id, { onDelete: "cascade" }),
  // open_clip ViT-L/14 = 768-dim.
  embedding: vector("embedding", 768).notNull(),
  // e.g. 'open_clip:ViT-L-14:v1' — track so a re-embed under a new model is safe.
  model: text("model").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** A pin a user owns. `for_trade` is the "available to swap" flag the board reads. */
export const pinHave = pgTable(
  "pin_have",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    pinId: uuid("pin_id")
      .notNull()
      .references(() => pin.id, { onDelete: "cascade" }),
    quantity: smallint("quantity").notNull().default(1),
    // 'mint' | 'near_mint' | 'good' | 'worn' (enforced by a CHECK in the migration).
    condition: text("condition"),
    forTrade: boolean("for_trade").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("pin_have_user_pin_uq").on(t.userId, t.pinId),
    index("pin_have_pin_for_trade_idx")
      .on(t.pinId)
      .where(sql`for_trade`),
  ],
);

/** A pin a user wants. `max_value_cents` is an optional budget ceiling. */
export const pinWant = pgTable(
  "pin_want",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    pinId: uuid("pin_id")
      .notNull()
      .references(() => pin.id, { onDelete: "cascade" }),
    maxValueCents: integer("max_value_cents"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("pin_want_user_pin_uq").on(t.userId, t.pinId),
    index("pin_want_pin_idx").on(t.pinId),
  ],
);

/** A pin-for-pin swap offer between two users. No cash — pins only (see plan). */
export const pinOffer = pgTable(
  "pin_offer",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    fromUserId: text("from_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    toUserId: text("to_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    // [{ pinId, quantity }]
    offeringPins: jsonb("offering_pins").notNull(),
    requestingPins: jsonb("requesting_pins").notNull(),
    message: text("message"),
    // 'pending' | 'accepted' | 'declined' | 'cancelled' | 'expired' (CHECK in migration).
    status: text("status").notNull().default("pending"),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("pin_offer_to_idx").on(t.toUserId, t.status),
    index("pin_offer_from_idx").on(t.fromUserId, t.status),
  ],
);

/**
 * The confirmation flywheel. Every scan logs its photo, the candidates returned,
 * and (once the user confirms) the chosen pin — a labeled (photo, pin) pair that
 * seeds the eventual CLIP fine-tune. `status` drives the client poll: queued →
 * processing → ready (candidates populated) | failed.
 */
export const pinScan = pgTable(
  "pin_scan",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id").references(() => user.id, { onDelete: "set null" }),
    photoR2Key: text("photo_r2_key").notNull(),
    // 'queued' | 'processing' | 'ready' | 'failed' (CHECK in migration).
    status: text("status").notNull().default("queued"),
    // [{ pinId, score, stage }] returned to the user.
    candidates: jsonb("candidates")
      .notNull()
      .default(sql`'[]'::jsonb`),
    chosenPinId: uuid("chosen_pin_id").references(() => pin.id, { onDelete: "set null" }),
    topConfidence: real("top_confidence"),
    // 1..4 — which cascade stage produced the pick.
    stageResolved: smallint("stage_resolved"),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  },
  (t) => [
    index("pin_scan_label_idx")
      .on(t.chosenPinId)
      .where(sql`chosen_pin_id IS NOT NULL`),
    index("pin_scan_user_created_idx").on(t.userId, t.createdAt.desc()),
  ],
);

// ===========================================================================
// Living Layer (M1 + M2) — in-park location/AR game foundation.
//
// SAFETY: these are NEW, ADDITIVE tables. Nothing in the existing application
// reads or writes them, so their presence cannot change current behavior. The
// systems that use them are dark until the worker runs with LIVING_ENABLED=1
// and the UI is gated behind the PostHog `living-layer` feature flag.
// Design: docs/plans/living-layer/ (10-data-model.md for the full rationale).
// ===========================================================================

/** Mark kinds — the polymorphic `mark.type` discriminator. */
export const refMarkType = pgTable("ref_mark_type", {
  code: text("code").primaryKey(),
  label: text("label").notNull(),
});

/** Mark lifecycle state — bloom | active | decaying | faded | claimed. */
export const refMarkState = pgTable("ref_mark_state", {
  code: text("code").primaryKey(),
  label: text("label").notNull(),
});

/** Faded (enemy) archetypes, referenced by encounter payloads. */
export const refFadedType = pgTable("ref_faded_type", {
  code: text("code").primaryKey(),
  label: text("label").notNull(),
  element: text("element"),
});

/**
 * Realm — promotes "land" (today only `attraction_meta.land`) to a first-class
 * geofenced entity, used for party-gating and Realm-tier geofences. `boundary`
 * is seeded from the convex hull of the land's attraction coordinates by
 * `seedRealmsForPark` (filter `category IS NOT NULL` to drop ghost-dup rows).
 */
export const realm = pgTable(
  "realm",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    parkId: bigint("park_id", { mode: "number" })
      .notNull()
      .references(() => parks.id),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    boundary: jsonb("boundary").$type<GeoPolygon>(),
    element: text("element"),
    themeColor: text("theme_color"),
  },
  (t) => [uniqueIndex("realm_park_slug_idx").on(t.parkId, t.slug)],
);

/** A snapshot of live park state captured when a mark was created. */
export type LiveStateSnapshot = {
  standbyMin?: number | null;
  status?: string | null;
  crowdIndex?: number | null;
  weather?: string | null;
  capturedAt: string;
};

/** Typed per `mark.type` at the edge; stored loosely as jsonb. */
export type MarkPayload = Record<string, unknown>;

/**
 * Mark — THE atomic unit of the Living Layer. Every geo-anchored thing
 * (discovery pins, collectibles, the live "Dimming", encounters, companions,
 * memories) is a row here; `type` selects the shape of `payload`. See
 * docs/plans/living-layer/03-marks-and-discovery.md.
 */
export const mark = pgTable(
  "mark",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    type: text("type")
      .notNull()
      .references(() => refMarkType.code),
    authorUserId: text("author_user_id").references(() => user.id),
    isSystem: boolean("is_system").notNull().default(false),
    parkId: bigint("park_id", { mode: "number" })
      .notNull()
      .references(() => parks.id),
    realmId: bigint("realm_id", { mode: "number" }).references(() => realm.id),
    attractionId: bigint("attraction_id", { mode: "number" }).references(() => attractions.id),
    latitude: doublePrecision("latitude"),
    longitude: doublePrecision("longitude"),
    anchorKey: text("anchor_key"),
    payload: jsonb("payload").$type<MarkPayload>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    liveStateSnapshot: jsonb("live_state_snapshot").$type<LiveStateSnapshot>(),
    state: text("state")
      .notNull()
      .default("active")
      .references(() => refMarkState.code),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    findCount: integer("find_count").notNull().default(0),
    upvoteCount: integer("upvote_count").notNull().default(0),
    reportCount: integer("report_count").notNull().default(0),
  },
  (t) => [
    index("mark_park_state_idx").on(t.parkId, t.state),
    index("mark_realm_type_idx").on(t.realmId, t.type),
    index("mark_attraction_idx").on(t.attractionId),
    index("mark_expires_idx").on(t.expiresAt),
  ],
);

/**
 * Resolved Faded battles (M4a). Append-only history feeding the logbook (M6)
 * and economy tuning. Plain table for now; promotable to a Timescale hypertable
 * later if volume warrants.
 */
export const encounterLog = pgTable(
  "encounter_log",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    userId: text("user_id").references(() => user.id),
    markId: bigint("mark_id", { mode: "number" }).references(() => mark.id),
    parkId: bigint("park_id", { mode: "number" }).references(() => parks.id),
    attractionId: bigint("attraction_id", { mode: "number" }).references(() => attractions.id),
    fadedType: text("faded_type").references(() => refFadedType.code),
    outcome: text("outcome").notNull(),
    liveStateSnapshot: jsonb("live_state_snapshot").$type<LiveStateSnapshot>(),
    ts: timestamp("ts", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("encounter_log_user_ts_idx").on(t.userId, t.ts),
    index("encounter_log_mark_idx").on(t.markId),
  ],
);

/** Per-user game profile (M5). 1:1 with `user`; created on first progression. */
export const warden = pgTable("warden", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id),
  displayName: text("display_name"),
  rank: integer("rank").notNull().default(1),
  xp: integer("xp").notNull().default(0),
  homeParkId: bigint("home_park_id", { mode: "number" }).references(() => parks.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Companion catalog (M5) — recruitable allies bound to a realm + a signature ride. */
export type CompanionStats = { hp?: number; atk?: number; def?: number; spd?: number };

export const companion = pgTable(
  "companion",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    homeRealmId: bigint("home_realm_id", { mode: "number" }).references(() => realm.id),
    signatureAttractionId: bigint("signature_attraction_id", { mode: "number" }).references(
      () => attractions.id,
    ),
    name: text("name").notNull(),
    slug: text("slug").notNull().unique(),
    element: text("element"),
    role: text("role"),
    baseStats: jsonb("base_stats").$type<CompanionStats>().notNull().default({}),
    imageR2Key: text("image_r2_key"),
  },
  (t) => [index("companion_home_realm_idx").on(t.homeRealmId)],
);

/** A user's recruited roster (M5). */
export const wardenCompanion = pgTable(
  "warden_companion",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id),
    companionId: bigint("companion_id", { mode: "number" })
      .notNull()
      .references(() => companion.id),
    level: integer("level").notNull().default(1),
    xp: integer("xp").notNull().default(0),
    recruitedAt: timestamp("recruited_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.companionId] })],
);

/** Reactions on a mark — found / upvote / report (moderation + flywheel). */
export const markReaction = pgTable(
  "mark_reaction",
  {
    markId: bigint("mark_id", { mode: "number" })
      .notNull()
      .references(() => mark.id),
    userId: text("user_id")
      .notNull()
      .references(() => user.id),
    kind: text("kind").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.markId, t.userId, t.kind] })],
);
