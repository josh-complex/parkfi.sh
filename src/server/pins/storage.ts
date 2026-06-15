/**
 * R2 storage helpers for pin images. Mirrors the avatar upload flow in the
 * `uploads` router (sharp → webp → PutObject) but for two pin use-cases:
 *  - scan photos (`pins/scans/<scanId>.webp`) — the user's hand-held capture.
 *  - reference images (`pins/ref/<pinImageId>.webp`) — canonical catalog shots.
 *
 * Reference images are public-readable (served to the candidate UI); scan photos
 * are stored under the same bucket but only ever surfaced back to their owner.
 */
import { PutObjectCommand } from "@aws-sdk/client-s3";
import sharp from "sharp";

import { r2, R2_BUCKET, R2_PUBLIC_URL } from "#/lib/r2.ts";

/** Public URL for any R2 key (reference images + a scan's own owner view). */
export function pinPublicUrl(key: string): string {
  return `${R2_PUBLIC_URL}/${key}`;
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
      Bucket: R2_BUCKET,
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
