-- ============================================================================
-- Kingdom Hearts terminology — rename the already-applied Living Layer tables
-- from the old loose-skin placeholders to canonical names.
--
--   realm            → world           (themed lands = KH Worlds)
--   ref_faded_type   → ref_heartless_type   (enemy archetypes = Heartless)
--   mark.realm_id    → mark.world_id
--   encounter_log.faded_type → encounter_log.heartless_type
--
-- NOTE ordering: this runs BEFORE 20260703000000_living_companions, which
-- creates `companion.home_world_id REFERENCES world(id)` — so `world` must
-- already exist by then. Purely renames; no data change. FKs follow renames
-- automatically. The mark-lifecycle state code 'faded' is a DIFFERENT concept
-- (an expired mark) and is intentionally left untouched.
--
-- Convention: hand-written timestamped migration (no _journal.json, no
-- drizzle-kit generate) — see docs/plans/living-layer/14-implementation-plan.md.
-- ============================================================================

ALTER TABLE IF EXISTS "realm" RENAME TO "world";
ALTER INDEX IF EXISTS "realm_park_slug_idx" RENAME TO "world_park_slug_idx";

ALTER TABLE IF EXISTS "mark" RENAME COLUMN "realm_id" TO "world_id";
ALTER INDEX IF EXISTS "mark_realm_type_idx" RENAME TO "mark_world_type_idx";

ALTER TABLE IF EXISTS "ref_faded_type" RENAME TO "ref_heartless_type";

ALTER TABLE IF EXISTS "encounter_log" RENAME COLUMN "faded_type" TO "heartless_type";
