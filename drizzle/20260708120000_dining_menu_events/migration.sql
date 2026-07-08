-- ============================================================================
-- Dining menu item lifecycle events + restaurant first-seen.
--
-- SAFETY: purely additive.
--   1. One new column on restaurant_dim (`first_seen_at`), defaulted to now() so
--      every existing row backfills to the migration time. It's only ever used
--      to badge genuinely-new venues, so an all-rows backfill just means nothing
--      reads as "new" until a venue actually appears after this deploy — correct.
--   2. One new table `dining_menu_event` — the roster counterpart to
--      `dining_menu_price_change` (which stays as-is). Tracks items added,
--      removed, or renamed between menu generations. Written by the
--      `dining-facilities` cron when a venue's menu changes; never on first
--      capture. Nothing existing is touched.
-- ============================================================================

ALTER TABLE "restaurant_dim"
  ADD COLUMN IF NOT EXISTS "first_seen_at" timestamptz NOT NULL DEFAULT now();

CREATE TABLE IF NOT EXISTS "dining_menu_event" (
  "id" bigserial PRIMARY KEY NOT NULL,
  "facility_id" text NOT NULL REFERENCES "restaurant_dim"("facility_id"),
  "change_type" text NOT NULL,
  "meal_period" text NOT NULL,
  "group_name" text,
  "item_type" text,
  "title" text NOT NULL,
  "old_title" text,
  "price" real,
  "price_type" text,
  "currency" text,
  "changed_at" timestamptz NOT NULL DEFAULT now()
);

-- Feed roll-up + per-venue history reads.
CREATE INDEX IF NOT EXISTS "dining_menu_event_facility_idx"
  ON "dining_menu_event" ("facility_id", "changed_at");

-- "New items across the resort in the last month" reads scan by type + time.
CREATE INDEX IF NOT EXISTS "dining_menu_event_type_idx"
  ON "dining_menu_event" ("change_type", "changed_at");

-- Item detail page resolves an item's history by (facility, lower(title)).
CREATE INDEX IF NOT EXISTS "dining_menu_event_title_idx"
  ON "dining_menu_event" ("facility_id", lower("title"));
