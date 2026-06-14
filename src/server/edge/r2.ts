/**
 * Cloudflare R2 writer (S3-compatible API via the AWS SDK that's already a dep).
 *
 * Used to publish precomputed, all-users-identical artifacts — the per-park
 * crowd-calendar forecast — to object storage that Cloudflare serves straight
 * from the edge. The read path then hits a static JSON on a public R2 domain
 * instead of Postgres, so forecast reads cost the origin nothing.
 *
 * Reads credentials from `process.env`; `isR2Configured()` lets callers skip
 * gracefully when unconfigured (local/preview) instead of throwing.
 *
 * Required env: R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET.
 */
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

let client: S3Client | null = null;

export function isR2Configured(): boolean {
  return Boolean(
    process.env.R2_ACCOUNT_ID &&
    process.env.R2_ACCESS_KEY_ID &&
    process.env.R2_SECRET_ACCESS_KEY &&
    process.env.R2_BUCKET,
  );
}

function getClient(): S3Client {
  if (client) return client;
  client = new S3Client({
    region: "auto",
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID ?? "",
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY ?? "",
    },
  });
  return client;
}

/**
 * Upload a JSON object to R2 at `key`. `cacheControl` is stored on the object
 * and returned by Cloudflare when serving it (the edge cache lever for the
 * public read path). No-throw contract: returns false on failure so a publish
 * loop can continue to the next park.
 */
export async function putJson(
  key: string,
  data: unknown,
  cacheControl = "public, max-age=900, s-maxage=900, stale-while-revalidate=86400",
): Promise<boolean> {
  if (!isR2Configured()) return false;
  try {
    await getClient().send(
      new PutObjectCommand({
        Bucket: process.env.R2_BUCKET,
        Key: key,
        Body: JSON.stringify(data),
        ContentType: "application/json; charset=utf-8",
        CacheControl: cacheControl,
      }),
    );
    return true;
  } catch (err) {
    console.error(`[edge/r2] put ${key} failed`, err);
    return false;
  }
}
