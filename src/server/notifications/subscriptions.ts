import { createHash } from "node:crypto";
import { config as loadEnv } from "dotenv";
import Redis from "ioredis";
import type { PushSub } from "./push.ts";

// The web server (vite dev) doesn't inject non-VITE_ env vars into process.env,
// so without this REDIS_URL is undefined and ioredis silently falls back to
// localhost:6379. No-op in prod, where the platform injects env. See db/index.ts.
if (!process.env.REDIS_URL) loadEnv({ path: [".env.local", ".env"] });

let _redis: Redis | null = null;

function getRedis(): Redis {
  if (!_redis) _redis = new Redis(process.env.REDIS_URL!);
  return _redis;
}

/**
 * A stored subscription: browser web-push (legacy blobs have no `kind`) or a
 * native FCM device token (iOS routes through FCM too — single sender for
 * both platforms, see native-push.ts).
 */
export type StoredSub =
  | ({ kind?: "webpush" } & PushSub)
  | { kind: "fcm"; token: string; platform: "ios" | "android" };

function subKey(sub: StoredSub): string {
  return sub.kind === "fcm" ? sub.token : sub.endpoint;
}

function endpointHash(key: string): string {
  return createHash("sha256").update(key).digest("hex").slice(0, 16);
}

export async function addSub(userId: string, sub: StoredSub): Promise<void> {
  const r = getRedis();
  const hash = endpointHash(subKey(sub));
  await r.set(`push:sub:${hash}`, JSON.stringify({ userId, ...sub }));
  await r.sadd(`push:user:${userId}`, hash);
}

export async function removeSub(userId: string, key: string): Promise<void> {
  const r = getRedis();
  const hash = endpointHash(key);
  await r.del(`push:sub:${hash}`);
  await r.srem(`push:user:${userId}`, hash);
}

export async function removeStale(userId: string, sub: StoredSub): Promise<void> {
  return removeSub(userId, subKey(sub));
}

/**
 * Purge every push subscription for a user (account deletion). Deletes each
 * referenced `push:sub:{hash}` blob plus the `push:user:{userId}` set itself,
 * so hashes whose blob already expired are cleaned up too.
 */
export async function removeAllSubs(userId: string): Promise<void> {
  const r = getRedis();
  const userKey = `push:user:${userId}`;
  const hashes = await r.smembers(userKey);
  const keys = hashes.map((h) => `push:sub:${h}`);
  await r.del(...keys, userKey);
}

export async function getSubsForUser(userId: string): Promise<StoredSub[]> {
  const r = getRedis();
  const hashes = await r.smembers(`push:user:${userId}`);
  if (!hashes.length) return [];
  const blobs = await r.mget(hashes.map((h) => `push:sub:${h}`));
  return blobs
    .filter((b): b is string => b !== null)
    .map((b) => JSON.parse(b) as StoredSub & { userId: string });
}
