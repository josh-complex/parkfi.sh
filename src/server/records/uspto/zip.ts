/**
 * Minimal in-memory ZIP reader — central directory + local headers, methods
 * "stored" (0) and "deflate" (8), no ZIP64, no encryption. That's exactly the
 * shape of USPTO bulk zips (one large XML per archive, well under 4 GB), and
 * it keeps the records module free of a zip dependency. Deflate goes through
 * Node's `zlib.inflateRawSync`.
 */
import { inflateRawSync } from "node:zlib";

const SIG_EOCD = 0x06054b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_LOCAL = 0x04034b50;

export interface ZipEntry {
  name: string;
  compressedSize: number;
  uncompressedSize: number;
  method: number;
  /** Decompressed bytes (decoded lazily, once). */
  read(): Buffer;
}

export function readZipEntries(zip: Buffer): ZipEntry[] {
  // End-of-central-directory record is within the last 64 KiB + 22 bytes.
  let eocd = -1;
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 65_557); i--) {
    if (zip.readUInt32LE(i) === SIG_EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("zip: end-of-central-directory not found");
  const entryCount = zip.readUInt16LE(eocd + 10);
  const centralOffset = zip.readUInt32LE(eocd + 16);
  if (entryCount === 0xffff || centralOffset === 0xffffffff) {
    throw new Error("zip: ZIP64 archives are not supported");
  }

  const entries: ZipEntry[] = [];
  let p = centralOffset;
  for (let i = 0; i < entryCount; i++) {
    if (zip.readUInt32LE(p) !== SIG_CENTRAL) throw new Error("zip: bad central directory entry");
    const method = zip.readUInt16LE(p + 10);
    const compressedSize = zip.readUInt32LE(p + 20);
    const uncompressedSize = zip.readUInt32LE(p + 24);
    const nameLen = zip.readUInt16LE(p + 28);
    const extraLen = zip.readUInt16LE(p + 30);
    const commentLen = zip.readUInt16LE(p + 32);
    const localOffset = zip.readUInt32LE(p + 42);
    const name = zip.toString("utf8", p + 46, p + 46 + nameLen);
    if (compressedSize === 0xffffffff || uncompressedSize === 0xffffffff) {
      throw new Error(`zip: ZIP64 entry ${name} is not supported`);
    }
    p += 46 + nameLen + extraLen + commentLen;

    let cached: Buffer | null = null;
    entries.push({
      name,
      compressedSize,
      uncompressedSize,
      method,
      read() {
        if (cached) return cached;
        if (zip.readUInt32LE(localOffset) !== SIG_LOCAL)
          throw new Error(`zip: bad local header for ${name}`);
        const lNameLen = zip.readUInt16LE(localOffset + 26);
        const lExtraLen = zip.readUInt16LE(localOffset + 28);
        const start = localOffset + 30 + lNameLen + lExtraLen;
        const raw = zip.subarray(start, start + compressedSize);
        if (method === 0) cached = Buffer.from(raw);
        else if (method === 8) cached = inflateRawSync(raw);
        else throw new Error(`zip: unsupported compression method ${method} for ${name}`);
        return cached;
      },
    });
  }
  return entries;
}
