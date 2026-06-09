import { createHash } from "node:crypto";
import Redis from "ioredis";
import type { PushSub } from "./push.ts";

let _redis: Redis | null = null;

function getRedis(): Redis {
  if (!_redis) _redis = new Redis(process.env.REDIS_URL!);
  return _redis;
}

function endpointHash(endpoint: string): string {
  return createHash("sha256").update(endpoint).digest("hex").slice(0, 16);
}

export async function addSub(userId: string, sub: PushSub): Promise<void> {
  const r = getRedis();
  const hash = endpointHash(sub.endpoint);
  await r.set(`push:sub:${hash}`, JSON.stringify({ userId, ...sub }));
  await r.sadd(`push:user:${userId}`, hash);
}

export async function removeSub(userId: string, endpoint: string): Promise<void> {
  const r = getRedis();
  const hash = endpointHash(endpoint);
  await r.del(`push:sub:${hash}`);
  await r.srem(`push:user:${userId}`, hash);
}

export async function removeStale(userId: string, endpoint: string): Promise<void> {
  return removeSub(userId, endpoint);
}

export async function getSubsForUser(userId: string): Promise<PushSub[]> {
  const r = getRedis();
  const hashes = await r.smembers(`push:user:${userId}`);
  if (!hashes.length) return [];
  const blobs = await r.mget(hashes.map((h) => `push:sub:${h}`));
  return blobs
    .filter((b): b is string => b !== null)
    .map((b) => JSON.parse(b) as PushSub & { userId: string });
}
