CREATE TABLE "attraction_meta" (
	"attraction_id" bigint PRIMARY KEY,
	"image_thumb_url" text,
	"image_hero_url" text,
	"image_alt" text,
	"detail_url" text,
	"land" text,
	"height_requirement" text,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"source" smallint NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "attraction_meta" ADD CONSTRAINT "attraction_meta_attraction_id_attractions_id_fkey" FOREIGN KEY ("attraction_id") REFERENCES "attractions"("id");--> statement-breakpoint
ALTER TABLE "attraction_meta" ADD CONSTRAINT "attraction_meta_source_ref_source_id_fkey" FOREIGN KEY ("source") REFERENCES "ref_source"("id");