-- Settled SHOW-entity dwells per park-day (Disney wave 1). The queue-dwell
-- machine now anchors to geocoded SHOW entities too; a settled show dwell bumps
-- this counter instead of `rides`, keeping `attractions_unique` and the queue
-- families ride-only. Powers the `shows_watched` stat.

ALTER TABLE "user_park_day" ADD COLUMN IF NOT EXISTS "shows" integer NOT NULL DEFAULT 0;
