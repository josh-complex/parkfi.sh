/**
 * One-shot backfill: fetch the source og:image for every `news_item` row that
 * doesn't have one yet (the pre-image-feature backlog). Deterministic scrape,
 * no AI — same `fetchOgImage` the park-news cron uses for new items going
 * forward, so after this runs once the cron never needs to backfill again.
 *
 * Resumable: only selects rows where image_url IS NULL, so a re-run (e.g.
 * after a transient failure or a batch of dead links) just picks up where it
 * left off.
 *
 * Env (optional):
 *   NEWS_IMAGE_DELAY_MS   ms between requests (default: 200)
 *
 * Run:  bun run backfill:news-images
 */
import { config as loadEnv } from "dotenv";
loadEnv({ path: [".env.local", ".env"] });

import { eq, isNull } from "drizzle-orm";

import { db } from "#/db/index.ts";
import { newsItem } from "#/db/schema.ts";
import { fetchOgImage } from "../services/cron-park-news/og-image.ts";

const DELAY_MS = Number(process.env.NEWS_IMAGE_DELAY_MS ?? 200);

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const rows = await db
    .select({ id: newsItem.id, url: newsItem.url })
    .from(newsItem)
    .where(isNull(newsItem.imageUrl));

  console.log(`[backfill-news-images] ${rows.length} row(s) missing an image`);
  if (rows.length === 0) return;

  let filled = 0;
  let missed = 0;
  for (const [i, row] of rows.entries()) {
    const og = await fetchOgImage(row.url);
    if (og) {
      await db.update(newsItem).set({ imageUrl: og.url }).where(eq(newsItem.id, row.id));
      filled++;
    } else {
      missed++;
    }
    if ((i + 1) % 25 === 0 || i === rows.length - 1) {
      console.log(
        `[backfill-news-images] ${i + 1}/${rows.length} (${filled} filled, ${missed} no image)`,
      );
    }
    await sleep(DELAY_MS);
  }

  console.log(`[backfill-news-images] done — ${filled} filled, ${missed} had no og:image`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
