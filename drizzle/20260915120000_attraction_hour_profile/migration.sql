-- Waits-page rebuild, W5 (docs/plans/waits-redesign/README.md §5.2).
--
-- "What is this queue normally doing at this time of day" — a 30-day average
-- standby per attraction per *park-local* hour. It powers two things the live
-- board can't know on its own: the picks panel's "35 under its usual for 3 PM"
-- and the list's "Shortest later" column.
--
-- A plain materialized view, not a continuous aggregate: a cagg has to bucket
-- by time, and this groups by hour-*of-day* across thirty days, which is not a
-- bucket. It reads the `queue_hourly` cagg rather than raw `queue_obs`, so a
-- refresh scans pre-rolled hourly rows (~1 s), not 90 days of raw observations.
--
-- `now()` is STABLE, so the 30-day window re-evaluates on every REFRESH — the
-- view always means "the last 30 days", never "the 30 days before it was
-- created". Refreshed by the `cron-profiles` service (`bun run cron:profiles`),
-- CONCURRENTLY, which is what the unique index below is for.
--
-- Two things keep this honest, and both are load-bearing:
--
--   * The park-open EXISTS. The overnight feeds keep re-posting a stale wait
--     long after a park shuts, exactly as `allRides` and `board` already guard
--     against, so an ungated view learns that half the rides at Universal are
--     "usually 5 minutes at 4 AM". Same `OPEN_SCHEDULE_TYPES` set, same latest-
--     snapshot DISTINCT ON, as the app's other open/closed derivations.
--
--   * `days`, the number of distinct hourly buckets behind a row. It is the
--     clean separator between an hour a ride really runs and one it was only
--     seen in once or twice: a Halloween Horror Nights house reads 40-50 min at
--     19:00-01:00 across 13 nights, and 5 min at noon across 2 stray buckets.
--     Readers floor on it (see MIN_PROFILE_DAYS in the parks router) rather than
--     the view, so the bar can move without a migration.
--
-- Hand-written per the repo convention.

CREATE MATERIALIZED VIEW IF NOT EXISTS "attraction_hour_profile" AS
WITH sched AS (
  SELECT DISTINCT ON (park_id, service_date, opening_time)
         park_id, opening_time, closing_time
  FROM park_schedule
  WHERE type IN ('OPERATING', 'EXTRA_HOURS', 'TICKETED_EVENT')
    AND closing_time IS NOT NULL
  ORDER BY park_id, service_date, opening_time, snapshot_date DESC
)
SELECT q.attraction_id,
       (EXTRACT(hour FROM q.bucket AT TIME ZONE p.timezone))::smallint AS local_hour,
       round(avg(q.avg_wait))::int AS usual_wait,
       sum(q.samples)::int         AS samples,
       count(*)::int               AS days
FROM queue_hourly q
JOIN attractions a ON a.id = q.attraction_id AND a.active = true
  AND a.entity_type = 'ATTRACTION' AND a.category IS NOT NULL
JOIN parks p ON p.id = a.park_id AND p.active = true
WHERE q.queue_type = 1
  AND q.bucket >= now() - INTERVAL '30 days'
  AND q.avg_wait IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM sched s
    WHERE s.park_id = p.id AND q.bucket >= s.opening_time AND q.bucket < s.closing_time
  )
GROUP BY 1, 2;
--> statement-breakpoint
-- REFRESH ... CONCURRENTLY requires a unique index, and this pair is the view's
-- natural key.
CREATE UNIQUE INDEX IF NOT EXISTS "attraction_hour_profile_pk"
  ON "attraction_hour_profile" ("attraction_id", "local_hour");
