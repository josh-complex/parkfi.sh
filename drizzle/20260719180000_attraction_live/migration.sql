-- Current-state mirror for the live board/overview read path (load-bottlenecks
-- plan, Phase 3). One row per attraction, holding the latest tick's snapshot,
-- upserted by the worker in ingestPark. Lets parks.board / parks.overview read
-- current state as an O(rides) plain join instead of DISTINCT ON scans over the
-- append-only attraction_status_obs / queue_obs change-logs (which keep serving
-- history). observed_at is the tick that wrote the row; readers treat the
-- wait/LL/return fields as stale past 24h while status carries forward.
--
-- The worker self-backfills every active attraction within one tick, so this
-- must ship and run BEFORE the web tier flips its queries to it.

CREATE TABLE IF NOT EXISTS "attraction_live" (
  "attraction_id"   bigint PRIMARY KEY,
  "status"          smallint,
  "standby_wait"    integer,
  "ll_state"        smallint,
  "ll_price_cents"  integer,
  "ll_currency"     char(3),
  "ll_return_start" timestamp with time zone,
  "ll_return_end"   timestamp with time zone,
  "return_state"    smallint,
  "return_start"    timestamp with time zone,
  "return_end"      timestamp with time zone,
  "boarding_group"  integer,
  "source"          smallint,
  "observed_at"     timestamp with time zone NOT NULL
);

ALTER TABLE "attraction_live"
  ADD CONSTRAINT "attraction_live_attraction_id_fkey"
  FOREIGN KEY ("attraction_id") REFERENCES "attractions"("id") ON DELETE CASCADE;
