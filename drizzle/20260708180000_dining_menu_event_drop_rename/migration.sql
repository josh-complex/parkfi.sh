-- ============================================================================
-- Drop rename detection from the dining menu item lifecycle log.
--
-- The 'renamed' change_type (a removed+added pair collapsed by matching
-- description or price+type) proved too unreliable to ship — it misfires on
-- unrelated items that happen to share a description or price. Rename
-- detection is removed from the diffing code; this migration brings existing
-- data in line by splitting every 'renamed' row into the 'removed' + 'added'
-- pair it would have produced without the matching, then drops the now-dead
-- `old_title` column.
--
-- SAFETY: rewrites `dining_menu_event` rows in place (not purely additive),
-- but only rows with change_type = 'renamed' — a table created and populated
-- only today, so the blast radius is whatever's landed since this morning.
-- ============================================================================

-- One 'removed' row per rename, carrying the prior title.
INSERT INTO "dining_menu_event"
  ("facility_id", "change_type", "meal_period", "group_name", "item_type",
   "title", "price", "price_type", "currency", "changed_at")
SELECT "facility_id", 'removed', "meal_period", "group_name", "item_type",
       "old_title", "price", "price_type", "currency", "changed_at"
FROM "dining_menu_event"
WHERE "change_type" = 'renamed' AND "old_title" IS NOT NULL;

-- The original row keeps its (new) title and becomes the companion 'added' row.
UPDATE "dining_menu_event"
SET "change_type" = 'added'
WHERE "change_type" = 'renamed';

ALTER TABLE "dining_menu_event" DROP COLUMN IF EXISTS "old_title";
