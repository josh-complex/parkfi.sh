-- ThumbHash placeholders for static-content artwork (base64, ~32 chars).
-- Painted by the client as an instant blurry preview while the real image
-- loads, so content tiles are never blank. `image_thumbhash_src` records the
-- URL each hash was computed from: the filler (fillMissingThumbhashes, run by
-- the daily park-news cron, the monthly geo cron, and backfill:thumbhashes)
-- recomputes whenever a row's current image URL differs, so image-writing
-- pipelines never need to know hashes exist.

ALTER TABLE "attraction_meta" ADD COLUMN IF NOT EXISTS "image_thumbhash" text;
ALTER TABLE "attraction_meta" ADD COLUMN IF NOT EXISTS "image_thumbhash_src" text;

ALTER TABLE "parks" ADD COLUMN IF NOT EXISTS "image_thumbhash" text;
ALTER TABLE "parks" ADD COLUMN IF NOT EXISTS "image_thumbhash_src" text;

ALTER TABLE "restaurant_dim" ADD COLUMN IF NOT EXISTS "image_thumbhash" text;
ALTER TABLE "restaurant_dim" ADD COLUMN IF NOT EXISTS "image_thumbhash_src" text;

ALTER TABLE "shop_dim" ADD COLUMN IF NOT EXISTS "image_thumbhash" text;
ALTER TABLE "shop_dim" ADD COLUMN IF NOT EXISTS "image_thumbhash_src" text;

ALTER TABLE "park_poi" ADD COLUMN IF NOT EXISTS "image_thumbhash" text;
ALTER TABLE "park_poi" ADD COLUMN IF NOT EXISTS "image_thumbhash_src" text;

ALTER TABLE "news_item" ADD COLUMN IF NOT EXISTS "image_thumbhash" text;
ALTER TABLE "news_item" ADD COLUMN IF NOT EXISTS "image_thumbhash_src" text;

ALTER TABLE "blog_post" ADD COLUMN IF NOT EXISTS "image_thumbhash" text;
ALTER TABLE "blog_post" ADD COLUMN IF NOT EXISTS "image_thumbhash_src" text;
