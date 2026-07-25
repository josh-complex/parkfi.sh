-- Universal content parity (research/universal-content-parity.md §7 items 1-3, 5).
-- Universal's mobile-services POI feed and per-ride contentdata pages publish
-- ride attributes the places feed drops entirely — most importantly a numeric
-- minimum height, which left the `noHeightReq` filter chip dead for every UOR
-- ride. These columns hold them; WDW rows get `min_height_in` / `max_height_in`
-- backfilled from the prose `height_requirement` the finder already gives us.
--
-- `min_height_in = 0` is an explicit "no minimum" (Disney "Any Height",
-- Universal "No Minimum Height"); NULL is unknown. The flags are NULL for WDW
-- because the Disney finder publishes none of them — NULL means "not
-- published", never "false".

ALTER TABLE "attraction_meta" ADD COLUMN IF NOT EXISTS "min_height_in" smallint;
ALTER TABLE "attraction_meta" ADD COLUMN IF NOT EXISTS "max_height_in" smallint;
ALTER TABLE "attraction_meta" ADD COLUMN IF NOT EXISTS "express_pass" boolean;
ALTER TABLE "attraction_meta" ADD COLUMN IF NOT EXISTS "single_rider" boolean;
ALTER TABLE "attraction_meta" ADD COLUMN IF NOT EXISTS "child_swap" boolean;
ALTER TABLE "attraction_meta" ADD COLUMN IF NOT EXISTS "virtual_line" boolean;
ALTER TABLE "attraction_meta" ADD COLUMN IF NOT EXISTS "fun_fact" text;
ALTER TABLE "attraction_meta"
  ADD COLUMN IF NOT EXISTS "accessibility" text[] NOT NULL DEFAULT '{}';

-- Backfill the numeric heights from the existing WDW prose so the height-band
-- filter works on both operators from the moment it ships, without waiting for
-- the monthly geo cron. Mirrors `parseHeightRequirementInches` in codes.ts —
-- "Any Height" is a real value meaning no requirement, hence 0 not NULL.
UPDATE "attraction_meta"
SET "min_height_in" = 0
WHERE "min_height_in" IS NULL AND "height_requirement" ILIKE 'any height';

UPDATE "attraction_meta"
SET "min_height_in" = round((substring("height_requirement" from '(\d+(?:\.\d+)?)\s*"'))::numeric)
WHERE "min_height_in" IS NULL
  AND "height_requirement" ~ '(\d+(?:\.\d+)?)\s*"'
  AND "height_requirement" !~* 'shorter|under|maximum|below';

UPDATE "attraction_meta"
SET "max_height_in" = round((substring("height_requirement" from '(\d+(?:\.\d+)?)\s*"'))::numeric)
WHERE "max_height_in" IS NULL
  AND "height_requirement" ~ '(\d+(?:\.\d+)?)\s*"'
  AND "height_requirement" ~* 'shorter|under|maximum|below';

-- The height-band filter reads these on every board/map query.
CREATE INDEX IF NOT EXISTS "attraction_meta_min_height_idx"
  ON "attraction_meta" ("min_height_in")
  WHERE "min_height_in" IS NOT NULL;
