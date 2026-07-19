-- Resort-transit state machine columns (Disney wave 2). Out-of-park pings walk
-- a zone graph of hand-seeded WDW resort circles (TTC, monorail/Skyliner
-- stations, the Seven Seas Lagoon ferry waypoint — src/server/achievements/
-- disney.ts). zone_slug/zone_at track the last zone seen; zone_steps accumulates
-- pedometer deltas since leaving it (rode vs. walked discriminator);
-- transit_kind/transit_at dedupe multi-leg journeys to one credit. Cleared on
-- park entry.

ALTER TABLE "user_geo_state" ADD COLUMN IF NOT EXISTS "zone_slug" text;
ALTER TABLE "user_geo_state" ADD COLUMN IF NOT EXISTS "zone_at" timestamp with time zone;
ALTER TABLE "user_geo_state" ADD COLUMN IF NOT EXISTS "zone_steps" integer NOT NULL DEFAULT 0;
ALTER TABLE "user_geo_state" ADD COLUMN IF NOT EXISTS "transit_kind" text;
ALTER TABLE "user_geo_state" ADD COLUMN IF NOT EXISTS "transit_at" timestamp with time zone;
