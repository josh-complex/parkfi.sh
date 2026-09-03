-- Retire queue-times "ghost" attractions.
--
-- When ThemeParks.wiki is unreachable the worker falls back to queue-times, and
-- `resolveAttractions` used to INSERT a fresh attraction for every queue-times
-- ride id it had never mapped — even when a same-named, TP.wiki-mapped
-- attraction already existed in the park. The twins are typed ATTRACTION
-- (queue-times has no entity types) so they pass the ride-shelf filter that
-- excludes the real SHOW row, and they surface whatever stale wait the last
-- fallback tick left behind (Meet Toothless and Friends showed an 80-minute
-- wait a day old, 2026-09-03). 20 such rows across WDW + UOR.
--
-- A ghost is an ACTIVE attraction whose only external id is a queue-times one,
-- sharing (park, name) with another active attraction that carries a
-- ThemeParks.wiki id. Its queue-times id is re-pointed at the real row (so the
-- fallback feeds it from now on — the worker now links by slug, see
-- ingest.ts), its live mirror row is dropped, and it is deactivated. History
-- tables (attraction_status_obs) keep their rows. Re-running is a no-op.
CREATE TEMP TABLE ghost_pairs AS
WITH src AS (
  SELECT a.id, a.park_id, lower(a.name) AS n,
         bool_or(e.source = 1) AS has_tp,
         bool_or(e.source = 2) AS has_qt,
         count(e.*) FILTER (WHERE e.source <> 2) AS other_ids
  FROM attractions a
  LEFT JOIN external_ids e ON e.entity_kind = 'attraction' AND e.entity_id = a.id
  WHERE a.active
  GROUP BY a.id
)
SELECT DISTINCT ON (g.id) g.id AS ghost_id, r.id AS real_id
FROM src g
JOIN src r ON r.park_id = g.park_id AND r.n = g.n AND r.id <> g.id AND r.has_tp
WHERE g.has_qt AND NOT g.has_tp AND g.other_ids = 0
ORDER BY g.id, r.id;
--> statement-breakpoint
UPDATE external_ids e
SET entity_id = gp.real_id
FROM ghost_pairs gp
WHERE e.entity_kind = 'attraction' AND e.source = 2 AND e.entity_id = gp.ghost_id;
--> statement-breakpoint
DELETE FROM attraction_live WHERE attraction_id IN (SELECT ghost_id FROM ghost_pairs);
--> statement-breakpoint
UPDATE attractions SET active = false WHERE id IN (SELECT ghost_id FROM ghost_pairs);
--> statement-breakpoint
DROP TABLE ghost_pairs;
