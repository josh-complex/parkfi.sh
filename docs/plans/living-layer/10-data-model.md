# 10 — Data model

> **Theme:** The Living Layer is a thin set of new tables hanging off the schema
> we already have. The center of gravity is **one polymorphic `mark` table** (the
> atomic unit), a **`world` table** that promotes "land" to first-class with a
> geofence, and a small cluster of **game-save tables** keyed to `user`. Follows
> the existing `src/db/schema.ts` conventions exactly: `bigserial` PKs,
> snake_case table names + camelCase exports, `jsonb().$type<>()`, explicit
> indexes, and Timescale retention on the high-churn fact tables.

## Conventions (matching the existing schema)

- `bigserial("id", { mode: "number" }).primaryKey()` for dimension PKs.
- `bigint(...).references(() => other.id)` for FKs; `user` imported from
  `./auth-schema.ts`.
- Geo polygons reuse the existing `GeoPolygon` type from `schema.ts`.
- High-churn append-only tables become **Timescale hypertables** with retention
  (same pattern as `queue_obs`, `weather_obs`), declared in the hand-written
  migration (see [migration note](#migration-note)).
- Lookup/code tables follow the `ref_*` pattern (`ref_queue_type`, etc.).

## New `ref_*` lookup tables

```ts
// mark kinds — discovery | dare | world | collectible | companion | encounter | memory
export const refMarkType = pgTable("ref_mark_type", {
  code: text("code").primaryKey(),
  label: text("label").notNull(),
});

// Heartless archetypes, used by encounter payloads
export const refHeartlessType = pgTable("ref_heartless_type", {
  code: text("code").primaryKey(),
  label: text("label").notNull(),
  element: text("element"), // for affinity vs Key/Companion
});

// mark lifecycle state — bloom | active | decaying | faded | claimed
export const refMarkState = pgTable("ref_mark_state", {
  code: text("code").primaryKey(),
  label: text("label").notNull(),
});
```

## `world` — promote "land" to a first-class geofenced entity

Today "land" lives only as `attraction_meta.land` (text). The Living Layer needs
it as a real entity with a boundary polygon for party-gating
([05](05-companions-and-proximity.md)) and World-tier geofences
([06](06-location-and-geofencing.md)).

```ts
export const world = pgTable(
  "world",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    parkId: bigint("park_id", { mode: "number" })
      .notNull()
      .references(() => parks.id),
    // canonical land name, sourced from attraction_meta.land (deduped per park)
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    // GeoJSON polygon — seeded from the convex hull of the land's attraction
    // coordinates (filter `category IS NOT NULL` to drop ghost-dup rows), refined
    // later from OSM land boundaries. Reuses the GeoPolygon type from schema.ts.
    boundary: jsonb("boundary").$type<GeoPolygon>(),
    // the Darkness flavor / element this World leans toward (affinity)
    element: text("element"),
    themeColor: text("theme_color"),
  },
  (t) => [uniqueIndex("world_park_slug_idx").on(t.parkId, t.slug)],
);
```

## `mark` — the atomic unit (polymorphic, one table)

The single most important table. Every geo-anchored thing is a row here; `type`
selects the shape of `payload`. See [03](03-marks-and-discovery.md) for the
anatomy and taxonomy.

```ts
export const mark = pgTable(
  "mark",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    type: text("type")
      .notNull()
      .references(() => refMarkType.code),
    // author — null/SYSTEM for world/collectible/encounter/companion marks
    authorUserId: text("author_user_id").references(() => user.id),
    isSystem: boolean("is_system").notNull().default(false),

    // anchor — coarse to fine; at least one of (attractionId, worldId, lat/lng)
    parkId: bigint("park_id", { mode: "number" })
      .notNull()
      .references(() => parks.id),
    worldId: bigint("world_id", { mode: "number" }).references(() => world.id),
    attractionId: bigint("attraction_id", { mode: "number" }).references(() => attractions.id),
    latitude: doublePrecision("latitude"),
    longitude: doublePrecision("longitude"),
    // optional landmark anchor key for image-anchored AR (CLIP, reused from pins)
    anchorKey: text("anchor_key"),

    // typed content — discovery: {note, photoR2Key}; collectible: {heartlessType,
    // rarity, rewardTable}; world: {sourceEvent, attractionId}; dare: {text};
    // companion: {companionId}; memory: {visitId, snapshot}
    payload: jsonb("payload").$type<MarkPayload>().notNull().default({}),

    // moment — when + a snapshot of live park state at creation
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    liveStateSnapshot: jsonb("live_state_snapshot").$type<LiveStateSnapshot>(),

    // lifecycle (the decay knob)
    state: text("state")
      .notNull()
      .default("active")
      .references(() => refMarkState.code),
    expiresAt: timestamp("expires_at", { withTimezone: true }), // null = permanent (memory)

    // quality / social signal
    findCount: integer("find_count").notNull().default(0),
    upvoteCount: integer("upvote_count").notNull().default(0),
    reportCount: integer("report_count").notNull().default(0),
  },
  (t) => [
    // primary spatial query: live marks near a point in a park
    index("mark_park_state_idx").on(t.parkId, t.state),
    index("mark_world_type_idx").on(t.worldId, t.type),
    index("mark_attraction_idx").on(t.attractionId),
    index("mark_expires_idx").on(t.expiresAt),
  ],
);
```

> Spatial note: for launch, bounding-box prefilter on `latitude`/`longitude` +
> the indexes above is sufficient at park scale. If proximity queries get hot,
> add PostGIS or a geohash column — but don't reach for it on day one.

## `mark_reaction` — finds / upvotes / reports (moderation + flywheel)

```ts
export const markReaction = pgTable(
  "mark_reaction",
  {
    markId: bigint("mark_id", { mode: "number" })
      .notNull()
      .references(() => mark.id),
    userId: text("user_id")
      .notNull()
      .references(() => user.id),
    kind: text("kind").notNull(), // found | upvote | report
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.markId, t.userId, t.kind] })],
);
```

## Game-save tables (keyed to `user`)

### `wielder` — the player's game profile (1:1 with `user`)

```ts
export const wielder = pgTable("wielder", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id),
  displayName: text("display_name"),
  rank: integer("rank").notNull().default(1),
  xp: integer("xp").notNull().default(0),
  activeKeyId: bigint("active_key_id", { mode: "number" }),
  // home park for cross-park "Away" tier penalties ([05])
  homeParkId: bigint("home_park_id", { mode: "number" }).references(() => parks.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
```

### `companion` — Companion catalog (dimension, bound to a World)

```ts
export const companion = pgTable(
  "companion",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    // Disney-character party member; home World gates recruit + affinity ([05])
    homeWorldId: bigint("home_world_id", { mode: "number" }).references(() => world.id),
    // the signature attraction whose quest recruits this companion
    signatureAttractionId: bigint("signature_attraction_id", {
      mode: "number",
    }).references(() => attractions.id),
    name: text("name").notNull(),
    slug: text("slug").notNull().unique(),
    element: text("element"),
    role: text("role"), // attacker | support | etc.
    baseStats: jsonb("base_stats").$type<CompanionStats>().notNull(),
    imageR2Key: text("image_r2_key"),
  },
  (t) => [index("companion_world_idx").on(t.homeWorldId)],
);
```

### `wielder_companion` — the roster (who you've recruited)

```ts
export const wielderCompanion = pgTable(
  "wielder_companion",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id),
    companionId: bigint("companion_id", { mode: "number" })
      .notNull()
      .references(() => companion.id),
    level: integer("level").notNull().default(1),
    xp: integer("xp").notNull().default(0),
    // mastery: bitmask/flags of conditions cleared (day/night/rain/down) ([04])
    masteryFlags: integer("mastery_flags").notNull().default(0),
    recruitedAt: timestamp("recruited_at", { withTimezone: true }).notNull().defaultNow(),
    // verified-presence provenance for the recruit (anti-spoof)
    recruitPresenceId: bigint("recruit_presence_id", { mode: "number" }),
  },
  (t) => [primaryKey({ columns: [t.userId, t.companionId] })],
);
```

> The **fieldable party** is _not_ stored — it's a pure function of
> `(roster, current World, rank)` computed client-side and validated
> server-side ([05](05-companions-and-proximity.md)).

### `keyblade` + `wielder_keyblade` — gear & synthesis

```ts
export const keyblade = pgTable("keyblade", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  themeWorldId: bigint("theme_world_id", { mode: "number" }).references(() => world.id),
  baseStats: jsonb("base_stats").$type<KeyStats>().notNull(),
});

export const wielderKeyblade = pgTable(
  "wielder_keyblade",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id),
    keybladeId: bigint("keyblade_id", { mode: "number" })
      .notNull()
      .references(() => keyblade.id),
    level: integer("level").notNull().default(1),
    acquiredAt: timestamp("acquired_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.keybladeId] })],
);
```

### `seal_state` — World control points

```ts
export const sealState = pgTable(
  "seal_state",
  {
    worldId: bigint("world_id", { mode: "number" })
      .notNull()
      .references(() => world.id),
    // the day this seal applies to — canon: a seal = every active wound in the
    // World cleared while darkness presses; first seal grants its keychain (GDD §4.3)
    sealDate: date("seal_date").notNull(),
    sealedByUserId: text("sealed_by_user_id").references(() => user.id),
    progress: integer("progress").notNull().default(0), // 0..100
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.worldId, t.sealDate] })],
);
```

## Verified-presence ledger & game events (Timescale hypertables)

High-churn, append-only — make them hypertables with retention, same as
`queue_obs`.

```ts
// every verified presence event (the anti-cheat currency, [06])
export const presenceEvent = pgTable(
  "presence_event",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id),
    parkId: bigint("park_id", { mode: "number" })
      .notNull()
      .references(() => parks.id),
    worldId: bigint("world_id", { mode: "number" }).references(() => world.id),
    attractionId: bigint("attraction_id", { mode: "number" }).references(() => attractions.id),
    kind: text("kind").notNull(), // enter_park | enter_world | at_attraction | ride_verified
    // fused-signal confidence + which signals agreed (gps/motion/dwell/live)
    confidence: real("confidence").notNull(),
    signals: jsonb("signals").$type<PresenceSignals>().notNull(),
    ts: timestamp("ts", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("presence_user_ts_idx").on(t.userId, t.ts)],
); // hypertable, ~30–90d retention

// resolved battles/captures (analytics + economy tuning)
export const encounterLog = pgTable(
  "encounter_log",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id),
    markId: bigint("mark_id", { mode: "number" }).references(() => mark.id),
    heartlessType: text("heartless_type").references(() => refHeartlessType.code),
    outcome: text("outcome").notNull(), // win | flee | loss
    // the live state that drove this spawn (proves the Darkness hook, [04])
    liveStateSnapshot: jsonb("live_state_snapshot").$type<LiveStateSnapshot>(),
    ts: timestamp("ts", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("encounter_user_ts_idx").on(t.userId, t.ts)],
); // hypertable, retention
```

## Achievements

```ts
export const achievementDef = pgTable("achievement_def", {
  code: text("code").primaryKey(),
  label: text("label").notNull(),
  description: text("description"),
  category: text("category").notNull(), // motion | live_gated | mastery | discovery | collection | social | secret
  isSecret: boolean("is_secret").notNull().default(false),
});

export const wielderAchievement = pgTable(
  "wielder_achievement",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id),
    code: text("code")
      .notNull()
      .references(() => achievementDef.code),
    earnedAt: timestamp("earned_at", { withTimezone: true }).notNull().defaultNow(),
    // provenance: the presence/encounter rows that verified it (unfakeable, [08])
    evidence: jsonb("evidence").$type<AchievementEvidence>(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.code] })],
);
```

## TypeScript payload types (co-located, like `GeoPolygon`)

```ts
export type LiveStateSnapshot = {
  standbyMin?: number;
  status?: string; // OPERATING | DOWN | ...
  crowdIndex?: number;
  weather?: string;
  capturedAt: string;
};
export type MarkPayload = Record<string, unknown>; // narrowed per type at the edge
export type PresenceSignals = {
  gps?: { lat: number; lng: number; acc: number };
  motion?: string;
  dwellSec?: number;
  liveAgrees?: boolean;
};
export type CompanionStats = { hp: number; atk: number; def: number; spd: number };
export type KeyStats = { atk: number; element?: string };
export type AchievementEvidence = { presenceIds?: number[]; encounterIds?: number[] };
```

## Migration note

Per project convention (`drizzle-migration-convention` in memory): **hand-write
a timestamped `migration.sql` folder; no `_journal.json`; do not use
`drizzle-kit generate`.** The hypertable + retention declarations
(`create_hypertable`, `add_retention_policy`) for `presence_event` and
`encounter_log` go in that hand-written SQL, exactly as the existing `queue_obs`
/ `weather_obs` migrations do.

## How it hangs off the existing schema

| New table                                                                 | Anchored to existing                                                                         |
| ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `world`                                                                   | `parks`; seeded from `attraction_meta.land`                                                  |
| `mark`                                                                    | `parks`, `world`, `attractions`, `user`                                                      |
| `wielder`, `wielder_companion`, `wielder_keyblade`, `wielder_achievement` | `user` (Better-Auth)                                                                         |
| `companion`                                                               | `world`, `attractions`                                                                       |
| `presence_event`, `encounter_log`                                         | `user`, `parks`, `attractions` — driven by the live `queue_obs`/`attraction_status_obs` feed |
| `seal_state`                                                              | `world`, `user`                                                                              |
