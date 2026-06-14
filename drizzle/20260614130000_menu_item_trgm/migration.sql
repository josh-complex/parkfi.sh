-- Trigram index for omni-search menu-item lookup. `search.menuItems` matches
-- item titles with `ILIKE '%q%'`; without a trigram index that's a sequential
-- scan over every live menu generation. A GIN trigram index on lower(title)
-- serves both the substring (`ILIKE '%q%'`) and prefix (`LIKE 'q%'`) matches the
-- query relies on. Transaction-safe (not CONCURRENTLY) so it runs under the
-- single-transaction `drizzle-kit migrate` wrapper.

CREATE EXTENSION IF NOT EXISTS pg_trgm;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "dining_menu_item_title_trgm"
  ON "dining_menu_item" USING gin (lower("title") gin_trgm_ops);
