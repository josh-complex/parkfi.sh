CREATE TABLE "stay_obs" (
	"observed_at" timestamp with time zone,
	"resort_id" text,
	"check_in" date,
	"check_out" date,
	"party_key" text,
	"available" boolean NOT NULL,
	"price_per_night" integer,
	"reason_code" text,
	"source" smallint NOT NULL,
	CONSTRAINT "stay_obs_pkey" PRIMARY KEY("resort_id","check_in","check_out","party_key","observed_at")
);
--> statement-breakpoint
CREATE TABLE "stay_query" (
	"id" bigserial PRIMARY KEY,
	"check_in" date NOT NULL,
	"check_out" date NOT NULL,
	"party_key" text NOT NULL,
	"adults" smallint NOT NULL,
	"children" smallint NOT NULL,
	"child_ages" text DEFAULT '' NOT NULL,
	"accessible" boolean DEFAULT false NOT NULL,
	"florida_resident" boolean DEFAULT false NOT NULL,
	"postal_code" text,
	"last_requested_at" timestamp with time zone,
	"last_swept_at" timestamp with time zone,
	"alert_backed" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE INDEX "stay_obs_latest_idx" ON "stay_obs" ("check_in","check_out","party_key","observed_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "stay_query_dims_uq" ON "stay_query" ("check_in","check_out","party_key");--> statement-breakpoint
CREATE INDEX "stay_query_swept_idx" ON "stay_query" ("last_swept_at");--> statement-breakpoint
ALTER TABLE "stay_obs" ADD CONSTRAINT "stay_obs_source_ref_source_id_fkey" FOREIGN KEY ("source") REFERENCES "ref_source"("id");