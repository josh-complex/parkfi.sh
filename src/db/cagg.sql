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
