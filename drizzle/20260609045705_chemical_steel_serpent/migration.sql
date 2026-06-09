CREATE TABLE "park_schedule" (
	"snapshot_date" date,
	"park_id" bigint,
	"service_date" date,
	"type" text,
	"opening_time" timestamp with time zone,
	"closing_time" timestamp with time zone,
	"description" text,
	"source" smallint NOT NULL,
	CONSTRAINT "park_schedule_pkey" PRIMARY KEY("park_id","service_date","type","opening_time","snapshot_date")
);
--> statement-breakpoint
ALTER TABLE "park_schedule" ADD CONSTRAINT "park_schedule_park_id_parks_id_fkey" FOREIGN KEY ("park_id") REFERENCES "parks"("id");--> statement-breakpoint
ALTER TABLE "park_schedule" ADD CONSTRAINT "park_schedule_source_ref_source_id_fkey" FOREIGN KEY ("source") REFERENCES "ref_source"("id");