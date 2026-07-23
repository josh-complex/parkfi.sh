-- UOR untapped-data follow-up (probed 2026-07-23): the places feed carries
-- venue phone numbers, addresses, and accessibility slugs that the UOR dining
-- cron previously dropped at parse. Hours (`place_hours`) need no column —
-- the weekly pattern expands into existing `dining_schedule` rows.

ALTER TABLE "restaurant_dim" ADD COLUMN IF NOT EXISTS "phone" text;
ALTER TABLE "restaurant_dim" ADD COLUMN IF NOT EXISTS "address" text;
ALTER TABLE "restaurant_dim" ADD COLUMN IF NOT EXISTS "accessibility" text[];
