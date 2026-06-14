-- Richer blog drafts: the hero image now carries a visible photo credit (and
-- alt text) so we can attribute the source we pulled it from. The image URL
-- already existed (`hero_image_url`); these add the citation + accessibility
-- text that goes with it.
ALTER TABLE "blog_post" ADD COLUMN IF NOT EXISTS "hero_image_alt" text;
--> statement-breakpoint
ALTER TABLE "blog_post" ADD COLUMN IF NOT EXISTS "hero_image_credit" text;
--> statement-breakpoint
ALTER TABLE "blog_post" ADD COLUMN IF NOT EXISTS "hero_image_credit_url" text;
