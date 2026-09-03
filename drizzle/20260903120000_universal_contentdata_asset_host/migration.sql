-- Repair Universal artwork stored in the bare web-origin form.
--
-- Tridion assets live under `https://www.universalorlando.com/contentdata/uor/…`;
-- the bare `https://www.universalorlando.com/uor/…` form 301s to `oops-sorry`,
-- so Cloudflare's image transform returns 415 and the card shows a placeholder.
-- The enrichment pass built the bare form until 2026-08-29 (11b49b1), and the
-- GeoCron service kept running the older build after that, so 29 thumbs and 93
-- heroes across Epic Universe / IOA / USF / Volcano Bay still hold it. The
-- geo run now normalizes both forms (`universalAssetUrl`), so this only has to
-- fix what is already there. Re-running is a no-op.
--
-- `image_thumbhash_src` is rewritten in step so the thumbhash filler doesn't
-- recompute an unchanged image (it compares hash_src to image_thumb_url).
UPDATE "attraction_meta"
SET "image_thumb_url" = regexp_replace("image_thumb_url", '^https?://(www\.)?universalorlando\.com/uor/', 'https://www.universalorlando.com/contentdata/uor/'),
    "image_hero_url" = regexp_replace("image_hero_url", '^https?://(www\.)?universalorlando\.com/uor/', 'https://www.universalorlando.com/contentdata/uor/'),
    "image_thumbhash_src" = regexp_replace("image_thumbhash_src", '^https?://(www\.)?universalorlando\.com/uor/', 'https://www.universalorlando.com/contentdata/uor/')
WHERE "image_thumb_url" ~ '^https?://(www\.)?universalorlando\.com/uor/'
   OR "image_hero_url" ~ '^https?://(www\.)?universalorlando\.com/uor/'
   OR "image_thumbhash_src" ~ '^https?://(www\.)?universalorlando\.com/uor/';
