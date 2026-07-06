-- ============================================================================
-- Non-facility map POIs — park_poi.
--
-- SAFETY: purely additive. One new table + FKs to parks / ref_source; nothing
-- existing is touched. Populated monthly by the geo cron from the SAME
-- `details-entity-simple` marker array it already fetches for attraction pins —
-- the guest-services / entertainment / events-tours markers it currently drops
-- on the floor. Keyed on the marker `point-of-interest` numeric prefix, so a
-- physical location (e.g. one of many restrooms) is one row even when several
-- share an underlying entity. Soft-delete (active=false) scoped by
-- (park_id, source) on drop.
-- ============================================================================

CREATE TABLE IF NOT EXISTS "park_poi" (
  "poi_id" text PRIMARY KEY NOT NULL,
  "park_id" bigint NOT NULL REFERENCES "parks"("id"),
  "poi_type" text NOT NULL,
  "category" text,
  "map_pin" text,
  "name" text NOT NULL,
  "entity_name" text,
  "entity_id" text,
  "url_friendly_id" text,
  "latitude" double precision,
  "longitude" double precision,
  "land" text,
  "image_url" text,
  "detail_url" text,
  "source" smallint NOT NULL DEFAULT 3 REFERENCES "ref_source"("id"),
  "active" boolean NOT NULL DEFAULT true,
  "last_seen_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

-- Map layer reads: only active, plottable POIs.
CREATE INDEX IF NOT EXISTS "park_poi_active_coords_idx"
  ON "park_poi" ("active")
  WHERE "latitude" IS NOT NULL AND "longitude" IS NOT NULL;

-- Per-park soft-delete scope.
CREATE INDEX IF NOT EXISTS "park_poi_park_idx"
  ON "park_poi" ("park_id");
