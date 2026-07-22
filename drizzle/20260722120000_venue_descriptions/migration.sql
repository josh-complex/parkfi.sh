-- Plan item 2.3: official descriptions + venue enrichment. The finder detail
-- payload (already fetched weekly per dining venue for schedules) carries
-- marketing copy and per-venue Annual Passholder discount percentages; the
-- dining list feed carries `quickServiceAvailable` (parsed, never stored). The
-- UOR places feed carries descriptions we already download and drop. One
-- description column per catalog dim + the two restaurant_dim extras.
--
-- Deviation from the plan doc: `related_facility_ids` is dropped — the live
-- `guestsAlsoViewed` block is title-only (no venue graph) on every venue probed
-- 2026-07-22, so there is nothing to store.

ALTER TABLE "restaurant_dim" ADD COLUMN IF NOT EXISTS "description" text;
ALTER TABLE "restaurant_dim" ADD COLUMN IF NOT EXISTS "quick_service" boolean NOT NULL DEFAULT false;
ALTER TABLE "restaurant_dim" ADD COLUMN IF NOT EXISTS "ap_discount_pct" smallint;
ALTER TABLE "shop_dim" ADD COLUMN IF NOT EXISTS "description" text;
ALTER TABLE "attraction_meta" ADD COLUMN IF NOT EXISTS "description" text;
