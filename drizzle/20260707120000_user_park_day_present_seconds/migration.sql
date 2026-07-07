-- ============================================================================
-- Achievements: accurate in-park presence time.
--
-- `park_seconds` (the "Clocked In" family) was computed as
-- last_seen_at − first_seen_at per park-day, which counts mid-day gaps — a
-- hotel nap, a closed app overnight — as time inside the park. Replace it with
-- an incremental accumulator (`present_seconds`) that only adds gap-bounded
-- inter-ping deltas (see PING_MAX_GAP_S in the engine).
--
-- SAFETY: purely additive. One new column with a default; backfilled once from
-- the old span estimate so existing "Clocked In" progress is preserved (unlocks
-- are sticky regardless, but this keeps the displayed stat from collapsing).
-- ============================================================================

ALTER TABLE "user_park_day"
  ADD COLUMN IF NOT EXISTS "present_seconds" integer NOT NULL DEFAULT 0;

-- One-time backfill: mirror the pre-migration value (last_seen − first_seen) so
-- historical totals are unchanged. Only touches freshly-defaulted rows, so it's
-- safe to re-run.
UPDATE "user_park_day"
   SET "present_seconds" =
     GREATEST(0, FLOOR(EXTRACT(EPOCH FROM ("last_seen_at" - "first_seen_at"))))::integer
 WHERE "present_seconds" = 0;
