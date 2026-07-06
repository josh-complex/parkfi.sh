-- ============================================================================
-- User org role — cast-member / team-member detection via Microsoft Entra.
--
-- SAFETY: purely additive. Two nullable/defaulted columns on "user"; nothing
-- existing is touched and no backfill is required.
--
--   role          privilege tier. Defaults to 'user' for every existing row.
--                 Elevated (e.g. 'cast_member') only server-side when a linked
--                 Microsoft account's tenant id (`tid`) matches the org
--                 allowlist in MICROSOFT_CAST_MEMBER_TENANT_IDS.
--   org_tenant_id the Entra tenant GUID a user authenticated through, if any.
--                 Stable per-organization identifier; the source of `role`.
-- ============================================================================

ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "role" text NOT NULL DEFAULT 'user';
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "org_tenant_id" text;
