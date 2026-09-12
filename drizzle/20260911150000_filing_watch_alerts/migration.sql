-- Public-records intelligence, W5 — filing-watch alert delivery
-- (docs/plans/public-records-intelligence.md §6.3).
--
-- `public_record_watch` (W0) already stores the subscription. This adds the two
-- tables delivery needs: an edge-trigger ledger so a (watch, record) pair fires
-- exactly once even when the agency revises the record or an adapter re-drains
-- its cursor, and a durable notification log mirroring `notification` /
-- `dining_notification` (a filing watch can't reuse `notification`, whose
-- alert_id is FK'd to stay_alert). Plus the third email opt-out flag, so the
-- one-click unsubscribe link has a domain-wide switch like stays and dining.
-- Hand-written; idempotent guards are belt-and-suspenders on top of the
-- drizzle tracking table.

CREATE TABLE IF NOT EXISTS "public_record_watch_fire" (
  "watch_id" bigint NOT NULL REFERENCES "public_record_watch" ("id") ON DELETE CASCADE,
  "record_id" bigint NOT NULL REFERENCES "public_record" ("id") ON DELETE CASCADE,
  "fired_at" timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY ("watch_id", "record_id")
);
--> statement-breakpoint
-- "what did this watch send me lately" + the per-run grouping scan.
CREATE INDEX IF NOT EXISTS "public_record_watch_fire_recent_idx"
  ON "public_record_watch_fire" ("watch_id", "fired_at" DESC);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "public_record_notification" (
  "id" bigserial PRIMARY KEY,
  "watch_id" bigint NOT NULL REFERENCES "public_record_watch" ("id") ON DELETE CASCADE,
  "user_id" text NOT NULL REFERENCES "user" ("id") ON DELETE CASCADE,
  "channel" text NOT NULL,
  -- The matched records (title, filer, kind, agency url, our links) + subject —
  -- enough to render the email/push and to audit what we told someone.
  "payload" jsonb NOT NULL,
  -- 'queued' | 'sent' | 'failed'
  "status" text NOT NULL,
  "provider_msg_id" text,
  "error" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "sent_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "public_record_notification_user_created_idx"
  ON "public_record_notification" ("user_id", "created_at" DESC);
--> statement-breakpoint
ALTER TABLE "alert_optout"
  ADD COLUMN IF NOT EXISTS "filing_email_opt_out" boolean NOT NULL DEFAULT false;
