-- Cleanup after dropping Universal Express "waits" (2026-09-03).
--
-- PART 1 — run now (cheap, 31 + 12 rows): remove the PAID_STANDBY capability
-- claim and the live-mirror value for Universal rides. The worker nulls the
-- mirror on its next tick anyway once the new code is deployed.
BEGIN;

DELETE FROM attraction_queue_support s
USING attractions a
JOIN parks p ON p.id = a.park_id
JOIN operators o ON o.id = p.operator_id
WHERE s.attraction_id = a.id AND o.slug = 'universal' AND s.queue_type = 5;

UPDATE attraction_live al SET paid_standby_wait = NULL
FROM attractions a
JOIN parks p ON p.id = a.park_id
JOIN operators o ON o.id = p.operator_id
WHERE al.attraction_id = a.id AND o.slug = 'universal' AND al.paid_standby_wait IS NOT NULL;

COMMIT;

-- PART 2 — optional: purge the PAID_STANDBY change-log history for Universal
-- (~890k rows since 2026-06-05, 6 distinct values; nothing reads queue_type 5
-- history today).
--
-- queue_obs is compressed and segmented by (attraction_id, queue_type), so this
-- DELETE decompresses exactly the Express segments and nothing else — but a
-- month's worth is 140k–390k tuples, over TimescaleDB's default 100k-per-
-- statement decompression guard ("tuple decompression limit exceeded by
-- operation"). The guard is a session setting; lift it for this session only
-- (0 = unlimited), run the deletes, and it resets when you disconnect.
-- Run off-peak; each month takes a while.

SET timescaledb.max_tuples_decompressed_per_dml_transaction = 0;

DELETE FROM queue_obs q
USING attractions a
JOIN parks p ON p.id = a.park_id
JOIN operators o ON o.id = p.operator_id
WHERE q.attraction_id = a.id AND o.slug = 'universal' AND q.queue_type = 5
  AND q.observed_at >= '2026-06-01' AND q.observed_at < '2026-07-01';

DELETE FROM queue_obs q
USING attractions a
JOIN parks p ON p.id = a.park_id
JOIN operators o ON o.id = p.operator_id
WHERE q.attraction_id = a.id AND o.slug = 'universal' AND q.queue_type = 5
  AND q.observed_at >= '2026-07-01' AND q.observed_at < '2026-08-01';

DELETE FROM queue_obs q
USING attractions a
JOIN parks p ON p.id = a.park_id
JOIN operators o ON o.id = p.operator_id
WHERE q.attraction_id = a.id AND o.slug = 'universal' AND q.queue_type = 5
  AND q.observed_at >= '2026-08-01' AND q.observed_at < '2026-09-01';

DELETE FROM queue_obs q
USING attractions a
JOIN parks p ON p.id = a.park_id
JOIN operators o ON o.id = p.operator_id
WHERE q.attraction_id = a.id AND o.slug = 'universal' AND q.queue_type = 5
  AND q.observed_at >= '2026-09-01';

RESET timescaledb.max_tuples_decompressed_per_dml_transaction;

-- Afterwards, the touched chunks hold decompressed Express segments alongside
-- their compressed neighbours; the compression policy recompresses them on its
-- next run. Nothing to do by hand.
