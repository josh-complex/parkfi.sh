-- Plan item 1.9 follow-up (dining venues): the same per-venue finder detail
-- payload the weekly dining cron already fetches for schedules/descriptions
-- carries a `mediaEngine.data` collection (stills + video/cinemagraph ambient
-- loops). Store the normalized slides; the dining venue hero plays the loop.

ALTER TABLE "restaurant_dim" ADD COLUMN IF NOT EXISTS "hero_media" jsonb;
