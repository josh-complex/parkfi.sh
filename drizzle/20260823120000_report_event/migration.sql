CREATE TABLE "report_event" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"resort_slug" text NOT NULL,
	"park_id" bigint,
	"entity_kind" text NOT NULL,
	"entity_id" text NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"window_end" timestamp with time zone NOT NULL,
	"score" real NOT NULL,
	"payload" jsonb NOT NULL,
	"detected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"consumed_by" bigint
);
--> statement-breakpoint
ALTER TABLE "report_event" ADD CONSTRAINT "report_event_park_id_parks_id_fk" FOREIGN KEY ("park_id") REFERENCES "public"."parks"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "report_event_identity_uq" ON "report_event" USING btree ("kind","entity_kind","entity_id","window_start");
--> statement-breakpoint
CREATE INDEX "report_event_backlog_idx" ON "report_event" USING btree ("resort_slug","consumed_by","detected_at");
