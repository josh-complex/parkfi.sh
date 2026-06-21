-- ============================================================================
-- Dining package tag.
--
-- SAFETY: purely additive. One new boolean column on restaurant_dim, defaulted
-- false so existing rows are unaffected. The dining-facilities catalog cron
-- backfills it on its next run (derived from the finder tableService tags
-- "dine-events" / "dessert-events" — fireworks dessert parties, Fantasmic! &
-- fireworks dining packages, festival concert dining packages).
-- ============================================================================

ALTER TABLE "restaurant_dim"
  ADD COLUMN IF NOT EXISTS "dining_package" boolean NOT NULL DEFAULT false;
