-- Plan item 3.2: the Universal reservation-availability response carries party-
-- size and advance-window bounds on every call, which we discarded. Persist them
-- on `restaurant_dim` (UOR rows) so the dining detail booking panel and the alert
-- form can bound their party-size / date pickers to the venue's real limits.
-- Distinct from the existing `maximum_party_size` (a Disney dining-event cap).

ALTER TABLE "restaurant_dim" ADD COLUMN IF NOT EXISTS "min_party_size" integer;
ALTER TABLE "restaurant_dim" ADD COLUMN IF NOT EXISTS "max_party_size" integer;
ALTER TABLE "restaurant_dim" ADD COLUMN IF NOT EXISTS "max_advance_days" integer;
ALTER TABLE "restaurant_dim" ADD COLUMN IF NOT EXISTS "min_advance_minutes" integer;
