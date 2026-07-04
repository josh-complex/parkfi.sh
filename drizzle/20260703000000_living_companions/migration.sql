-- ============================================================================
-- Living Layer / Kingdom Hearts (M5) — Wielder profile + companion recruitment.
--
-- SAFETY: purely additive. Only CREATEs new tables — no changes to anything
-- existing. Backs `living.profile` / `living.companions` / `living.recruit`
-- (see src/integrations/trpc/routers/living.ts) and the companion seed script
-- (scripts/seed-companions.ts), which address these tables via raw SQL.
--
-- Runs AFTER 20260701000000_kh_terminology_rename, so `world` exists here.
--
-- Convention: hand-written timestamped migration (no _journal.json, no
-- drizzle-kit generate) — see docs/plans/living-layer/14-implementation-plan.md.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- wielder — per-user game profile. 1:1 with `user`; created on first
-- progression (a seal or a recruit). rank is derived from xp (100 xp / rank).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "wielder" (
  "user_id"      text PRIMARY KEY REFERENCES "user"("id"),
  "display_name" text,
  "rank"         integer NOT NULL DEFAULT 1,
  "xp"           integer NOT NULL DEFAULT 0,
  "home_park_id" bigint REFERENCES "parks"("id"),
  "created_at"   timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- companion — recruitable ally catalog, each bound to a World (land) and a
-- signature ride in it. Seeded per park.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "companion" (
  "id"                      bigserial PRIMARY KEY,
  "home_world_id"           bigint REFERENCES "world"("id"),
  "signature_attraction_id" bigint REFERENCES "attractions"("id"),
  "name"                    text NOT NULL,
  "slug"                    text NOT NULL UNIQUE,
  "element"                 text,
  "role"                    text,
  "base_stats"              jsonb NOT NULL DEFAULT '{}'::jsonb,
  "image_r2_key"            text
);
CREATE INDEX IF NOT EXISTS "companion_home_world_idx" ON "companion" ("home_world_id");

-- ---------------------------------------------------------------------------
-- wielder_companion — a Wielder's recruited roster (many-to-many join).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "wielder_companion" (
  "user_id"      text NOT NULL REFERENCES "user"("id"),
  "companion_id" bigint NOT NULL REFERENCES "companion"("id"),
  "level"        integer NOT NULL DEFAULT 1,
  "xp"           integer NOT NULL DEFAULT 0,
  "recruited_at" timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("user_id", "companion_id")
);
