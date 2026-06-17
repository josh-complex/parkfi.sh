-- Theme-park boundary polygon, enriched monthly by services/geo from
-- OpenStreetMap (tourism=theme_park, matched by name). Stored as a GeoJSON
-- geometry ([lng,lat] Polygon | MultiPolygon) so the map can outline just the
-- actual park area instead of the whole resort property (the property outline is
-- only an artifact of the OSM basemap tiles, which we can't strip).
ALTER TABLE "parks" ADD COLUMN IF NOT EXISTS "boundary" jsonb;
