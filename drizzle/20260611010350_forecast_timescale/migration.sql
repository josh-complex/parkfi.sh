-- Custom SQL migration: transaction-safe TimescaleDB DDL for the forecasting
-- tables (mirrors drizzle/*_timescale_hypertables). create_hypertable can't be
-- emitted by drizzle-kit. The queue_15min continuous aggregate is NOT here — a
-- continuous aggregate can't be created in a transaction block; it lives in
-- src/db/cagg.sql, applied via `bun run db:cagg`. Runs AFTER the migration that
-- creates these tables (20260611010337_first_ultron).

-- weather_obs: per-park feature store, both forecast + actual. NO retention. ---
SELECT create_hypertable('weather_obs', 'observed_at', chunk_time_interval => INTERVAL '7 days', if_not_exists => TRUE, migrate_data => TRUE);
--> statement-breakpoint

-- queue_forecast: emitted forecasts; disposable, ~30-day retention. -----------
SELECT create_hypertable('queue_forecast', 'target_ts', chunk_time_interval => INTERVAL '7 days', if_not_exists => TRUE, migrate_data => TRUE);
--> statement-breakpoint
SELECT add_retention_policy('queue_forecast', INTERVAL '30 days', if_not_exists => TRUE);
--> statement-breakpoint

-- forecast_eval: backtest ledger; keep ~90 days for the dashboard windows. ----
SELECT create_hypertable('forecast_eval', 'target_ts', chunk_time_interval => INTERVAL '7 days', if_not_exists => TRUE, migrate_data => TRUE);
--> statement-breakpoint
SELECT add_retention_policy('forecast_eval', INTERVAL '90 days', if_not_exists => TRUE);