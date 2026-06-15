-- Pin traders — cold photo identification + trading board.
--
-- Adds the reference catalog (pin / pin_image / pin_embedding), the user
-- collection (pin_have / pin_want), the trading layer (pin_offer), and the
-- confirmation-flywheel log (pin_scan). Vector search rides on pgvector in the
-- DB we already run: one CREATE EXTENSION + an HNSW index, no new datastore.
--
-- Embedding dim is 768 (open_clip ViT-L/14). The `model` column on pin_embedding
-- lets us re-embed under a new model without a schema change — see docs/plans.

CREATE EXTENSION IF NOT EXISTS vector;
--> statement-breakpoint

-- Reference catalog ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS "pin" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"series" text,
	"characters" text[] DEFAULT '{}' NOT NULL,
	"year" smallint,
	"edition_type" text,                 -- 'open' | 'LE' | 'LR' | 'cast' | ...
	"le_count" integer,                  -- limited-edition size; null = open
	"park" text,
	"est_value_cents" integer,           -- from eBay sold comps
	"source" text NOT NULL,              -- 'ebay' | 'pinpics' | 'disney' | 'user' | 'community'
	"source_ref" text,                   -- external id for provenance/dedup
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- One row per external source id so a re-crawl upserts instead of duplicating.
CREATE UNIQUE INDEX IF NOT EXISTS "pin_source_ref_uq" ON "pin" ("source", "source_ref")
  WHERE "source_ref" IS NOT NULL;
--> statement-breakpoint
-- Trigram search over names (mirror the dining/menu trigram pattern).
CREATE EXTENSION IF NOT EXISTS pg_trgm;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pin_name_trgm" ON "pin" USING gin ("name" gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pin_series_idx" ON "pin" ("series");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pin_year_idx" ON "pin" ("year");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pin_characters_gin" ON "pin" USING gin ("characters");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "pin_image" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pin_id" uuid NOT NULL,
	"r2_key" text NOT NULL,              -- canonical reference image in R2
	"is_primary" boolean DEFAULT false NOT NULL,
	"source" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pin_image_pin_id_pin_id_fkey') THEN
    ALTER TABLE "pin_image" ADD CONSTRAINT "pin_image_pin_id_pin_id_fkey"
      FOREIGN KEY ("pin_id") REFERENCES "pin"("id") ON DELETE CASCADE;
  END IF;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pin_image_pin_idx" ON "pin_image" ("pin_id");
--> statement-breakpoint
-- One primary reference image per pin.
CREATE UNIQUE INDEX IF NOT EXISTS "pin_image_primary_uq" ON "pin_image" ("pin_id")
  WHERE "is_primary";
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "pin_embedding" (
	"pin_image_id" uuid PRIMARY KEY NOT NULL,
	"pin_id" uuid NOT NULL,
	"embedding" vector(768) NOT NULL,    -- open_clip ViT-L/14 = 768-dim
	"model" text NOT NULL,               -- e.g. 'open_clip:ViT-L-14:v1' (track for re-embeds)
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pin_embedding_pin_image_id_pin_image_id_fkey') THEN
    ALTER TABLE "pin_embedding" ADD CONSTRAINT "pin_embedding_pin_image_id_pin_image_id_fkey"
      FOREIGN KEY ("pin_image_id") REFERENCES "pin_image"("id") ON DELETE CASCADE;
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pin_embedding_pin_id_pin_id_fkey') THEN
    ALTER TABLE "pin_embedding" ADD CONSTRAINT "pin_embedding_pin_id_pin_id_fkey"
      FOREIGN KEY ("pin_id") REFERENCES "pin"("id") ON DELETE CASCADE;
  END IF;
END $$;
--> statement-breakpoint
-- ANN index for nearest-neighbour scan lookups (cosine distance).
CREATE INDEX IF NOT EXISTS "pin_embedding_hnsw" ON "pin_embedding"
  USING hnsw ("embedding" vector_cosine_ops);
--> statement-breakpoint

-- User collection ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "pin_have" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"pin_id" uuid NOT NULL,
	"quantity" smallint DEFAULT 1 NOT NULL,
	"condition" text,
	"for_trade" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pin_have_condition_ck"
	  CHECK ("condition" IS NULL OR "condition" IN ('mint','near_mint','good','worn')),
	CONSTRAINT "pin_have_user_pin_uq" UNIQUE ("user_id", "pin_id")
);
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pin_have_user_id_user_id_fkey') THEN
    ALTER TABLE "pin_have" ADD CONSTRAINT "pin_have_user_id_user_id_fkey"
      FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pin_have_pin_id_pin_id_fkey') THEN
    ALTER TABLE "pin_have" ADD CONSTRAINT "pin_have_pin_id_pin_id_fkey"
      FOREIGN KEY ("pin_id") REFERENCES "pin"("id") ON DELETE CASCADE;
  END IF;
