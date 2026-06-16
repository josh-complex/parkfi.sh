-- Park-level hero photo + alt text, enriched monthly by services/geo from each
-- operator's own feed (Disney finder heroData poster; Universal places Park
-- entry heroImage). Both feeds were already fetched by the geo cron — these
-- columns just capture the park imagery that was previously discarded.
ALTER TABLE "parks" ADD COLUMN IF NOT EXISTS "image_url" text;
--> statement-breakpoint
ALTER TABLE "parks" ADD COLUMN IF NOT EXISTS "image_alt" text;
