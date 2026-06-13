-- Stay alerts: generalize the single-resort selector into a `scope` token so an
-- alert can target a tier/area (set of resorts), not just one resort or "any".
ALTER TABLE "stay_alert" ADD COLUMN IF NOT EXISTS "scope" text DEFAULT '' NOT NULL;
--> statement-breakpoint
-- Backfill existing rows: '' (any) stays '', a concrete resort becomes 'r:<id>'.
UPDATE "stay_alert" SET "scope" = 'r:' || "resort_id" WHERE "resort_id" <> '' AND "scope" = '';
--> statement-breakpoint
-- Swap the per-user uniqueness from (resort_id) to the canonical (scope).
DROP INDEX IF EXISTS "stay_alert_user_resort_query_uq";
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "stay_alert_user_scope_query_uq"
  ON "stay_alert" ("user_id", "scope", "query_id") WHERE "active";
--> statement-breakpoint
-- Per-domain email opt-out: dining alerts get their own kill switch.
ALTER TABLE "alert_optout" ADD COLUMN IF NOT EXISTS "dining_email_opt_out" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
-- Dining-availability alert subscriptions (eats analog of stay_alert). No
-- frontier table: the dining sweep already covers every priority venue × party
-- × the day horizon, so the evaluator reads dining_obs directly.
CREATE TABLE IF NOT EXISTS "dining_alert" (
	"id" bigserial PRIMARY KEY,
	"user_id" text NOT NULL,
	"facility_id" text DEFAULT '' NOT NULL,
	"party_size" smallint NOT NULL,
	"service_date" date,
	"window_days" smallint,
	"channel" text DEFAULT 'email' NOT NULL,
	"armed" boolean DEFAULT true NOT NULL,
	"last_fired_at" timestamp with time zone,
	"last_available" boolean,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	-- exactly one of (service_date, window_days) is set
	CONSTRAINT "dining_alert_date_xor" CHECK (("service_date" IS NOT NULL) <> ("window_days" IS NOT NULL))
);
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'dining_alert_user_id_user_id_fkey') THEN
    ALTER TABLE "dining_alert" ADD CONSTRAINT "dining_alert_user_id_user_id_fkey"
      FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;
  END IF;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "dining_alert_active_facility_idx" ON "dining_alert" ("facility_id") WHERE "active";
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "dining_alert_user_facility_party_date_uq"
  ON "dining_alert" ("user_id", "facility_id", "party_size", "service_date", "window_days") WHERE "active";
--> statement-breakpoint
-- Durable send log for dining-alert delivery (mirror of `notification`).
CREATE TABLE IF NOT EXISTS "dining_notification" (
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
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'dining_notification_alert_id_dining_alert_id_fkey') THEN
    ALTER TABLE "dining_notification" ADD CONSTRAINT "dining_notification_alert_id_dining_alert_id_fkey"
      FOREIGN KEY ("alert_id") REFERENCES "dining_alert"("id") ON DELETE CASCADE;
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'dining_notification_user_id_user_id_fkey') THEN
    ALTER TABLE "dining_notification" ADD CONSTRAINT "dining_notification_user_id_user_id_fkey"
      FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;
  END IF;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "dining_notification_user_created_idx" ON "dining_notification" ("user_id", "created_at" DESC);
