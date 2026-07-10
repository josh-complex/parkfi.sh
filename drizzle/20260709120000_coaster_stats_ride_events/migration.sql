-- ============================================================================
-- Coaster achievements: static per-coaster stats + per-ride event log.
--
-- coaster_stats: 1:1 enrichment side table on attractions (attraction_meta
-- precedent) — published figures (track length, official top speed, drops,
-- inversions). Sparse: only coasters get rows. Seeded manually (services/
-- coaster-stats); RCDB has no API.
--
-- user_ride_event: one row per verified ride (dwell-settled and/or sensor-
-- verified) with on-device-computed metrics. user_attraction keeps collapsing
-- to counts; this is the per-ride fact log it never had.
--
-- ref_source: add a MANUAL_SEED (id 6) row so coaster_stats.source has a home
-- for hand-curated figures. Idempotent (ON CONFLICT DO NOTHING) — matches the
-- seed.ts source list.
--
-- SAFETY: purely additive. Two new tables, FKs to existing user (CASCADE),
-- attractions, parks, ref_source, and one idempotent ref_source insert.
-- Nothing existing is touched.
-- ============================================================================

INSERT INTO "ref_source" ("id", "code") VALUES (6, 'manual_seed')
  ON CONFLICT ("id") DO NOTHING;

CREATE TABLE IF NOT EXISTS "coaster_stats" (
  "attraction_id"  bigint PRIMARY KEY REFERENCES "attractions"("id"),
  "track_length_m" double precision,
  "top_speed_kmh"  double precision,   -- official/published figure, never sensor-derived
  "drop_height_m"  double precision,
  "max_height_m"   double precision,
  "inversions"     smallint,
  "coaster_type"   text,               -- 'steel' | 'wooden' | 'hybrid'
  "manufacturer"   text,
  "opened_year"    smallint,
  "source"         smallint NOT NULL REFERENCES "ref_source"("id"),
  "updated_at"     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "user_ride_event" (
  "id"            bigserial PRIMARY KEY,
  "user_id"       text   NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "attraction_id" bigint NOT NULL REFERENCES "attractions"("id"),
  "park_id"       bigint NOT NULL REFERENCES "parks"("id"),
  "ridden_at"     timestamptz NOT NULL,
  "source"        text NOT NULL,        -- 'dwell' | 'sensor' | 'sensor+dwell'
  "metrics"       jsonb,                -- RideMetrics; null for dwell-only rides
  "trace"         jsonb,                -- optional ~4 Hz downsampled audit trace (<=600 samples)
  "created_at"    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "user_ride_event_user_idx"
  ON "user_ride_event" ("user_id", "ridden_at" DESC);
CREATE INDEX IF NOT EXISTS "user_ride_event_user_attraction_idx"
  ON "user_ride_event" ("user_id", "attraction_id");
