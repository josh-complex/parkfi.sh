CREATE TABLE "dining_location" (
	"id" text PRIMARY KEY,
	"title" text,
	"url_friendly_id" text,
	"location_type" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dining_menu_item" (
	"id" bigserial PRIMARY KEY,
	"facility_id" text NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"meal_period" text NOT NULL,
	"group_name" text,
	"item_type" text,
	"title" text NOT NULL,
	"description" text,
	"price" real,
	"price_type" text,
	"currency" text
);
--> statement-breakpoint
CREATE TABLE "dining_menu_price_change" (
	"id" bigserial PRIMARY KEY,
	"facility_id" text NOT NULL,
	"meal_period" text NOT NULL,
	"group_name" text,
	"title" text NOT NULL,
	"old_price" real,
	"new_price" real,
	"price_type" text,
	"currency" text,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dining_menu_snapshot" (
	"facility_id" text PRIMARY KEY,
	"content_hash" text NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"item_count" integer DEFAULT 0 NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_checked_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dining_schedule" (
	"facility_id" text,
	"schedule_date" date,
	"schedule_type" text DEFAULT 'Operating',
	"start_time" time,
	"end_time" time NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dining_schedule_pkey" PRIMARY KEY("facility_id","schedule_date","schedule_type","start_time")
);
--> statement-breakpoint
ALTER TABLE "restaurant_dim" ADD COLUMN "url_friendly_id" text;--> statement-breakpoint
ALTER TABLE "restaurant_dim" ADD COLUMN "land_id" text;--> statement-breakpoint
ALTER TABLE "restaurant_dim" ADD COLUMN "maximum_party_size" integer;--> statement-breakpoint
ALTER TABLE "restaurant_dim" ADD COLUMN "walkup_wait_list" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "restaurant_dim" ADD COLUMN "mobile_order" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "restaurant_dim" ADD COLUMN "character_dining" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "restaurant_dim" ADD COLUMN "fine_dining" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "restaurant_dim" ADD COLUMN "annual_pass_discount" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "restaurant_dim" ADD COLUMN "disney_visa_discount" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "restaurant_dim" ADD COLUMN "trip_advisor_award" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "restaurant_dim" ADD COLUMN "dining_plan_qs" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "restaurant_dim" ADD COLUMN "dining_plan_ts" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "restaurant_dim" ADD COLUMN "disney_favorites" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "restaurant_dim" ADD COLUMN "dining_interests" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "restaurant_dim" ADD COLUMN "entertainment_type" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "restaurant_dim" ADD COLUMN "eec_category" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "restaurant_dim" ADD COLUMN "product_urls" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
CREATE INDEX "dining_menu_item_facility_idx" ON "dining_menu_item" ("facility_id","observed_at");--> statement-breakpoint
CREATE INDEX "dining_menu_price_change_facility_idx" ON "dining_menu_price_change" ("facility_id","changed_at");--> statement-breakpoint
CREATE INDEX "dining_schedule_date_idx" ON "dining_schedule" ("schedule_date");--> statement-breakpoint
ALTER TABLE "dining_menu_item" ADD CONSTRAINT "dining_menu_item_facility_id_restaurant_dim_facility_id_fkey" FOREIGN KEY ("facility_id") REFERENCES "restaurant_dim"("facility_id");--> statement-breakpoint
ALTER TABLE "dining_menu_price_change" ADD CONSTRAINT "dining_menu_price_change_hX7fj0V6OerJ_fkey" FOREIGN KEY ("facility_id") REFERENCES "restaurant_dim"("facility_id");--> statement-breakpoint
ALTER TABLE "dining_menu_snapshot" ADD CONSTRAINT "dining_menu_snapshot_Vge9G8gzogXh_fkey" FOREIGN KEY ("facility_id") REFERENCES "restaurant_dim"("facility_id");--> statement-breakpoint
ALTER TABLE "dining_schedule" ADD CONSTRAINT "dining_schedule_facility_id_restaurant_dim_facility_id_fkey" FOREIGN KEY ("facility_id") REFERENCES "restaurant_dim"("facility_id");