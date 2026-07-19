-- Pedometer-verified steps per park-day (F-steps). Fed by the native
-- ride-recorder plugin's session step counter (CMPedometer / TYPE_STEP_COUNTER),
-- delivered as per-ping deltas and clamped server-side in ingestPing. Stays 0
-- for web users and denied-permission devices — the steps achievement families
-- ship dark there, like the sensor coaster families.

ALTER TABLE "user_park_day" ADD COLUMN IF NOT EXISTS "steps" integer NOT NULL DEFAULT 0;
