-- Continuous aggregate for queue_hourly + its refresh policy.
--
-- This lives OUTSIDE the Drizzle migrations on purpose: a continuous aggregate
-- cannot be created inside a transaction block, and drizzle-kit migrate wraps
-- every migration in one transaction. Applied via `bun run db:cagg`, which runs
-- each statement on its own (so neither is batched into an implicit txn).
--
-- Required by app code: parks.history (src/integrations/trpc/routers/parks.ts)
-- SELECTs from queue_hourly. Run AFTER db:migrate (needs the queue_obs
-- hypertable to exist). Idempotent: safe to re-run.

CREATE MATERIALIZED VIEW IF NOT EXISTS queue_hourly
  WITH (timescaledb.continuous) AS
SELECT
  attraction_id,
  queue_type,
  time_bucket('1 hour', observed_at) AS bucket,
  avg(wait_min)::int    AS avg_wait,
  max(wait_min)         AS max_wait,
  min(wait_min)         AS min_wait,
  avg(price_cents)::int AS avg_price,
  count(*) FILTER (WHERE state = 3) AS sold_out_samples,
  count(*)              AS samples
FROM queue_obs
GROUP BY attraction_id, queue_type, bucket
WITH NO DATA;

SELECT add_continuous_aggregate_policy('queue_hourly', start_offset => INTERVAL '3 days', end_offset => INTERVAL '1 hour', schedule_interval => INTERVAL '1 hour', if_not_exists => TRUE);

-- queue_15min: the permanent feature store for wait-time forecasting --------
-- Hourly buckets are too coarse for intraday curves; this 15-minute grain is
-- what the forecasting models train on. Unlike raw queue_obs (90-day retention),
-- continuous aggregates carry NO retention policy by default, so this persists
-- forever — and it stays cheap (~4080 rides x 96 buckets/day x a few cols).
-- state = 3 is SOLD_OUT (ref_queue_state; see src/db/seed.ts). avg_wait is
-- ::real here (not ::int like queue_hourly) for finer intraday precision.
CREATE MATERIALIZED VIEW IF NOT EXISTS queue_15min
  WITH (timescaledb.continuous) AS
SELECT
  attraction_id,
  queue_type,
  time_bucket('15 minutes', observed_at) AS bucket,
  avg(wait_min)::real   AS avg_wait,
  max(wait_min)         AS max_wait,
  min(wait_min)         AS min_wait,
  avg(price_cents)::int AS avg_price,
  count(*) FILTER (WHERE state = 3) AS sold_out_samples,
  count(*)              AS samples
FROM queue_obs
GROUP BY attraction_id, queue_type, bucket
WITH NO DATA;

SELECT add_continuous_aggregate_policy('queue_15min', start_offset => INTERVAL '3 days', end_offset => INTERVAL '1 hour', schedule_interval => INTERVAL '1 hour', if_not_exists => TRUE);

-- One-time backfill of all available raw history (<= queue_obs's 90-day window)
-- into the feature store. The refresh policy above only maintains the trailing
-- 3 days going forward; this CALL materializes everything older that still
-- exists in queue_obs. Idempotent (re-running just recomputes the buckets) but
-- not free over 90 days, so it intentionally runs only when db:cagg is invoked.
CALL refresh_continuous_aggregate('queue_15min', NULL, NULL);
