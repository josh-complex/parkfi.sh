-- Express + single-rider waits on the live mirror.
--
-- Universal's public CDN wait board (assets.universalparks.com, see
-- src/server/parks/universal-cdn-waits.ts) types every ride's queues —
-- STANDBY / EXPRESS / SINGLE — where ThemeParks.wiki reports the Express and
-- single-rider lines for only a handful of rides. The worker now overlays those
-- two waits per tick; `queue_obs` already holds them under queue types 5
-- (PAID_STANDBY) and 2 (SINGLE_RIDER), and these two columns mirror the latest
-- value so the board and ride page read them off `attraction_live` like standby.
-- NULL means the ride runs no such line, or nothing is posted right now.
ALTER TABLE "attraction_live" ADD COLUMN IF NOT EXISTS "single_rider_wait" integer;
--> statement-breakpoint
ALTER TABLE "attraction_live" ADD COLUMN IF NOT EXISTS "paid_standby_wait" integer;
