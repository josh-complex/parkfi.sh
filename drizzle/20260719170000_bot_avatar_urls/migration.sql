-- Move bot avatars off inline data URIs onto the deterministic
-- `/api/avatar/:seed` route (src/lib/avatar.ts botAvatarUrl + the
-- src/routes/api/avatar/$seed.ts handler). The old form stored a ~27 KB
-- `data:image/svg+xml,...` string on user.image; once better-auth's cookieCache
-- serialized the user into the signed session cookie that blew past the request
-- header limit and 431'd every request. Rewriting to the ~40-byte URL keeps the
-- cookie (and every session read / SSR payload) small.
--
-- Only bot avatars are data URIs here: uploaded photos already go through the
-- avatar upload mutation and land as R2 URLs, and OAuth avatars are remote URLs.
-- So `LIKE 'data:%'` targets exactly the generated bot avatars. The seed is the
-- user id, which better-auth generates as URL-safe alphanumerics (no encoding
-- needed). Idempotent: rows already rewritten no longer match.

UPDATE "user"
SET image = 'https://parkfi.sh/api/avatar/' || id
WHERE image LIKE 'data:%';
