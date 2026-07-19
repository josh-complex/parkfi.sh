-- Pedometer cursor on the per-user geo state row (F-steps v2). The client now
-- reports the native session's *cumulative* step count plus the session's start
-- time; the server diffs against this cursor and credits the delta. That makes
-- retried pings idempotent (a re-sent cumulative diffs to zero) — the previous
-- client-side delta protocol double-credited when a response was lost after the
-- server committed. Null until a native session first reports.

ALTER TABLE "user_geo_state" ADD COLUMN IF NOT EXISTS "step_session_ms" bigint;
ALTER TABLE "user_geo_state" ADD COLUMN IF NOT EXISTS "steps_cum" integer;
