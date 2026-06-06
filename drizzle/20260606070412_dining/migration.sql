CREATE TABLE "restaurant_dim" (
	"facility_id" text PRIMARY KEY,
	"entity_type" text NOT NULL,
	"name" text NOT NULL,
	"cuisine" text,
	"experience_type" text,
	"price_range" text,
	"park_resort" text,
	"park_resort_id" text,
	"bookable" boolean DEFAULT false NOT NULL,
	"sellable_online" boolean DEFAULT false NOT NULL,
	"priority" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scraper_session" (
	"name" text PRIMARY KEY,
	"account_label" text,
	"ciphertext" text NOT NULL,
	"iv" text NOT NULL,
	"auth_tag" text NOT NULL,
	"expires_at" timestamp with time zone,
	"last_validated_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "dining_obs" DROP CONSTRAINT "dining_obs_restaurant_id_attractions_id_fk";--> statement-breakpoint
ALTER TABLE "dining_obs" DROP CONSTRAINT "dining_obs_restaurant_id_service_date_meal_time_party_size_observed_at_pk";--> statement-breakpoint
ALTER TABLE "dining_obs" ADD COLUMN "facility_id" text;--> statement-breakpoint
ALTER TABLE "dining_obs" ADD COLUMN "meal_period" text DEFAULT '';--> statement-breakpoint
ALTER TABLE "dining_obs" ADD COLUMN "offer_time" time DEFAULT '00:00:00';--> statement-breakpoint
ALTER TABLE "dining_obs" ADD COLUMN "offer_id" text;--> statement-breakpoint
ALTER TABLE "dining_obs" ADD PRIMARY KEY ("facility_id","service_date","party_size","meal_period","offer_time","observed_at");--> statement-breakpoint
ALTER TABLE "dining_obs" DROP COLUMN "restaurant_id";--> statement-breakpoint
ALTER TABLE "dining_obs" DROP COLUMN "meal_time";--> statement-breakpoint
ALTER TABLE "dining_obs" DROP COLUMN "available";--> statement-breakpoint
ALTER TABLE "dining_obs" ADD CONSTRAINT "dining_obs_facility_id_restaurant_dim_facility_id_fkey" FOREIGN KEY ("facility_id") REFERENCES "restaurant_dim"("facility_id");