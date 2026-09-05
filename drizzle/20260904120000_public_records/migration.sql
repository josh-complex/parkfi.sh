-- Public-records intelligence, W0 (docs/plans/public-records-intelligence.md).
-- One ledger of government records keyed by (source, external_id), a revision
-- log, an entity-link table onto our own graph, a curated filer→operator alias
-- table (seeded below), a per-adapter cursor, and user watch subscriptions.
-- Hand-written; idempotent guards are belt-and-suspenders on top of the
-- drizzle tracking table.

CREATE EXTENSION IF NOT EXISTS pg_trgm;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "public_record" (
  "id" bigserial PRIMARY KEY,
  "source" text NOT NULL,
  "external_id" text NOT NULL,
  "kind" text NOT NULL,
  "operator" text,
  "resort_slug" text,
  "park_id" bigint REFERENCES "parks" ("id"),
  "filer" text,
  "filer_norm" text,
  "title" text NOT NULL,
  "description" text,
  "url" text NOT NULL,
  "filed_at" timestamp with time zone,
  "status" text,
  "status_at" timestamp with time zone,
  "latitude" double precision,
  "longitude" double precision,
  "parcel_id" text,
  "address" text,
  "payload" jsonb NOT NULL,
  "content_hash" char(64) NOT NULL,
  "score" real NOT NULL DEFAULT 0,
  "suppressed" boolean NOT NULL DEFAULT false,
  "first_seen_at" timestamp with time zone NOT NULL DEFAULT now(),
  "last_seen_at" timestamp with time zone NOT NULL DEFAULT now(),
  "changed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "public_record_identity_uq" ON "public_record" ("source", "external_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "public_record_feed_idx" ON "public_record" ("resort_slug", "first_seen_at" DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "public_record_kind_idx" ON "public_record" ("kind", "first_seen_at" DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "public_record_filer_idx" ON "public_record" ("filer_norm");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "public_record_park_idx" ON "public_record" ("park_id", "first_seen_at" DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "public_record_geo_idx" ON "public_record" ("latitude", "longitude") WHERE "latitude" IS NOT NULL;
--> statement-breakpoint
-- Omni-search / keyword watches: substring + similarity on the as-filed title.
CREATE INDEX IF NOT EXISTS "public_record_title_trgm" ON "public_record" USING gin ("title" gin_trgm_ops);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "public_record_revision" (
  "id" bigserial PRIMARY KEY,
  "record_id" bigint NOT NULL REFERENCES "public_record" ("id") ON DELETE CASCADE,
  "seen_at" timestamp with time zone NOT NULL DEFAULT now(),
  "prev_status" text,
  "next_status" text,
  "diff" jsonb NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "public_record_revision_idx" ON "public_record_revision" ("record_id", "seen_at" DESC);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "public_record_link" (
  "record_id" bigint NOT NULL REFERENCES "public_record" ("id") ON DELETE CASCADE,
  "entity_kind" text NOT NULL,
  "entity_id" text NOT NULL,
  "method" text NOT NULL,
  "confidence" real NOT NULL,
  "created_by" text NOT NULL DEFAULT 'auto',
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY ("record_id", "entity_kind", "entity_id")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "public_record_link_entity_idx" ON "public_record_link" ("entity_kind", "entity_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "public_record_filer_alias" (
  "pattern" text PRIMARY KEY,
  "operator" text NOT NULL,
  "resort_slug" text
);
--> statement-breakpoint
-- Seed (plan §2). Patterns are LIKE patterns over `filer_norm` (uppercase,
-- punctuation stripped, legal suffixes dropped). Prefix matches only — Socrata
-- truncates owner names to 30 chars ("UNIVERSAL CITY DEVELOPMENT PAR").
INSERT INTO "public_record_filer_alias" ("pattern", "operator", "resort_slug") VALUES
  ('UNIVERSAL CITY DEVELOPMENT%', 'universal', 'universal-orlando'),
  ('UNIVERSAL ORLANDO%',          'universal', 'universal-orlando'),
  ('UNIVERSAL CITY STUDIOS%',     'universal', NULL),
  ('UNIVERSAL STUDIOS%',          'universal', NULL),
  ('NBCUNIVERSAL%',               'universal', NULL),
  ('WALT DISNEY WORLD%',          'disney',    'walt-disney-world'),
  ('WALT DISNEY PARKS AND RESORTS%', 'disney', NULL),
  ('DISNEY ENTERPRISES%',         'disney',    NULL),
  ('DISNEY VACATION DEVELOPMENT%','disney',    'walt-disney-world'),
  ('DISNEY DESTINATIONS%',        'disney',    'walt-disney-world'),
  ('REEDY CREEK%',                'disney',    'walt-disney-world'),
  ('CENTRAL FLORIDA TOURISM OVERSIGHT%', 'disney', 'walt-disney-world'),
  ('SEA WORLD%',                  'seaworld',  NULL),
  ('SEAWORLD%',                   'seaworld',  NULL),
  ('UNITED PARKS%',               'seaworld',  NULL)
ON CONFLICT ("pattern") DO NOTHING;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "public_record_cursor" (
  "source" text PRIMARY KEY,
  "cursor" jsonb NOT NULL,
  "ran_at" timestamp with time zone NOT NULL DEFAULT now(),
  "stats" jsonb
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "public_record_watch" (
  "id" bigserial PRIMARY KEY,
  "user_id" text NOT NULL REFERENCES "user" ("id") ON DELETE CASCADE,
  "resort_slug" text,
  "park_id" bigint REFERENCES "parks" ("id"),
  "entity_kind" text,
  "entity_id" text,
  "kinds" text[] NOT NULL DEFAULT '{}'::text[],
  "keywords" text[] NOT NULL DEFAULT '{}'::text[],
  "channel" text NOT NULL DEFAULT 'push',
  "active" boolean NOT NULL DEFAULT true,
  "last_fired_at" timestamp with time zone,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "public_record_watch_active_idx" ON "public_record_watch" ("active", "resort_slug", "park_id");
