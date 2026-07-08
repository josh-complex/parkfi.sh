-- ============================================================================
-- ride_alert: Lightning Lane availability mode (mode = 3).
--
-- Adds an edge-detect baseline column for the new mode: the last observed
-- queue_obs.state for whichever LL product (RETURN_TIME/PAID_RETURN_TIME) was
-- most recently reported for the ride. Kept separate from last_status
-- (attraction operating status) since both are carried forward independently
-- every sweep, regardless of an alert's mode.
--
-- SAFETY: purely additive, nullable column. No backfill needed — mode-3 alerts
-- don't exist yet.
-- ============================================================================

ALTER TABLE "ride_alert" ADD COLUMN IF NOT EXISTS "last_ll_state" smallint;
