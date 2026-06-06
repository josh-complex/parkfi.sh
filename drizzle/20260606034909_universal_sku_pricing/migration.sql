CREATE TABLE "product_dim" (
	"sku" text PRIMARY KEY,
	"resort" text NOT NULL,
	"family" text NOT NULL,
	"duration_days" integer,
	"park_scope" text[] NOT NULL,
	"park_to_park" boolean DEFAULT false NOT NULL,
	"age_group" text,
	"residency" text DEFAULT 'STD' NOT NULL,
	"pass_tier" text,
	"variable_priced" boolean DEFAULT false NOT NULL,
	"list_price_cents" integer,
	"name" text,
	"active" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sku_price_obs" (
	"observed_at" timestamp with time zone,
	"sku" text,
	"service_date" date,
	"price_cents" integer,
	"currency" char(3),
	"available" boolean,
	"available_units" integer,
	"total_capacity" integer,
	"source" smallint NOT NULL,
	CONSTRAINT "sku_price_obs_pkey" PRIMARY KEY("sku","service_date","observed_at")
);
--> statement-breakpoint
ALTER TABLE "sku_price_obs" ADD CONSTRAINT "sku_price_obs_sku_product_dim_sku_fkey" FOREIGN KEY ("sku") REFERENCES "product_dim"("sku");--> statement-breakpoint
ALTER TABLE "sku_price_obs" ADD CONSTRAINT "sku_price_obs_source_ref_source_id_fkey" FOREIGN KEY ("source") REFERENCES "ref_source"("id");--> statement-breakpoint

-- TimescaleDB: sku_price_obs is high-volume (per-SKU × per-date × daily), so
-- make it a hypertable and compress old chunks. Transaction-safe (the
-- continuous-aggregate caveat in *_timescale_hypertables doesn't apply here).
-- No retention policy: ticket price history is kept long-term.
CREATE EXTENSION IF NOT EXISTS timescaledb;--> statement-breakpoint
SELECT create_hypertable('sku_price_obs', 'observed_at', chunk_time_interval => INTERVAL '7 days', if_not_exists => TRUE);--> statement-breakpoint
ALTER TABLE sku_price_obs SET (timescaledb.compress, timescaledb.compress_segmentby = 'sku', timescaledb.compress_orderby = 'observed_at DESC');--> statement-breakpoint
SELECT add_compression_policy('sku_price_obs', INTERVAL '30 days', if_not_exists => TRUE);