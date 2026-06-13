-- Rename credential_id → webauthn_userid to match the Drizzle schema property mapping.
-- The colorful_namora migration created the passkey table with "credential_id", but
-- the Drizzle schema maps credentialID to the column name "webauthn_userid". The
-- add_2fa_passkey migration used CREATE TABLE IF NOT EXISTS so was silently skipped,
-- leaving the column name mismatched and causing every passkey query to fail.
DROP INDEX IF EXISTS "passkey_credential_id_idx";
--> statement-breakpoint
ALTER TABLE "passkey" RENAME COLUMN "credential_id" TO "webauthn_userid";
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "passkey_webauthn_userid_idx" ON "passkey" ("webauthn_userid");
