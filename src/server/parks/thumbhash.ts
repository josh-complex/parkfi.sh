/**
 * ThumbHash computation for catalog artwork (attraction_meta.image_thumbhash).
 *
 * A ThumbHash is a ~25-byte fingerprint of an image that decodes client-side
 * into a blurry, color-accurate preview — painted instantly under `<Image>`
 * (its `placeholder` prop) so content tiles are never blank while the real
 * photo loads.
 *
 * The source is normalized through our own Cloudflare transform (tiny baseline
 * JPEG, ≤64px) so any origin format — Disney JPEGs, Universal PNG/WebP — decodes
 * with the pure-JS `jpeg-js`, no native image deps. That means computation only
 * works where the deployed transform endpoint is reachable (the geo cron on
 * Railway; not `vp dev`), which is fine: hashes are computed offline and read
 * from the DB everywhere else.
 */
import { decode } from "jpeg-js";
import { sql } from "drizzle-orm";
import { rgbaToThumbHash } from "thumbhash";

import { db } from "#/db/index.ts";

/** The zone whose `/cdn-cgi/image/` endpoint normalizes sources to tiny JPEGs.
 *  Apex host on purpose — www 308s and `cdn-cgi` paths don't follow. */
const TRANSFORM_BASE = "https://parkfi.sh";

/**
 * Compute the base64 ThumbHash for a remote image, or null when the image
 * can't be fetched/decoded (bad URL, transform failure, origin block). Callers
 * treat null as "skip, retry next run" — never as a cached negative.
 */
export async function computeThumbhash(imageUrl: string): Promise<string | null> {
  // `fit=scale-down` inside a 64×64 box guarantees the ≤100px input ThumbHash
  // requires. No `onerror=redirect`: a failed transform must fail loudly here,
  // not fall through to the original (possibly non-JPEG, megabyte) asset.
  const url = `${TRANSFORM_BASE}/cdn-cgi/image/width=64,height=64,fit=scale-down,quality=80,format=jpeg/${imageUrl}`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok || !(res.headers.get("content-type") ?? "").includes("image/jpeg")) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    const { width, height, data } = decode(buf, { maxMemoryUsageInMB: 8 });
    if (width === 0 || height === 0 || width > 100 || height > 100) return null;
    return Buffer.from(rgbaToThumbHash(width, height, data)).toString("base64");
  } catch {
    return null;
  }
}

/**
 * Every table holding static-content artwork that gets a ThumbHash. Each has a
 * pair of columns: `image_thumbhash` (the base64 hash) and
 * `image_thumbhash_src` (the URL it was computed from). The src column is what
 * makes the filler pipeline-agnostic: any cron can overwrite an image URL
 * without knowing hashes exist — the next filler run sees hash_src ≠ url and
 * recomputes. (The stays resort catalog is a committed constant, not a table —
 * its hashes are baked by gen-resort-catalog.ts.)
 */
const THUMBHASH_TARGETS = [
  { table: "attraction_meta", pk: "attraction_id", urlCol: "image_thumb_url" },
  { table: "parks", pk: "id", urlCol: "image_url" },
  { table: "restaurant_dim", pk: "facility_id", urlCol: "image_url" },
  { table: "shop_dim", pk: "facility_id", urlCol: "image_url" },
  { table: "park_poi", pk: "poi_id", urlCol: "image_url" },
  { table: "news_item", pk: "id", urlCol: "image_url" },
  { table: "blog_post", pk: "id", urlCol: "hero_image_url" },
] as const;

/**
 * Compute hashes for every registered row whose artwork is new or changed
 * (hash missing, or computed from a different URL than the current one).
 * Idempotent and resumable — a clean catalog is one cheap SELECT per table —
 * so it runs from the daily park-news cron, the monthly geo cron, and
 * `bun run backfill:thumbhashes` without coordination. Failures stay NULL for
 * the next run.
 */
export async function fillMissingThumbhashes(): Promise<{ hashed: number; failed: number }> {
  let hashed = 0;
  let failed = 0;
  for (const t of THUMBHASH_TARGETS) {
    const [table, pk, url] = [sql.raw(t.table), sql.raw(t.pk), sql.raw(t.urlCol)];
    const rows = await db.execute<{ id: string; url: string }>(sql`
      SELECT ${pk} AS id, ${url} AS url
      FROM ${table}
      WHERE ${url} IS NOT NULL
        AND (image_thumbhash IS NULL OR image_thumbhash_src IS DISTINCT FROM ${url})
    `);
    // Small worker pool: the transform endpoint is fast and edge-cached, but be
    // a polite client of our own zone (and of the origins on cache misses).
    const queue = [...rows.rows];
    await Promise.all(
      Array.from({ length: 6 }, async () => {
        for (let row = queue.shift(); row; row = queue.shift()) {
          const hash = await computeThumbhash(row.url);
          if (hash) {
            await db.execute(sql`
              UPDATE ${table}
              SET image_thumbhash = ${hash}, image_thumbhash_src = ${row.url}
              WHERE ${pk} = ${row.id}
            `);
            hashed++;
          } else {
            failed++;
          }
        }
      }),
    );
    if (rows.rows.length > 0) {
      console.log(`[thumbhash] ${t.table}: ${rows.rows.length} stale/missing processed`);
    }
  }
  return { hashed, failed };
}
