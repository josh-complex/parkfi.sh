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
-- We match `data:image/svg+xml%` specifically (what the bot generator emits) —
-- not a broad `data:%` — so a stray raster data URI from any old code path could
-- never be mistaken for a bot avatar and clobbered. The seed is the user id,
-- which better-auth generates as URL-safe alphanumerics (no encoding needed).
-- Idempotent: rows already rewritten no longer match.
--
-- NOTE: users who picked a *randomized* bot in profile settings had their avatar
-- seeded by a random UUID (stored only in the data URI); this reseeds them to
-- their user id, so their bot changes appearance. Default (never-customized)
-- avatars were already seeded by the user id, so they look identical.

UPDATE "user"
SET image = 'https://parkfi.sh/api/avatar/' || id
WHERE image LIKE 'data:image/svg+xml%';
