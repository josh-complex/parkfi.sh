-- ============================================================================
-- Achievements: distinct-attraction dimension.
--
-- The queue-dwell state machine already knows which attraction a dwell was
-- anchored to, but only ever incremented a scalar `user_park_day.rides` count.
-- This table records the attraction itself so we can award "ride N different
-- attractions" (stat `attractions_unique`) and, later, per-park completion.
--
-- SAFETY: purely additive. One new table; FKs point at existing `user` (CASCADE)
-- and `attractions` / `parks`. Nothing existing is touched. Populated going
-- forward as dwells settle — no backfill is possible (historical dwells didn't
-- retain the attraction id).
-- ============================================================================

CREATE TABLE IF NOT EXISTS "user_attraction" (
  "user_id"         text   NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "attraction_id"   bigint NOT NULL REFERENCES "attractions"("id"),
  "park_id"         bigint NOT NULL REFERENCES "parks"("id"),
  "first_ridden_at" timestamptz NOT NULL DEFAULT now(),
  "last_ridden_at"  timestamptz NOT NULL DEFAULT now(),
  "ride_count"      integer NOT NULL DEFAULT 0,
  PRIMARY KEY ("user_id", "attraction_id")
);
CREATE INDEX IF NOT EXISTS "user_attraction_user_idx" ON "user_attraction" ("user_id");
