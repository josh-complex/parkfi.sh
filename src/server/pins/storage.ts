/**
 * R2 storage helpers for pin images. Mirrors the avatar upload flow in the
 * `uploads` router (sharp → webp → PutObject) but for two pin use-cases:
 *  - scan photos (`pins/scans/<scanId>.webp`) — the user's hand-held capture.
 *  - reference images (`pins/ref/<pinImageId>.webp`) — canonical catalog shots.
 *
 * Reference images are public-readable (served to the candidate UI); scan photos
 * live in the same bucket but are only ever surfaced back to their owner.
 *
 * Pin images get their OWN bucket (`PIN_R2_BUCKET` / `PIN_R2_PUBLIC_URL`) — the
 * catalog grows to 100k+ images with a different access pattern than the app's
 * avatar bucket, so they don't share `R2_BUCKET`. The R2 credentials are account-
 * level (same `r2` client), so only the bucket name + public URL differ; the
 * token must be scoped to (or include) this bucket. Falls back to the app bucket
 * if the PIN_* vars are unset, but a dedicated bucket is the intended setup.
 */
import { PutObjectCommand } from "@aws-sdk/client-s3";
import sharp from "sharp";

import { r2, R2_BUCKET, R2_PUBLIC_URL } from "#/lib/r2.ts";

const PIN_BUCKET = process.env.PIN_R2_BUCKET ?? R2_BUCKET;
const PIN_PUBLIC_URL = process.env.PIN_R2_PUBLIC_URL ?? R2_PUBLIC_URL;

/** Public URL for any pin R2 key (reference images + a scan's own owner view). */
export function pinPublicUrl(key: string): string {
  return `${PIN_PUBLIC_URL}/${key}`;
}

/** Decode a `data:image/...;base64,...` URI to raw bytes. */
export function dataUriToBuffer(dataUri: string): Buffer {
  const commaIdx = dataUri.indexOf(",");
  return Buffer.from(dataUri.slice(commaIdx + 1), "base64");
}

async function putWebp(key: string, raw: Buffer, maxEdge: number): Promise<string> {
  const body = await sharp(raw)
    .rotate() // honor EXIF orientation from phone cameras
    .resize(maxEdge, maxEdge, { fit: "inside", withoutEnlargement: true })
    .webp({ quality: 82 })
    .toBuffer();
  await r2.send(
    new PutObjectCommand({
      Bucket: PIN_BUCKET,
      Key: key,
      Body: body,
      ContentType: "image/webp",
      CacheControl: "public, max-age=31536000, immutable",
    }),
  );
  return key;
}

/** Store a freshly-captured scan photo. Returns the R2 key. */
export function putScanPhoto(scanId: string, raw: Buffer): Promise<string> {
  return putWebp(`pins/scans/${scanId}.webp`, raw, 1024);
}

/** Store a canonical reference image. Returns the R2 key. */
export function putReferenceImage(pinImageId: string, raw: Buffer): Promise<string> {
  return putWebp(`pins/ref/${pinImageId}.webp`, raw, 1024);
}
