-- Disneyland Resort (DLR) support for the stays sweep. DLR is a separate Disney
-- store with its own resort-availability endpoint; the sweep now keeps both WDW
-- and DLR tuples warm. `store` is also folded into `party_key`, so WDW and DLR
-- never collide in a `stay_obs` generation (the read path takes the single
-- latest generation per (check_in, check_out, party_key)). We keep it as a
-- column too so `stayQueryToParams` can rebuild the right request body and pick
-- the right endpoint from a `stay_query` row alone.
--
-- Existing rows are all WDW, hence the default. New rows carry an explicit
-- 'wdw' | 'dlr'.

ALTER TABLE "stay_query" ADD COLUMN IF NOT EXISTS "store" text NOT NULL DEFAULT 'wdw';
