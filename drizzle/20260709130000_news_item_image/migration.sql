-- Store the source article's OpenGraph image on each ingested RSS item, so the
-- "Around the parks" shelves/cards can render a thumbnail. Populated lazily by
-- the park-news cron (fetchOgImage): backfilled for existing rows and set for
-- new ones. Nullable — an article may publish no og:image.

ALTER TABLE "news_item" ADD COLUMN IF NOT EXISTS "image_url" text;
