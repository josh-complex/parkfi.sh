CREATE TABLE "news_item" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"source" text NOT NULL,
	"url" text NOT NULL,
	"url_hash" char(64) NOT NULL,
	"title" text NOT NULL,
	"summary" text,
	"published_at" timestamp with time zone,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"clustered_into" bigint
);
--> statement-breakpoint
CREATE UNIQUE INDEX "news_item_url_hash_uq" ON "news_item" USING btree ("url_hash");
--> statement-breakpoint
CREATE TABLE "blog_post" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"dek" text NOT NULL,
	"body_md" text NOT NULL,
	"ai_summary" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"tags" text[] DEFAULT '{}' NOT NULL,
	"park_slugs" text[] DEFAULT '{}' NOT NULL,
	"source_urls" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"hero_image_url" text,
	"model" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_at" timestamp with time zone
);
--> statement-breakpoint
CREATE UNIQUE INDEX "blog_post_slug_uq" ON "blog_post" USING btree ("slug");
--> statement-breakpoint
CREATE INDEX "blog_post_status_published_idx" ON "blog_post" USING btree ("status","published_at");
