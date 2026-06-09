ALTER TABLE "restaurant_dim" ADD COLUMN "image_url" text;--> statement-breakpoint
ALTER TABLE "restaurant_dim" ADD COLUMN "detail_url" text;--> statement-breakpoint
ALTER TABLE "restaurant_dim" ADD COLUMN "source" smallint DEFAULT 3 NOT NULL;--> statement-breakpoint
ALTER TABLE "restaurant_dim" ADD CONSTRAINT "restaurant_dim_source_ref_source_id_fkey" FOREIGN KEY ("source") REFERENCES "ref_source"("id");