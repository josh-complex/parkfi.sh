-- ============================================================================
-- Living Layer / Wayfarer (M4a) — encounter battle log.
--
-- SAFETY: purely additive. One new table, no changes to anything existing.
-- Records resolved Faded battles (for the logbook in M6 + economy tuning).
-- Kept a plain table for now; can be promoted to a Timescale hypertable with a
-- retention policy later if volume warrants (mirrors queue_obs).
-- ============================================================================

CREATE TABLE IF NOT EXISTS "encounter_log" (
  "id"                  bigserial PRIMARY KEY,
  "user_id"             text REFERENCES "user"("id"),
  "mark_id"             bigint REFERENCES "mark"("id"),
  "park_id"             bigint REFERENCES "parks"("id"),
  "attraction_id"       bigint REFERENCES "attractions"("id"),
  "faded_type"          text REFERENCES "ref_faded_type"("code"),
  "outcome"             text NOT NULL,  -- win | flee | loss
  "live_state_snapshot" jsonb,
  "ts"                  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "encounter_log_user_ts_idx" ON "encounter_log" ("user_id", "ts");
CREATE INDEX IF NOT EXISTS "encounter_log_mark_idx" ON "encounter_log" ("mark_id");
