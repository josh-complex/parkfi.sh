-- Disney content parity (research/disney-content-parity.md §6 steps 1-5).
--
-- 1. `park_poi.schedule` — today's published performance times for an
--    entertainment/character pin. BOTH operators publish these and both were
--    being dropped for want of a column: Disney's in the destination
--    attractions feed (`schedule.schedules[]`, 82 WDW POIs carry times, 22 of
--    them entities that don't exist in `attractions` at all), Universal's in
--    the mobile POI feed (`StartDateTimes[]`).
--
-- 2. A `ref_source` row for OpenStreetMap. The operators publish one
--    representative service location per park (every WDW `info` entity name
--    appears exactly 6 times — one "Restrooms" pin per park — and Epic Universe
--    publishes no amenities at all), while OSM maps them individually: 30
--    toilets inside Magic Kingdom alone against Disney's single pin. OSM rows
--    are written under their own source so the (park_id, source)-scoped
--    soft-delete never lets them collide with operator-published pins.
--
-- No backfill: the monthly geo cron populates both on its next run.

ALTER TABLE "park_poi" ADD COLUMN IF NOT EXISTS "schedule" jsonb;

INSERT INTO "ref_source" ("id", "code") VALUES (7, 'osm')
ON CONFLICT ("id") DO NOTHING;
