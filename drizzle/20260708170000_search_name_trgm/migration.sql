-- Trigram GIN indexes backing the server-side omni-search fuzzy match
-- (`search.query`). Each section now matches names/titles on the server with
-- `ILIKE '%q%'` plus the pg_trgm `%` similarity operator (typo tolerance),
-- ranked by `similarity()`. Without these that's a sequential scan of the whole
-- table on every (debounced) keystroke. Mirrors the existing
-- `dining_menu_item_title_trgm` index. `gin_trgm_ops` serves both the substring
-- (`ILIKE`/`LIKE`) and the similarity (`%`, `similarity()`) matches the query
-- relies on. Transaction-safe (not CONCURRENTLY) so it runs under the
-- single-transaction `drizzle-kit migrate` wrapper.

CREATE EXTENSION IF NOT EXISTS pg_trgm;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "restaurant_dim_name_trgm"
  ON "restaurant_dim" USING gin ("name" gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "attractions_name_trgm"
  ON "attractions" USING gin ("name" gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "blog_post_title_trgm"
  ON "blog_post" USING gin ("title" gin_trgm_ops);
