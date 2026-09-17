-- Hard-ticket event artwork + per-house card copy (the Universal Studios park
-- page's Halloween Horror Nights band).
--
-- Two unrelated-looking things in one migration because one ingest pass writes
-- both: the geo cron already fetches Universal's `/hhn` pages, and everything
-- here is a field it was parsing past and throwing away.
--
--   * `attraction_meta.tagline` / `.trailer_url` — an HHN house card publishes
--     the house name as its `eyebrow` and a tagline as its `heading` ("You're
--     in for One Bluesy Bloodbath"), plus a trailer link on its button. We were
--     keeping only the name and the description.
--
--   * `park_event_art` — the logo lockup and background plate the operator
--     dresses its own event pages with. Per *event*, not per park: USF runs HHN
--     and then Mardi Gras, and Universal keys the plates to the year
--     (`hhn26-texture-top-lvp.jpg`), so a park-level slot would have each season
--     overwrite the last. `slug` is stable across years (`hhn`); `name` is what
--     this year's page calls the event, and the band matches it against the
--     park's ticketed-event schedule row.
--
-- All columns nullable: the band falls back to its own CSS field, so an
-- upstream re-skin degrades to the old look rather than to a hole.
--
-- Hand-written per the repo convention.

ALTER TABLE "attraction_meta" ADD COLUMN IF NOT EXISTS "tagline" text;
--> statement-breakpoint
ALTER TABLE "attraction_meta" ADD COLUMN IF NOT EXISTS "trailer_url" text;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "park_event_art" (
  "park_id"    bigint NOT NULL REFERENCES "parks"("id"),
  "slug"       text   NOT NULL,
  "name"       text,
  "logo_url"   text,
  "logo_alt"   text,
  "plate_url"  text,
  "source"     smallint NOT NULL REFERENCES "ref_source"("id"),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "park_event_art_pk" PRIMARY KEY ("park_id", "slug")
);
