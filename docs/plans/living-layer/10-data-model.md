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
// mark kinds — discovery (the echo) | trinity | emblem | letter | world |
// collectible | companion | encounter
// (2026-07-16: `dare` cut; `memory` folded into discovery via mark.visibility)
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

    // typed content — discovery/echo: {resonance, note?, photoR2Key?};
    // trinity: {} (placement-only, zero user content); emblem: {photoR2Key,
    // status: pending|confirmed}; letter: {toUserId, note}; collectible:
    // {heartlessType, rarity, rewardTable}; world: {sourceEvent, attractionId};
    // companion: {companionId}
    payload: jsonb("payload").$type<MarkPayload>().notNull().default({}),

    // echo/memory unification (2026-07-16): an echo never fades for its
    // author — `public` rows are the world's ambience, `private` rows are the
    // author's memories; one row, one flag (absorbs the old `memory` type)
    visibility: text("visibility").notNull().default("public"), // public | private

    // moment — when + a snapshot of live park state at creation
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    liveStateSnapshot: jsonb("live_state_snapshot").$type<LiveStateSnapshot>(),

    // lifecycle (the decay knob)
    state: text("state")
      .notNull()
      .default("active")
      .references(() => refMarkState.code),
    expiresAt: timestamp("expires_at", { withTimezone: true }), // null = permanent (private memories, confirmed emblems)

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
    kind: text("kind").notNull(), // found | upvote (UI: resonate) | report
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.markId, t.userId, t.kind] })],
);
```

## `mark_participant` — participation in a shared mark (2026-07-16)

Trinity weaves and emblem confirmations are the same shape — doc
[03](03-marks-and-discovery.md)'s one-primitive spirit applied to
_participation_. "Who awakened this Trinity, and how" and "who confirmed this
emblem" are answered by one table.

```ts
export const markParticipant = pgTable(
  "mark_participant",
  {
    markId: bigint("mark_id", { mode: "number" })
      .notNull()
      .references(() => mark.id),
    // the wielder acting; companion stand-ins carry the summoning wielder's id
    userId: text("user_id")
      .notNull()
      .references(() => user.id),
    // planter | woven | witness | confirmer | companion
    role: text("role").notNull(),
    // set only for role=companion (a fielded party member standing in)
    companionId: bigint("companion_id", { mode: "number" }).references(() => companion.id),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
    // presence provenance (geofence dwell now; the M5b primitive later)
    verification: jsonb("verification").$type<PresenceSignals>(),
  },
  (t) => [
    primaryKey({ columns: [t.markId, t.userId, t.role] }),
    index("mark_participant_user_idx").on(t.userId),
  ],
);
```

> A trinity **awakens** when three distinct hearts are woven (wielders, or a
> woven wielder's fielded companions after ~72 h dormancy, at reduced XP — GDD
> §3.7); an emblem **confirms** at three distinct `confirmer` rows. Same-moment
> completions are verifiable purely from `at` timestamps (the tier-3 "sealed
> together" bond input).

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

// battle integrity (2026-07-16): a session row created at startEncounter.
// Pins the loadout so equip-after-fight can't retro-buff a submitted move
// list; holds the in-progress move list for pocket-safe resume; expiry = flee.
export const encounterSession = pgTable(
  "encounter_session",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id),
    markId: bigint("mark_id", { mode: "number" })
      .notNull()
      .references(() => mark.id),
    // pinned at start; server replay resolves with THESE, never current state
    keybladeId: bigint("keyblade_id", { mode: "number" }).references(() => keyblade.id),
    keybladeLevel: integer("keyblade_level"),
    fieldParty: jsonb("field_party").$type<FieldPartySnapshot>(),
    // the client's submitted moves — replayed server-side (anti-cheat) AND the
    // witness for battle-shaped Journal verdicts (flawless / surge-less)
    moveList: jsonb("move_list").$type<BattleMove[]>(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  },
  (t) => [index("encounter_session_user_idx").on(t.userId, t.startedAt)],
);

// resolved battles (analytics + economy tuning + THE Journal substrate)
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
    // 2026-07-16: stamped AT RESOLVE, not copied from spawn — attraction
    // status, weather condition, park-local hour as they were when the seal
    // landed. Makes world-shaped Journal conditions a pure function of the
    // log row forever, independent of obs retention. Ships FIRST (GDD §4.2).
    resolveSnapshot: jsonb("resolve_snapshot").$type<LiveStateSnapshot>(),
    // battle-shaped verdicts from the server replay (flawless, surgeless, …)
    verdicts: jsonb("verdicts").$type<Record<string, boolean>>(),
    // the deterministic computed drop, recorded for audit (GDD §4.4)
    drop: jsonb("drop").$type<Record<string, number>>(),
    ts: timestamp("ts", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("encounter_user_ts_idx").on(t.userId, t.ts)],
); // hypertable, retention
```

