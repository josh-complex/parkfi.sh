-- ============================================================================
-- Living Layer (M1 + M2) — in-park location/AR game foundation.
--
-- SAFETY: this migration is PURELY ADDITIVE. It only CREATEs new tables and
-- seeds new ref rows. It does NOT alter, drop, or touch any existing table,
-- column, index, or constraint. Nothing in the current application reads these
-- tables, so applying this migration cannot change existing behavior — the
-- app keeps working exactly as before. The new systems are dark until the
-- worker is run with LIVING_ENABLED=1 and the UI is shown behind the PostHog
-- `living-layer` flag.
--
-- Convention: hand-written timestamped migration (no _journal.json, no
-- drizzle-kit generate) — see docs/plans/living-layer/14-implementation-plan.md.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- ref_* lookup/code tables
-- ---------------------------------------------------------------------------

-- mark kinds — the polymorphic `mark.type` discriminator.
CREATE TABLE IF NOT EXISTS "ref_mark_type" (
  "code"  text PRIMARY KEY,
  "label" text NOT NULL
);
INSERT INTO "ref_mark_type" ("code", "label") VALUES
  ('discovery',  'User-defined discovery pin'),
  ('dare',       'Player-left micro-challenge'),
  ('world',      'System narrative beacon (live-state driven)'),
  ('collectible','System-seeded collectible'),
  ('companion',  'Recruitable companion node'),
  ('encounter',  'Spawned battle encounter'),
  ('memory',     'Personal pinned memory')
ON CONFLICT ("code") DO NOTHING;

-- mark lifecycle state.
CREATE TABLE IF NOT EXISTS "ref_mark_state" (
  "code"  text PRIMARY KEY,
  "label" text NOT NULL
);
INSERT INTO "ref_mark_state" ("code", "label") VALUES
  ('bloom',    'Just appeared'),
  ('active',   'Live and interactable'),
  ('decaying', 'Fading out'),
  ('faded',    'Expired'),
  ('claimed',  'Resolved by a player')
ON CONFLICT ("code") DO NOTHING;

-- faded (enemy) archetypes, referenced by encounter payloads.
CREATE TABLE IF NOT EXISTS "ref_faded_type" (
  "code"    text PRIMARY KEY,
  "label"   text NOT NULL,
  "element" text
);
INSERT INTO "ref_faded_type" ("code", "label", "element") VALUES
  ('shade',   'Shade',   'dark'),
  ('wisp',    'Wisp',    'light'),
  ('breaker', 'Breaker', 'dark')
ON CONFLICT ("code") DO NOTHING;

-- ---------------------------------------------------------------------------
-- realm — promotes "land" (attraction_meta.land) to a first-class geofenced
-- entity. Seeded by services/living seedRealmsForPark from the convex hull of
-- each land's attraction coordinates.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "realm" (
  "id"          bigserial PRIMARY KEY,
  "park_id"     bigint NOT NULL REFERENCES "parks"("id"),
  "name"        text NOT NULL,
  "slug"        text NOT NULL,
  "boundary"    jsonb,
  "element"     text,
  "theme_color" text
);
CREATE UNIQUE INDEX IF NOT EXISTS "realm_park_slug_idx" ON "realm" ("park_id", "slug");

-- ---------------------------------------------------------------------------
-- mark — THE atomic unit. One polymorphic table; `type` selects payload shape.
-- See docs/plans/living-layer/03-marks-and-discovery.md and 10-data-model.md.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "mark" (
  "id"                  bigserial PRIMARY KEY,
  "type"                text NOT NULL REFERENCES "ref_mark_type"("code"),
  "author_user_id"      text REFERENCES "user"("id"),
  "is_system"           boolean NOT NULL DEFAULT false,
  "park_id"             bigint NOT NULL REFERENCES "parks"("id"),
  "realm_id"            bigint REFERENCES "realm"("id"),
  "attraction_id"       bigint REFERENCES "attractions"("id"),
  "latitude"            double precision,
  "longitude"           double precision,
  "anchor_key"          text,
  "payload"             jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at"          timestamptz NOT NULL DEFAULT now(),
  "live_state_snapshot" jsonb,
  "state"               text NOT NULL DEFAULT 'active' REFERENCES "ref_mark_state"("code"),
  "expires_at"          timestamptz,
  "find_count"          integer NOT NULL DEFAULT 0,
  "upvote_count"        integer NOT NULL DEFAULT 0,
  "report_count"        integer NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS "mark_park_state_idx"   ON "mark" ("park_id", "state");
CREATE INDEX IF NOT EXISTS "mark_realm_type_idx"   ON "mark" ("realm_id", "type");
CREATE INDEX IF NOT EXISTS "mark_attraction_idx"   ON "mark" ("attraction_id");
CREATE INDEX IF NOT EXISTS "mark_expires_idx"      ON "mark" ("expires_at");
-- The Dimming engine keeps at most one active system mark per (attraction, type);
-- this partial unique index makes its idempotent upsert safe and cheap.
CREATE UNIQUE INDEX IF NOT EXISTS "mark_active_system_attraction_type_idx"
  ON "mark" ("attraction_id", "type")
  WHERE "is_system" = true AND "state" = 'active' AND "attraction_id" IS NOT NULL;

-- ---------------------------------------------------------------------------
-- mark_reaction — finds / upvotes / reports (moderation + discovery flywheel).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "mark_reaction" (
  "mark_id"    bigint NOT NULL REFERENCES "mark"("id"),
  "user_id"    text NOT NULL REFERENCES "user"("id"),
  "kind"       text NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("mark_id", "user_id", "kind")
);
