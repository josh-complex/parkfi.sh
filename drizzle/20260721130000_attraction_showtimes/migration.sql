-- Plan item 1.1: SHOW entities carry a `showtimes[]` on the ThemeParks.wiki
-- `/live` feed every poll (parades/fireworks/meet-and-greets included). We now
-- pass it through normalize -> the worker, mirrored on `attraction_live` as the
-- day's list (worker-upserted on change, like the other mirror columns). No
-- history table — a day's schedule isn't time-series-interesting.

ALTER TABLE "attraction_live" ADD COLUMN IF NOT EXISTS "showtimes" jsonb;
