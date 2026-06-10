CREATE TABLE "alert_optout" (
	"user_id" text PRIMARY KEY,
	"stay_email_opt_out" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification" (
	"id" bigserial PRIMARY KEY,
	"alert_id" bigint NOT NULL,
	"user_id" text NOT NULL,
	"channel" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" text NOT NULL,
	"provider_msg_id" text,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "stay_alert" (
	"id" bigserial PRIMARY KEY,
	"user_id" text NOT NULL,
	"query_id" bigint NOT NULL,
	"resort_id" text DEFAULT '' NOT NULL,
	"mode" smallint NOT NULL,
	"price_below" integer,
	"channel" text DEFAULT 'email' NOT NULL,
	"armed" boolean DEFAULT true NOT NULL,
	"last_fired_at" timestamp with time zone,
	"last_available" boolean,
	"last_price" integer,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "notification_user_created_idx" ON "notification" ("user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "stay_alert_active_query_idx" ON "stay_alert" ("query_id") WHERE active;--> statement-breakpoint
CREATE UNIQUE INDEX "stay_alert_user_resort_query_uq" ON "stay_alert" ("user_id","resort_id","query_id") WHERE active;--> statement-breakpoint
ALTER TABLE "alert_optout" ADD CONSTRAINT "alert_optout_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_alert_id_stay_alert_id_fkey" FOREIGN KEY ("alert_id") REFERENCES "stay_alert"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "stay_alert" ADD CONSTRAINT "stay_alert_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "stay_alert" ADD CONSTRAINT "stay_alert_query_id_stay_query_id_fkey" FOREIGN KEY ("query_id") REFERENCES "stay_query"("id") ON DELETE CASCADE;