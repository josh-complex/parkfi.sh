ALTER TABLE "attractions" ADD COLUMN "latitude" double precision;--> statement-breakpoint
ALTER TABLE "attractions" ADD COLUMN "longitude" double precision;--> statement-breakpoint
ALTER TABLE "attractions" ADD COLUMN "category" text;--> statement-breakpoint
ALTER TABLE "parks" ADD COLUMN "latitude" double precision;--> statement-breakpoint
ALTER TABLE "parks" ADD COLUMN "longitude" double precision;--> statement-breakpoint
ALTER TABLE "parks" ADD COLUMN "lat_min" double precision;--> statement-breakpoint
ALTER TABLE "parks" ADD COLUMN "lat_max" double precision;--> statement-breakpoint
ALTER TABLE "parks" ADD COLUMN "lng_min" double precision;--> statement-breakpoint
ALTER TABLE "parks" ADD COLUMN "lng_max" double precision;--> statement-breakpoint
ALTER TABLE "parks" ADD COLUMN "map_zoom" integer;