/**
 * Native presence beacon — the pure/DB half behind `/api/native/ping`
 * (park-tracking fixes 2, Workstream B, server side).
 *
 * The foreground ping loop is exactly that — foreground. A pocketed phone
 * sends nothing, so presence, distance and the dwell anchor stopped accruing
 * the moment the screen locked (R2: DHS credited 17 min of a 2h45m visit). The
 * native shell's monitoring service will batch fused-location fixes while
 * armed and POST them to the route; each fix runs through the same
 * `ingestPing` the foreground loop uses, with the fix's own capture time as
 * the pipeline clock. Kept out of the route file so the schema, time window,
 * rate limit and batch loop are unit-testable without the router.
 *
 * The Android beacon that posts here lands after the round-2 field test (see
 * the plan's build order); until then the route simply has no caller.
 */
import { z } from "zod";

import { ingestPing, type IngestResult } from "./engine.ts";

// A batch may replay fixes from a long pocketed stretch, but never from another
// day: clamp `at` to a bounded past window (and a little future for clock skew).
export const BEACON_MAX_PAST_MS = 6 * 60 * 60 * 1000;
export const BEACON_MAX_FUTURE_MS = 5 * 60 * 1000;
// One batch per user per this long. The device batches at 3 min / 10 fixes, so
// 20 s is generous for a real client and stops a misbehaving one from turning
// the pipeline into a hot loop. In-memory: the web tier is one Nitro process
// (the same assumption `withUserLock` makes).
export const BEACON_RATE_LIMIT_MS = 20_000;
const RATE_LIMIT_PRUNE_MS = 60 * 60 * 1000;

const pingSchema = z.object({
  lng: z.number().gte(-180).lte(180),
  lat: z.number().gte(-90).lte(90),
  accuracy: z.number().nonnegative().max(100_000),
  /** Fix capture time, epoch ms. */
  at: z.number().int().positive(),
  // Same raw pedometer report the foreground ping carries (see the tRPC `ping`
  // input) — the beacon is what finally moves `user_geo_state.steps_cum` off
  // NULL on a pocketed day.
  stepsCum: z.number().int().min(0).max(500_000).optional(),
  stepsSessionMs: z.number().int().positive().optional(),
});

export const beaconBodySchema = z.object({
  /** Oldest first (sorted defensively server-side anyway). */
  pings: z.array(pingSchema).min(1).max(50),
});

export type BeaconBody = z.infer<typeof beaconBodySchema>;

/** Whether a fix time is inside the accepted replay window. Pure. */
export function isBeaconTimeAcceptable(atMs: number, nowMs: number): boolean {
  return atMs >= nowMs - BEACON_MAX_PAST_MS && atMs <= nowMs + BEACON_MAX_FUTURE_MS;
}

// userId → last accepted batch time.
const lastBatchAt = new Map<string, number>();
let lastPruneAt = 0;

/** Token-bucket-of-one: at most one batch per user per BEACON_RATE_LIMIT_MS.
 *  Returns ms to wait, or 0 (and records the batch). Pure over the clock. */
export function rateLimitWaitMs(userId: string, nowMs: number): number {
  if (nowMs - lastPruneAt > RATE_LIMIT_PRUNE_MS) {
    lastPruneAt = nowMs;
    for (const [k, t] of lastBatchAt) if (nowMs - t > RATE_LIMIT_PRUNE_MS) lastBatchAt.delete(k);
  }
  const last = lastBatchAt.get(userId);
  if (last != null && nowMs - last < BEACON_RATE_LIMIT_MS) {
    return BEACON_RATE_LIMIT_MS - (nowMs - last);
  }
  lastBatchAt.set(userId, nowMs);
  return 0;
}

/** Test hook: forget every rate-limit entry. */
export function resetBeaconRateLimit(): void {
  lastBatchAt.clear();
  lastPruneAt = 0;
}

export interface BeaconResult {
  accepted: number;
  skipped: number;
  inPark: boolean | null;
  parkId: number | null;
}

/**
 * Run a validated batch through the ping pipeline in time order. Out-of-window
 * entries are skipped and counted. The result summarizes the LAST accepted
 * entry's park state so the device can mirror the JS tracker's in-park edge.
 * `ingest` is injectable so the loop is testable without a database.
 */
export async function ingestBeaconBatch(
  userId: string,
  body: BeaconBody,
  nowMs = Date.now(),
  ingest: typeof ingestPing = ingestPing,
): Promise<BeaconResult> {
  const ordered = [...body.pings].sort((a, b) => a.at - b.at);
  let accepted = 0;
  let skipped = 0;
  let last: IngestResult | null = null;
  for (const p of ordered) {
    if (!isBeaconTimeAcceptable(p.at, nowMs)) {
      skipped++;
      continue;
    }
    last = await ingest(userId, p.lng, p.lat, p.accuracy, new Date(p.at), {
      steps:
        p.stepsCum != null && p.stepsSessionMs != null
          ? { cum: p.stepsCum, sessionMs: p.stepsSessionMs }
          : null,
    });
    accepted++;
  }
  return { accepted, skipped, inPark: last?.inPark ?? null, parkId: last?.parkId ?? null };
}
