-- Public-records intelligence, Feed v2 step 1 — job grouping
-- (docs/plans/public-records-intelligence.md §6.1a).
--
-- One government job is many tickets: the City issues a permit per trade per
-- phase, the USPTO a serial per class. `job_key` groups them; `job_title` is
-- the job's as-filed name. Both are derived (adapters set them, ingest prefixes
-- the source id) and NOT part of the content hash, so this backfill creates no
-- revisions. The SQL below mirrors `jobSlug()` in src/server/records/normalize.ts
-- and each adapter's key rule — keep them in step.

ALTER TABLE "public_record" ADD COLUMN IF NOT EXISTS "job_key" text;
--> statement-breakpoint
ALTER TABLE "public_record" ADD COLUMN IF NOT EXISTS "job_title" text;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "public_record_job_idx" ON "public_record" ("job_key");
--> statement-breakpoint

-- Orlando permits: slug(project_name) @ slug(address); annual blanket permits
-- key per address + processed year. No project name → no key.
UPDATE "public_record" r
SET job_key = 'orlando_soda:' ||
      CASE
        WHEN (r.payload->>'projectName') ~* '\yannual\y' OR (r.payload->>'projectName') ~* '^AFP\y'
          THEN 'afp:' || coalesce(left(r.payload->>'processedDate', 4), 'unknown')
        ELSE trim(both '-' from regexp_replace(lower(r.payload->>'projectName'), '[^a-z0-9]+', '-', 'g'))
      END
      || '@' || coalesce(trim(both '-' from regexp_replace(lower(r.payload->>'address'), '[^a-z0-9]+', '-', 'g')), ''),
    job_title = r.payload->>'projectName'
WHERE r.source = 'orlando_soda'
  AND r.job_key IS NULL
  AND coalesce(r.payload->>'projectName', '') <> '';
--> statement-breakpoint

-- Trademarks: one mark across classes.
UPDATE "public_record" r
SET job_key = 'uspto_tm:' || trim(both '-' from regexp_replace(lower(r.payload->>'markText'), '[^a-z0-9]+', '-', 'g')),
    job_title = r.payload->>'markText'
WHERE r.source = 'uspto_tm'
  AND r.job_key IS NULL
  AND coalesce(r.payload->>'markText', '') <> '';
--> statement-breakpoint

-- Patents: title | first inventor (application ↔ grant, continuations).
UPDATE "public_record" r
SET job_key = 'uspto_patent:' || trim(both '-' from regexp_replace(lower(r.title), '[^a-z0-9]+', '-', 'g'))
      || CASE WHEN coalesce(r.payload->'inventors'->>0, '') <> ''
              THEN '|' || trim(both '-' from regexp_replace(lower(r.payload->'inventors'->>0), '[^a-z0-9]+', '-', 'g'))
              ELSE '' END,
    job_title = r.title
WHERE r.source = 'uspto_patent'
  AND r.job_key IS NULL;
--> statement-breakpoint

-- FAA studies: the sponsor's structure name ("Project 913 crane").
UPDATE "public_record" r
SET job_key = 'faa_oeaaa:' || trim(both '-' from regexp_replace(lower(r.payload->>'structureName'), '[^a-z0-9]+', '-', 'g')),
    job_title = r.payload->>'structureName'
WHERE r.source = 'faa_oeaaa'
  AND r.job_key IS NULL
  AND coalesce(r.payload->>'structureName', '') <> '';
