import crypto from "node:crypto";

import { eq } from "drizzle-orm";

import { db } from "#/db/index.ts";
import { scraperSession } from "#/db/schema.ts";

/**
 * Encrypted scraper-session store (AES-256-GCM). The blob is a live account
 * credential (OneID cookies + localStorage), so it never lands in the DB in the
 * clear — the key comes from `SESSION_ENC_KEY` (hex-64 or base64-32), kept out
 * of this DB. See research/disney-ticket-deep-dive.md §8.
 */

const ALGO = "aes-256-gcm";

export interface StorageState {
  // puppeteer Cookie[] from page.cookies() + a localStorage snapshot
  cookies: Array<Record<string, unknown>>;
  localStorage: Record<string, string>;
}

function key(): Buffer {
  const raw = process.env.SESSION_ENC_KEY;
  if (!raw) throw new Error("SESSION_ENC_KEY not set");
  const buf = raw.length === 64 ? Buffer.from(raw, "hex") : Buffer.from(raw, "base64");
  if (buf.length !== 32)
    throw new Error("SESSION_ENC_KEY must decode to 32 bytes (hex-64 or base64)");
  return buf;
}

/**
 * Decrypt the encrypted blob stored under `name`, or null if absent /
 * key-mismatch / corrupt. Generic over the stored shape — `loadSession` is the
 * `StorageState` specialisation; the OneID refresh token uses it directly.
 */
export async function loadSecret<T>(name: string): Promise<T | null> {
  const [row] = await db
    .select()
    .from(scraperSession)
    .where(eq(scraperSession.name, name))
    .limit(1);
  if (!row) return null;
  try {
    const decipher = crypto.createDecipheriv(ALGO, key(), Buffer.from(row.iv, "base64"));
    decipher.setAuthTag(Buffer.from(row.authTag, "base64"));
    const plain = Buffer.concat([
      decipher.update(Buffer.from(row.ciphertext, "base64")),
      decipher.final(),
    ]);
    return JSON.parse(plain.toString("utf8")) as T;
  } catch {
    return null; // bad key / tampered / stale format → treat as "absent"
  }
}

/** Encrypt + upsert an arbitrary JSON blob (one row per `name`). */
export async function saveSecret(
  name: string,
  value: unknown,
  opts: { accountLabel?: string; expiresAt?: Date } = {},
): Promise<void> {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, key(), iv);
  const enc = Buffer.concat([
    cipher.update(Buffer.from(JSON.stringify(value), "utf8")),
    cipher.final(),
  ]);
  const row = {
    name,
    accountLabel: opts.accountLabel ?? null,
    ciphertext: enc.toString("base64"),
    iv: iv.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
    expiresAt: opts.expiresAt ?? null,
    lastValidatedAt: new Date(),
  };
  await db
    .insert(scraperSession)
    .values(row)
    .onConflictDoUpdate({
      target: scraperSession.name,
      set: {
        accountLabel: row.accountLabel,
        ciphertext: row.ciphertext,
        iv: row.iv,
        authTag: row.authTag,
        expiresAt: row.expiresAt,
        lastValidatedAt: row.lastValidatedAt,
        updatedAt: new Date(),
      },
    });
}

/** Decrypt the stored browser session (`StorageState`), or null if absent. */
export function loadSession(name: string): Promise<StorageState | null> {
  return loadSecret<StorageState>(name);
}

/** Encrypt + upsert a browser session blob. */
export function saveSession(
  name: string,
  state: StorageState,
  opts: { accountLabel?: string; expiresAt?: Date } = {},
): Promise<void> {
  return saveSecret(name, state, opts);
}
