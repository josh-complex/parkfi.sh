-- Repair for the first universal-content-parity geo run.
--
-- `ingestUniversalVenueGeo` originally overwrote `parks.boundary` with
-- Universal's `GpsBoundary`, on the assumption that the operator's own outline
-- beat the OSM `tourism=theme_park` way. It doesn't: Universal publishes a
-- coarse containing hull (4–9 vertices) where OSM traces the perimeter in
-- 100–350 points, so the UOR parks ended up outlined by a polygon that visibly
-- swallowed roads and parking. That step is now fallback-only (it fires solely
-- when a park has no boundary at all).
--
-- Clearing the hulls makes the next `cron:geo` run rewrite them from OSM:
-- `ingestBoundaries` writes every park it can match, and the fallback now skips
-- any park that already has geometry. Only rows still holding a small hull are
-- touched, so a re-run of this migration after the cron is a no-op.
UPDATE "parks" p
SET "boundary" = NULL,
    -- Set from the hull's bounding circle by the same bad step. WDW leaves this
    -- NULL and lets the camera fit lat/lng_min/max; UOR should match, and
    -- `ingestChildren` recomputes the bounds from the ride coordinates.
    "map_zoom" = NULL
FROM "operators" o
WHERE o.id = p.operator_id
  AND o.slug = 'universal'
  AND p.boundary IS NOT NULL
  AND jsonb_array_length(p.boundary -> 'coordinates' -> 0) <= 12;
