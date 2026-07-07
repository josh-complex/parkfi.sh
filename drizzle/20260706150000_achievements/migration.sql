-- ============================================================================
-- Levels & achievements — engagement telemetry and unlocks.
--
-- SAFETY: purely additive. Four new tables, all FKs point at the existing
-- `user` / `parks` tables with ON DELETE CASCADE on the user side; nothing
-- existing is touched.
--
--   user_park_day     one row per user × park × park-local day. All geo
--                     achievement stats (distance, queue time, rope drops,
--                     streaks, …) are aggregated from these at evaluation
--                     time — nothing here is pre-rolled up.
--   user_geo_state    last-ping cursor per user; powers distance deltas and
--                     the queue-dwell state machine between pings.
--   user_stat         event counters with no day/park dimension (pin scans,
--                     alert creations, menu views, forecast views, searches).
--   user_achievement  unlocked tiers. achievement_id is a catalog tier id
--                     (e.g. "walker.3") — names/thresholds/XP live in code
--                     (src/lib/achievements.ts), never in the DB.
--
-- Deliberately independent of the Living Layer tables/modules.
-- ============================================================================

CREATE TABLE IF NOT EXISTS "user_park_day" (
  "user_id"        text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "park_id"        bigint NOT NULL REFERENCES "parks"("id"),
  "day"            date NOT NULL,
  "first_seen_at"  timestamptz NOT NULL DEFAULT now(),
  "last_seen_at"   timestamptz NOT NULL DEFAULT now(),
  "pings"          integer NOT NULL DEFAULT 0,
  "distance_m"     double precision NOT NULL DEFAULT 0,
  "queue_seconds"  integer NOT NULL DEFAULT 0,
  "rides"          integer NOT NULL DEFAULT 0,
  "rope_drop"      boolean NOT NULL DEFAULT false,
  "night_owl"      boolean NOT NULL DEFAULT false,
  "rainy"          boolean NOT NULL DEFAULT false,
  PRIMARY KEY ("user_id", "park_id", "day")
);
CREATE INDEX IF NOT EXISTS "user_park_day_user_idx" ON "user_park_day" ("user_id");

CREATE TABLE IF NOT EXISTS "user_geo_state" (
  "user_id"              text PRIMARY KEY REFERENCES "user"("id") ON DELETE CASCADE,
  "park_id"              bigint,
  "lng"                  double precision,
  "lat"                  double precision,
  "at"                   timestamptz,
  "anchor_attraction_id" bigint,
  "anchor_since"         timestamptz,
  "anchor_seconds"       integer NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS "user_stat" (
  "user_id"    text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "stat"       text NOT NULL,
  "value"      double precision NOT NULL DEFAULT 0,
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("user_id", "stat")
);

CREATE TABLE IF NOT EXISTS "user_achievement" (
  "user_id"        text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "achievement_id" text NOT NULL,
  "unlocked_at"    timestamptz NOT NULL DEFAULT now(),
  "notified_at"    timestamptz,
  PRIMARY KEY ("user_id", "achievement_id")
);
CREATE INDEX IF NOT EXISTS "user_achievement_user_idx" ON "user_achievement" ("user_id");
