-- W2 Phase A of the park-tracking fixes (docs/plans/park-tracking-fixes.md):
-- audit log of client-reported geofence park transitions. No stat credit is
-- derived from these rows — they exist to make prod geofence behavior
-- observable (spam rate, enter/exit flapping, platform asymmetry) and to feed
-- the Phase B corroboration rule for fence-only park days.
CREATE TABLE "user_park_transition" (
  "id" bigserial PRIMARY KEY,
  "user_id" text NOT NULL REFERENCES "user" ("id") ON DELETE CASCADE,
  "park_id" bigint NOT NULL REFERENCES "parks" ("id"),
  "transition" text NOT NULL,
  "at" timestamp with time zone NOT NULL,
  "source" text NOT NULL DEFAULT 'geofence',
  "platform" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX "user_park_transition_user_idx" ON "user_park_transition" ("user_id", "at" DESC);
CREATE INDEX "user_park_transition_park_idx" ON "user_park_transition" ("park_id", "at" DESC);
