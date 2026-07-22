-- Plan item 1.9: the Disney finder park payload carries a multi-slide hero
-- carousel (image slides at responsive sizes + video slides with poster stills)
-- that the geo cron reduced to the single `image_url`. Persist the normalized
-- slide list so the park dashboard can render a carousel / ambient video;
-- `image_url` stays as the first-image denormalization.

ALTER TABLE "parks" ADD COLUMN IF NOT EXISTS "hero_media" jsonb;
