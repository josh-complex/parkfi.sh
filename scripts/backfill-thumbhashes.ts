/**
 * One-shot backfill: compute the ThumbHash placeholder for every registered
 * image-bearing row (attractions, parks, restaurants, shops, POIs, news items,
 * blog posts — see THUMBHASH_TARGETS) whose artwork has no current hash — the
 * pre-placeholder-feature backlog. Same `fillMissingThumbhashes` the daily
 * park-news cron and monthly geo cron run for new/changed artwork going
 * forward, so after this runs once the crons keep it current. (The stays
 * resort catalog is a committed constant — its hashes are baked by
 * gen-resort-catalog.ts, not this backfill.)
 *
 * Resumable: only selects rows whose hash is missing or was computed from a
 * different URL, so a re-run just picks up where it left off. Needs the
 * deployed Cloudflare transform endpoint (parkfi.sh) reachable — see
 * src/server/parks/thumbhash.ts.
 *
 * Run:  bun run backfill:thumbhashes
 */
import { config as loadEnv } from "dotenv";
loadEnv({ path: [".env.local", ".env"] });

async function main() {
  // Imported after loadEnv so `#/db` sees DATABASE_URL.
  const { fillMissingThumbhashes } = await import("#/server/parks/thumbhash.ts");
  const { hashed, failed } = await fillMissingThumbhashes();
  console.log(`[backfill-thumbhashes] done — ${hashed} computed, ${failed} failed`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
