-- Plan item 1.9 (ride-level): the per-attraction finder detail payload carries
-- its own `mediaEngine.data` collection — gallery stills plus `video` /
-- `cinemagraph` slides (ambient loops, webm+mp4). The geo cron already fetches
-- this payload per attraction for descriptions (plan item 2.3), so capturing
-- the slides is parse widening. The ride-detail hero plays the ambient video.

ALTER TABLE "attraction_meta" ADD COLUMN IF NOT EXISTS "hero_media" jsonb;
