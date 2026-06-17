-- queue_obs now samples at the poll tick, not the feed's `lastUpdated`.
-- Previously `observed_at` held the feed timestamp and the PK
-- (attraction_id, queue_type, observed_at) deduped every unchanged poll away,
-- so 15-minute buckets had wildly uneven sample counts and the park-average
-- line looked jagged. The poller now stamps `observed_at` at tick time and
-- carries the feed's own timestamp on this new column for staleness checks.
ALTER TABLE "queue_obs" ADD COLUMN IF NOT EXISTS "last_updated" timestamptz;