END $$;
--> statement-breakpoint
-- Index the "what's out there to trade for" side of the mutual-match query.
CREATE INDEX IF NOT EXISTS "pin_have_pin_for_trade_idx" ON "pin_have" ("pin_id")
  WHERE "for_trade";
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "pin_want" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"pin_id" uuid NOT NULL,
	"max_value_cents" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pin_want_user_pin_uq" UNIQUE ("user_id", "pin_id")
);
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pin_want_user_id_user_id_fkey') THEN
    ALTER TABLE "pin_want" ADD CONSTRAINT "pin_want_user_id_user_id_fkey"
      FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pin_want_pin_id_pin_id_fkey') THEN
    ALTER TABLE "pin_want" ADD CONSTRAINT "pin_want_pin_id_pin_id_fkey"
      FOREIGN KEY ("pin_id") REFERENCES "pin"("id") ON DELETE CASCADE;
  END IF;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pin_want_pin_idx" ON "pin_want" ("pin_id");
--> statement-breakpoint

-- Trading --------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "pin_offer" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"from_user_id" text NOT NULL,
	"to_user_id" text NOT NULL,
	"offering_pins" jsonb NOT NULL,       -- [{pinId, quantity}]
	"requesting_pins" jsonb NOT NULL,     -- [{pinId, quantity}]
	"message" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pin_offer_status_ck"
	  CHECK ("status" IN ('pending','accepted','declined','cancelled','expired'))
);
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pin_offer_from_user_id_user_id_fkey') THEN
    ALTER TABLE "pin_offer" ADD CONSTRAINT "pin_offer_from_user_id_user_id_fkey"
      FOREIGN KEY ("from_user_id") REFERENCES "user"("id") ON DELETE CASCADE;
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pin_offer_to_user_id_user_id_fkey') THEN
    ALTER TABLE "pin_offer" ADD CONSTRAINT "pin_offer_to_user_id_user_id_fkey"
      FOREIGN KEY ("to_user_id") REFERENCES "user"("id") ON DELETE CASCADE;
  END IF;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pin_offer_to_idx" ON "pin_offer" ("to_user_id", "status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pin_offer_from_idx" ON "pin_offer" ("from_user_id", "status");
--> statement-breakpoint

-- The flywheel ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "pin_scan" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text,
	"photo_r2_key" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,   -- 'queued' | 'processing' | 'ready' | 'failed'
	"candidates" jsonb DEFAULT '[]' NOT NULL,  -- [{pinId, score, stage}] returned to user
	"chosen_pin_id" uuid,                      -- null = user abandoned / "not listed"
	"top_confidence" real,
	"stage_resolved" smallint,                 -- 1..4: which stage produced the pick
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	CONSTRAINT "pin_scan_status_ck"
	  CHECK ("status" IN ('queued','processing','ready','failed'))
);
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pin_scan_user_id_user_id_fkey') THEN
    ALTER TABLE "pin_scan" ADD CONSTRAINT "pin_scan_user_id_user_id_fkey"
      FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE SET NULL;
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pin_scan_chosen_pin_id_pin_id_fkey') THEN
    ALTER TABLE "pin_scan" ADD CONSTRAINT "pin_scan_chosen_pin_id_pin_id_fkey"
      FOREIGN KEY ("chosen_pin_id") REFERENCES "pin"("id") ON DELETE SET NULL;
  END IF;
END $$;
--> statement-breakpoint
-- Labeled-pair index: the confirmed (photo, pin) pairs that feed the fine-tune.
CREATE INDEX IF NOT EXISTS "pin_scan_label_idx" ON "pin_scan" ("chosen_pin_id")
  WHERE "chosen_pin_id" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pin_scan_user_created_idx" ON "pin_scan" ("user_id", "created_at" DESC);
