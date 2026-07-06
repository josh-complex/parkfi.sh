-- ============================================================================
-- Cast-member content removal / correction requests.
--
-- SAFETY: purely additive. Two new tables, nothing existing is touched.
--
--   removal_request     an audit trail of who (a verified cast member) asked to
--                       remove or correct what. requester_id / resolved_by_id are
--                       ON DELETE SET NULL so a takedown record survives account
--                       deletion, minus the PII link.
--   content_suppression the reversible enforcement overlay read paths consult:
--                       one row per (entity, field) that is currently hidden.
--                       Lifting a suppression is a single active=false.
-- ============================================================================

CREATE TABLE IF NOT EXISTS "removal_request" (
  "id"              bigserial PRIMARY KEY,
  "requester_id"    text REFERENCES "user"("id") ON DELETE SET NULL,
  "org_tenant_id"   text,
  "entity_type"     text NOT NULL,          -- park | attraction | restaurant | shop | resort
  "entity_id"       text NOT NULL,
  "target_field"    text,                   -- listing | image | menu (null = unspecified)
  "reason"          text NOT NULL,          -- inaccurate | unauthorized_media | confidential | other
  "note"            text,
  "status"          text NOT NULL DEFAULT 'open',  -- open | acknowledged | actioned | declined
  "resolved_by_id"  text REFERENCES "user"("id") ON DELETE SET NULL,
  "resolved_at"     timestamptz,
  "resolution_note" text,
  "created_at"      timestamptz NOT NULL DEFAULT now(),
  "updated_at"      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "removal_request_status_idx" ON "removal_request" ("status", "created_at");
CREATE INDEX IF NOT EXISTS "removal_request_entity_idx" ON "removal_request" ("entity_type", "entity_id");
CREATE INDEX IF NOT EXISTS "removal_request_requester_idx" ON "removal_request" ("requester_id");

CREATE TABLE IF NOT EXISTS "content_suppression" (
  "entity_type"       text NOT NULL,
  "entity_id"         text NOT NULL,
  "field"             text NOT NULL,        -- '*' = whole listing, else field name (image, menu)
  "active"            boolean NOT NULL DEFAULT true,
  "source_request_id" bigint REFERENCES "removal_request"("id") ON DELETE SET NULL,
  "created_at"        timestamptz NOT NULL DEFAULT now(),
  "updated_at"        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("entity_type", "entity_id", "field")
);
