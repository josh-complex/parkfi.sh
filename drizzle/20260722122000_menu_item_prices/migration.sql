-- Plan item 1.6: the dinemenu feed prices many items at multiple tiers
-- ("Per Glass $16 / Per Bottle $64"); we kept only the first entry. Store the
-- full tier list per item; the existing price/price_type/currency columns stay
-- as the first-price denormalization (no breaking change). NULL for single/
-- unpriced items and for all generations captured before this change.
--
-- Deviation from the plan doc: the feed's `pricesRange` field probed as a bare
-- boolean (false on all 236 multi-price items at Wine Bar George, 2026-07-22),
-- not a price payload — nothing to store.

ALTER TABLE "dining_menu_item" ADD COLUMN IF NOT EXISTS "prices" jsonb;
