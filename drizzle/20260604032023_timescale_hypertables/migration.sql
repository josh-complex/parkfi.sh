-- Custom SQL migration: transaction-safe TimescaleDB DDL.
-- NOTE: the `queue_hourly` continuous aggregate is NOT here — a continuous
-- aggregate cannot be created inside a transaction block, and drizzle-kit
-- migrate wraps all migrations in one transaction. It lives in src/db/cagg.sql,
-- applied out-of-band via `bun run db:cagg`.

CREATE EXTENSION IF NOT EXISTS timescaledb;
--> statement-breakpoint

-- Hypertables (no-op if already converted) ----------------------------------
SELECT create_hypertable('attraction_status_obs', 'observed_at', chunk_time_interval => INTERVAL '7 days', if_not_exists => TRUE);
--> statement-breakpoint
SELECT create_hypertable('queue_obs', 'observed_at', chunk_time_interval => INTERVAL '1 day', if_not_exists => TRUE);
--> statement-breakpoint
SELECT create_hypertable('product_price_obs', 'observed_at', chunk_time_interval => INTERVAL '7 days', if_not_exists => TRUE);
--> statement-breakpoint
SELECT create_hypertable('dining_obs', 'observed_at', chunk_time_interval => INTERVAL '1 day', if_not_exists => TRUE);
--> statement-breakpoint

-- Compression: STANDBY is ~95% of rows; segmenting by (attraction_id,
-- queue_type) compresses it ~10-20x. -----------------------------------------
ALTER TABLE queue_obs SET (timescaledb.compress, timescaledb.compress_segmentby = 'attraction_id, queue_type', timescaledb.compress_orderby = 'observed_at DESC');
--> statement-breakpoint
SELECT add_compression_policy('queue_obs', INTERVAL '7 days', if_not_exists => TRUE);
--> statement-breakpoint
SELECT add_retention_policy('queue_obs', INTERVAL '90 days', if_not_exists => TRUE);
--> statement-breakpoint
ALTER TABLE attraction_status_obs SET (timescaledb.compress, timescaledb.compress_segmentby = 'attraction_id', timescaledb.compress_orderby = 'observed_at DESC');
--> statement-breakpoint
SELECT add_compression_policy('attraction_status_obs', INTERVAL '30 days', if_not_exists => TRUE);
--> statement-breakpoint

-- Partial index for the hot read: "latest STANDBY per attraction" -----------
CREATE INDEX IF NOT EXISTS ix_queue_standby_latest ON queue_obs (attraction_id, observed_at DESC) WHERE queue_type = 1;
