CREATE TABLE "attraction_queue_support" (
	"attraction_id" bigint NOT NULL,
	"queue_type" smallint NOT NULL,
	CONSTRAINT "attraction_queue_support_attraction_id_queue_type_pk" PRIMARY KEY("attraction_id","queue_type")
);
--> statement-breakpoint
CREATE TABLE "attraction_status_obs" (
	"observed_at" timestamp with time zone NOT NULL,
	"attraction_id" bigint NOT NULL,
	"status" smallint NOT NULL,
	"source" smallint NOT NULL,
	CONSTRAINT "attraction_status_obs_attraction_id_observed_at_pk" PRIMARY KEY("attraction_id","observed_at")
);
--> statement-breakpoint
CREATE TABLE "attractions" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"park_id" bigint NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"entity_type" text DEFAULT 'ATTRACTION' NOT NULL,
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dining_obs" (
	"observed_at" timestamp with time zone NOT NULL,
	"restaurant_id" bigint NOT NULL,
	"service_date" date NOT NULL,
	"meal_time" time NOT NULL,
	"party_size" smallint NOT NULL,
	"available" boolean NOT NULL,
	"source" smallint NOT NULL,
	CONSTRAINT "dining_obs_restaurant_id_service_date_meal_time_party_size_observed_at_pk" PRIMARY KEY("restaurant_id","service_date","meal_time","party_size","observed_at")
);
--> statement-breakpoint
CREATE TABLE "external_ids" (
	"entity_kind" text NOT NULL,
	"entity_id" bigint NOT NULL,
	"source" smallint NOT NULL,
	"external_id" text NOT NULL,
	CONSTRAINT "external_ids_source_entity_kind_external_id_pk" PRIMARY KEY("source","entity_kind","external_id")
);
--> statement-breakpoint
CREATE TABLE "operators" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	CONSTRAINT "operators_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "park_products" (
	"park_id" bigint NOT NULL,
	"product_id" smallint NOT NULL,
	"display_name" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "park_products_park_id_product_id_pk" PRIMARY KEY("park_id","product_id")
);
--> statement-breakpoint
CREATE TABLE "parks" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"resort_id" bigint,
	"operator_id" bigint,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"timezone" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "parks_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "product_price_obs" (
	"observed_at" timestamp with time zone NOT NULL,
	"park_id" bigint NOT NULL,
	"product_id" smallint NOT NULL,
	"service_date" date NOT NULL,
	"tier" text DEFAULT '' NOT NULL,
	"price_cents" integer,
	"currency" char(3),
	"state" smallint,
	"source" smallint NOT NULL,
	CONSTRAINT "product_price_obs_park_id_product_id_service_date_tier_observed_at_pk" PRIMARY KEY("park_id","product_id","service_date","tier","observed_at")
);
--> statement-breakpoint
CREATE TABLE "queue_obs" (
	"observed_at" timestamp with time zone NOT NULL,
	"attraction_id" bigint NOT NULL,
	"queue_type" smallint NOT NULL,
	"wait_min" integer,
	"state" smallint,
	"price_cents" integer,
	"currency" char(3),
	"return_start" timestamp with time zone,
	"return_end" timestamp with time zone,
	"boarding_group" integer,
	"source" smallint NOT NULL,
	CONSTRAINT "queue_obs_attraction_id_queue_type_observed_at_pk" PRIMARY KEY("attraction_id","queue_type","observed_at")
);
--> statement-breakpoint
CREATE TABLE "ref_attraction_status" (
	"id" smallint PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	CONSTRAINT "ref_attraction_status_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "ref_product" (
	"id" smallint PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"pricing_grain" text NOT NULL,
	CONSTRAINT "ref_product_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "ref_queue_state" (
	"id" smallint PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	CONSTRAINT "ref_queue_state_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "ref_queue_type" (
	"id" smallint PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	CONSTRAINT "ref_queue_type_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "ref_source" (
	"id" smallint PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	CONSTRAINT "ref_source_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "resorts" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"operator_id" bigint,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	CONSTRAINT "resorts_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "ticket_availability" (
	"snapshot_date" date NOT NULL,
	"park_id" bigint NOT NULL,
	"service_date" date NOT NULL,
	"segment" text NOT NULL,
	"state" smallint NOT NULL,
	"source" smallint NOT NULL,
	CONSTRAINT "ticket_availability_park_id_service_date_segment_snapshot_date_pk" PRIMARY KEY("park_id","service_date","segment","snapshot_date")
);
--> statement-breakpoint
ALTER TABLE "attraction_queue_support" ADD CONSTRAINT "attraction_queue_support_attraction_id_attractions_id_fk" FOREIGN KEY ("attraction_id") REFERENCES "public"."attractions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attraction_queue_support" ADD CONSTRAINT "attraction_queue_support_queue_type_ref_queue_type_id_fk" FOREIGN KEY ("queue_type") REFERENCES "public"."ref_queue_type"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attraction_status_obs" ADD CONSTRAINT "attraction_status_obs_status_ref_attraction_status_id_fk" FOREIGN KEY ("status") REFERENCES "public"."ref_attraction_status"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attraction_status_obs" ADD CONSTRAINT "attraction_status_obs_source_ref_source_id_fk" FOREIGN KEY ("source") REFERENCES "public"."ref_source"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attractions" ADD CONSTRAINT "attractions_park_id_parks_id_fk" FOREIGN KEY ("park_id") REFERENCES "public"."parks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dining_obs" ADD CONSTRAINT "dining_obs_restaurant_id_attractions_id_fk" FOREIGN KEY ("restaurant_id") REFERENCES "public"."attractions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dining_obs" ADD CONSTRAINT "dining_obs_source_ref_source_id_fk" FOREIGN KEY ("source") REFERENCES "public"."ref_source"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_ids" ADD CONSTRAINT "external_ids_source_ref_source_id_fk" FOREIGN KEY ("source") REFERENCES "public"."ref_source"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "park_products" ADD CONSTRAINT "park_products_park_id_parks_id_fk" FOREIGN KEY ("park_id") REFERENCES "public"."parks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "park_products" ADD CONSTRAINT "park_products_product_id_ref_product_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."ref_product"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parks" ADD CONSTRAINT "parks_resort_id_resorts_id_fk" FOREIGN KEY ("resort_id") REFERENCES "public"."resorts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parks" ADD CONSTRAINT "parks_operator_id_operators_id_fk" FOREIGN KEY ("operator_id") REFERENCES "public"."operators"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_price_obs" ADD CONSTRAINT "product_price_obs_product_id_ref_product_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."ref_product"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_price_obs" ADD CONSTRAINT "product_price_obs_state_ref_queue_state_id_fk" FOREIGN KEY ("state") REFERENCES "public"."ref_queue_state"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_price_obs" ADD CONSTRAINT "product_price_obs_source_ref_source_id_fk" FOREIGN KEY ("source") REFERENCES "public"."ref_source"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "queue_obs" ADD CONSTRAINT "queue_obs_queue_type_ref_queue_type_id_fk" FOREIGN KEY ("queue_type") REFERENCES "public"."ref_queue_type"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "queue_obs" ADD CONSTRAINT "queue_obs_state_ref_queue_state_id_fk" FOREIGN KEY ("state") REFERENCES "public"."ref_queue_state"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "queue_obs" ADD CONSTRAINT "queue_obs_source_ref_source_id_fk" FOREIGN KEY ("source") REFERENCES "public"."ref_source"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resorts" ADD CONSTRAINT "resorts_operator_id_operators_id_fk" FOREIGN KEY ("operator_id") REFERENCES "public"."operators"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_availability" ADD CONSTRAINT "ticket_availability_park_id_parks_id_fk" FOREIGN KEY ("park_id") REFERENCES "public"."parks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_availability" ADD CONSTRAINT "ticket_availability_state_ref_queue_state_id_fk" FOREIGN KEY ("state") REFERENCES "public"."ref_queue_state"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_availability" ADD CONSTRAINT "ticket_availability_source_ref_source_id_fk" FOREIGN KEY ("source") REFERENCES "public"."ref_source"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "attractions_park_slug_idx" ON "attractions" USING btree ("park_id","slug");--> statement-breakpoint
CREATE INDEX "external_ids_entity_idx" ON "external_ids" USING btree ("entity_kind","entity_id");