## The progression spine (2026-07-16 — Journal, materials)

Built as the architectural **sibling of the shipped ParkFi achievements
engine** (`src/lib/achievements.ts` + `src/server/achievements/engine.ts`),
never a fork of it: **catalog in code** (pages, condition entries, thresholds,
XP live in a `JOURNAL` catalog next to `ACHIEVEMENTS` — content ships in a
deploy, not a migration), pure aggregates over `encounter_log`, a closed-set
reconcile, and sticky idempotent unlocks. The DB stores only what a user has
unlocked. (There is deliberately **no** `achievement_def` / catalog table —
that earlier sketch is superseded; the shipped engine proved catalog-in-code.)

```ts
// sticky Journal unlocks — the user_achievement mirror. Insert
// onConflictDoNothing; never deleted (admin revoke only); retroactive by
// construction (add a catalog entry later, history satisfies it instantly).
export const journalEntry = pgTable(
  "journal_entry",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id),
    // catalog entry id, e.g. "breaker.first" | "breaker.tally_50" |
    // "breaker.cond_ridedown" | "world_<slug>.emblem_page" | "trinity.awakened_party"
    entryId: text("entry_id").notNull(),
    unlockedAt: timestamp("unlocked_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.entryId] })],
);

// the forge's material ledger (GDD §4.4) — keys are element × tier
// (shard | stone | gem) plus `husk` (Nobody-only) and `thread`
// (incursion-only). Recipes are code; no currency in v1.
export const wielderMaterial = pgTable(
  "wielder_material",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id),
    material: text("material").notNull(),
    qty: integer("qty").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.userId, t.material] })],
);
```

> **The two-ledger boundary (canon):** civilian ParkFi levels/achievements and
> Wielder rank/Journal are permanently separate systems — shared substrate
> (obs tables, pure `lib/` helpers), never shared modules; crosstalk through
> rows only (GDD Canon Log 2026-07-16;
> [08](08-achievements-persistence-coldstart.md) Part A). Emblem pages and
> trinity ticks are Journal entry _types_, not separate systems.
>
> **World light needs no table:** it is a derived, cached aggregate over
> existing rows (seal timestamps from `encounter_log`, echo/resonance rows) —
> zero new writes. If history is ever needed, a `world_light_obs` hypertable
> follows the repo's obs idiom.

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
// the integrity artifact AND the battle-shaped Journal witness (one structure)
export type BattleMove = {
  verb: "strike" | "surge" | "guard";
  timing?: "good" | "perfect";
  at: number;
};
export type FieldPartySnapshot = Array<{
  companionId: number;
  level: number;
  tier: "home" | "guest" | "away";
}>;
```

## Migration note

Per project convention (`drizzle-migration-convention` in memory): **hand-write
a timestamped `migration.sql` folder; no `_journal.json`; do not use
`drizzle-kit generate`.** The hypertable + retention declarations
(`create_hypertable`, `add_retention_policy`) for `presence_event` and
`encounter_log` go in that hand-written SQL, exactly as the existing `queue_obs`
/ `weather_obs` migrations do.

## How it hangs off the existing schema

| New table                                                                               | Anchored to existing                                                                         |
| --------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `world`                                                                                 | `parks`; seeded from `attraction_meta.land`                                                  |
| `mark`, `mark_reaction`, `mark_participant`                                             | `parks`, `world`, `attractions`, `user`                                                      |
| `wielder`, `wielder_companion`, `wielder_keyblade`, `journal_entry`, `wielder_material` | `user` (Better-Auth)                                                                         |
| `companion`                                                                             | `world`, `attractions`                                                                       |
| `presence_event`, `encounter_session`, `encounter_log`                                  | `user`, `parks`, `attractions` — driven by the live `queue_obs`/`attraction_status_obs` feed |
| `seal_state`                                                                            | `world`, `user`                                                                              |
