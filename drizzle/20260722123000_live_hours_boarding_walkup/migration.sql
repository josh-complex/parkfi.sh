-- Live-schema batch (plan items 1.4 + 1.5 + 1.2) — one worker-path change:
--  • 1.4 per-entity operating hours → `attraction_live.hours_today` (typed
--    windows incl. per-ride Early Entry; effectively Disney-only).
--  • 1.5 boarding-group tail: the feed's `currentGroupEnd` + `allocationStatus`
--    were dropped at normalize; carry both on the mirror AND the queue_obs
--    change-log ("Now boarding groups 45–52", "groups paused").
--  • 1.2 walk-up dining waitlist → new `dining_walkup_live` mirror (sparse:
--    ~4 signature TS venues at MK carry it). `facility_id` is the live entity's
--    externalId numeric prefix == restaurant_dim.facility_id (verified join);
--    no FK — the mirror may briefly lead the catalog.

ALTER TABLE "attraction_live" ADD COLUMN IF NOT EXISTS "hours_today" jsonb;
ALTER TABLE "attraction_live" ADD COLUMN IF NOT EXISTS "boarding_group_end" integer;
ALTER TABLE "attraction_live" ADD COLUMN IF NOT EXISTS "boarding_allocation" smallint;
ALTER TABLE "queue_obs" ADD COLUMN IF NOT EXISTS "boarding_group_end" integer;
ALTER TABLE "queue_obs" ADD COLUMN IF NOT EXISTS "boarding_allocation" smallint;

CREATE TABLE IF NOT EXISTS "dining_walkup_live" (
  "facility_id" text PRIMARY KEY,
  "wait_min" integer,
  "party_sizes" jsonb,
  "observed_at" timestamp with time zone NOT NULL
);
