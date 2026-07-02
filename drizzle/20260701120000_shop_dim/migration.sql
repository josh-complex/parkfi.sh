-- ============================================================================
-- Merchandise (shops) catalog — shop_dim.
--
-- SAFETY: purely additive. One new table + its FK to ref_source; nothing
-- existing is touched. Populated weekly by the `merchandise-facilities` catalog
-- cron from the PUBLIC finder shops list
-- (`list-ancestor-entities/wdw/{destination}/{date}/shops`), the retail
-- counterpart to `restaurant_dim`. Coordinates are nullable (destination-level
-- entries — pressed-coin machines, "Find Merchandise" — carry no map marker).
-- ============================================================================

CREATE TABLE IF NOT EXISTS "shop_dim" (
  "facility_id" text PRIMARY KEY NOT NULL,
  "name" text NOT NULL,
  "url_friendly_id" text,
  "latitude" double precision,
  "longitude" double precision,
  "map_pin" text,
  "land" text,
  "land_id" text,
  "park_resort" text,
  "park_resort_id" text,
  "image_url" text,
  "detail_url" text,
  "merchandise" text[] NOT NULL DEFAULT '{}',
  "disney_owned" boolean NOT NULL DEFAULT false,
  "source" smallint NOT NULL DEFAULT 3 REFERENCES "ref_source"("id"),
  "active" boolean NOT NULL DEFAULT true,
  "last_seen_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

-- Map layer reads: only active, plottable shops.
CREATE INDEX IF NOT EXISTS "shop_dim_active_coords_idx"
  ON "shop_dim" ("active")
  WHERE "latitude" IS NOT NULL AND "longitude" IS NOT NULL;
