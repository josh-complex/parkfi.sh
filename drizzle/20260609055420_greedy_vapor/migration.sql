CREATE TABLE "ride_alert" (
	"id" bigserial PRIMARY KEY,
	"user_id" text NOT NULL,
	"park_id" bigint NOT NULL,
	"attraction_id" bigint NOT NULL,
	"mode" smallint NOT NULL,
	"threshold_min" integer,
	"change_delta" integer,
	"armed" boolean DEFAULT true NOT NULL,
	"last_fired_at" timestamp with time zone,
	"last_wait_min" integer,
	"last_status" smallint,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "ride_alert_active_attraction_idx" ON "ride_alert" ("attraction_id") WHERE active;--> statement-breakpoint
CREATE INDEX "ride_alert_user_park_idx" ON "ride_alert" ("user_id","park_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ride_alert_user_attraction_uq" ON "ride_alert" ("user_id","attraction_id") WHERE active;--> statement-breakpoint
ALTER TABLE "ride_alert" ADD CONSTRAINT "ride_alert_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "ride_alert" ADD CONSTRAINT "ride_alert_park_id_parks_id_fkey" FOREIGN KEY ("park_id") REFERENCES "parks"("id");--> statement-breakpoint
ALTER TABLE "ride_alert" ADD CONSTRAINT "ride_alert_attraction_id_attractions_id_fkey" FOREIGN KEY ("attraction_id") REFERENCES "attractions"("id");