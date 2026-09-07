-- Park-tracking fixes 2, Workstream D (docs/plans/park-tracking-fixes-2.md).
-- Short-retention log of accepted in-park pings so a sensor ride trace can be
-- attributed to where the user was when the ride STARTED, not where the
-- current user_geo_state cursor says they are now — a ride drained from the
-- native event queue hours later must still resolve. One row per accepted
-- in-park ping (~1 per 30 s per active user); out-of-park pings are not stored.
-- Rows older than 7 days are pruned by ingestPing (see USER_GEO_PING_RETENTION).
-- Hand-written per the repo convention.

CREATE TABLE IF NOT EXISTS "user_geo_ping" (
  "user_id" text NOT NULL REFERENCES "user" ("id") ON DELETE CASCADE,
  "at" timestamp with time zone NOT NULL,
  "park_id" bigint REFERENCES "parks" ("id"),
  "lng" double precision NOT NULL,
  "lat" double precision NOT NULL,
  "accuracy_m" real NOT NULL,
  "anchor_attraction_id" bigint REFERENCES "attractions" ("id"),
  PRIMARY KEY ("user_id", "at")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_geo_ping_user_at_idx" ON "user_geo_ping" ("user_id", "at" DESC);
