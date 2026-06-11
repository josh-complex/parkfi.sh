CREATE TABLE "calendar_day" (
	"region" text,
	"date" date,
	"is_us_federal_holiday" boolean DEFAULT false NOT NULL,
	"is_school_break" boolean DEFAULT false NOT NULL,
	"break_label" text,
	CONSTRAINT "calendar_day_pkey" PRIMARY KEY("region","date")
);
--> statement-breakpoint
CREATE TABLE "forecast_eval" (
	"model_version" text,
	"attraction_id" bigint,
	"queue_type" smallint,
	"target_ts" timestamp with time zone,
	"horizon_min" integer,
	"predicted_wait" real NOT NULL,
	"actual_wait" real,
	"abs_err" real,
	"generated_at" timestamp with time zone NOT NULL,
	"evaluated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "forecast_eval_pkey" PRIMARY KEY("model_version","attraction_id","queue_type","horizon_min","target_ts")
);
--> statement-breakpoint
CREATE TABLE "model_metrics" (
	"model_version" text,
	"window" text,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"mae" real,
	"rmse" real,
	"mape" real,
	"r2" real,
	"n_predictions" bigint,
	"coverage_pct" real,
	CONSTRAINT "model_metrics_pkey" PRIMARY KEY("model_version","window")
);
--> statement-breakpoint
CREATE TABLE "model_run" (
	"model_version" text PRIMARY KEY,
	"trained_at" timestamp with time zone NOT NULL,
	"train_rows" bigint,
	"feature_set" text,
	"metrics_json" jsonb,
	"status" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "park_calendar_map" (
	"park_id" bigint PRIMARY KEY,
	"region" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "queue_forecast" (
	"attraction_id" bigint,
	"queue_type" smallint,
	"target_ts" timestamp with time zone,
	"horizon_min" integer,
	"predicted_wait" real NOT NULL,
	"lower" real,
	"upper" real,
	"model_version" text,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "queue_forecast_pkey" PRIMARY KEY("attraction_id","queue_type","horizon_min","model_version","target_ts")
);
--> statement-breakpoint
CREATE TABLE "weather_obs" (
	"park_id" bigint,
	"observed_at" timestamp with time zone,
	"kind" text,
	"temp_c" real,
	"precip_mm" real,
	"precip_prob" real,
	"wind_kph" real,
	"humidity" smallint,
	"condition" text,
	"source" smallint NOT NULL,
	CONSTRAINT "weather_obs_pkey" PRIMARY KEY("park_id","kind","observed_at")
);
--> statement-breakpoint
CREATE INDEX "queue_forecast_target_idx" ON "queue_forecast" ("attraction_id","target_ts" DESC NULLS LAST);--> statement-breakpoint
ALTER TABLE "park_calendar_map" ADD CONSTRAINT "park_calendar_map_park_id_parks_id_fkey" FOREIGN KEY ("park_id") REFERENCES "parks"("id");--> statement-breakpoint
ALTER TABLE "queue_forecast" ADD CONSTRAINT "queue_forecast_queue_type_ref_queue_type_id_fkey" FOREIGN KEY ("queue_type") REFERENCES "ref_queue_type"("id");--> statement-breakpoint
ALTER TABLE "weather_obs" ADD CONSTRAINT "weather_obs_park_id_parks_id_fkey" FOREIGN KEY ("park_id") REFERENCES "parks"("id");--> statement-breakpoint
ALTER TABLE "weather_obs" ADD CONSTRAINT "weather_obs_source_ref_source_id_fkey" FOREIGN KEY ("source") REFERENCES "ref_source"("id");