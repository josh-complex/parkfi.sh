import { beforeEach, describe, expect, it } from "vite-plus/test";

import {
  BEACON_MAX_FUTURE_MS,
  BEACON_MAX_PAST_MS,
  BEACON_RATE_LIMIT_MS,
  beaconBodySchema,
  ingestBeaconBatch,
  isBeaconTimeAcceptable,
  rateLimitWaitMs,
  resetBeaconRateLimit,
} from "./beacon.ts";

const NOW = Date.parse("2026-09-07T20:00:00.000Z");
const ping = { lng: -81.58, lat: 28.417, accuracy: 12, at: NOW - 60_000 };

describe("beacon body schema", () => {
  it("accepts 1–50 pings with optional step reports", () => {
    expect(beaconBodySchema.safeParse({ pings: [ping] }).success).toBe(true);
    expect(
      beaconBodySchema.safeParse({ pings: [{ ...ping, stepsCum: 1200, stepsSessionMs: NOW }] })
        .success,
    ).toBe(true);
    const fifty = Array.from({ length: 50 }, () => ping);
    expect(beaconBodySchema.safeParse({ pings: fifty }).success).toBe(true);
  });

  it("rejects an empty batch and an oversized one", () => {
    expect(beaconBodySchema.safeParse({ pings: [] }).success).toBe(false);
    const fiftyOne = Array.from({ length: 51 }, () => ping);
    expect(beaconBodySchema.safeParse({ pings: fiftyOne }).success).toBe(false);
  });

  it("rejects a ping without a capture time", () => {
    const { at: _at, ...noAt } = ping;
    expect(beaconBodySchema.safeParse({ pings: [noAt] }).success).toBe(false);
  });
});

describe("isBeaconTimeAcceptable", () => {
  it("accepts fixes up to 6 h old and 5 min ahead", () => {
    expect(isBeaconTimeAcceptable(NOW - BEACON_MAX_PAST_MS, NOW)).toBe(true);
    expect(isBeaconTimeAcceptable(NOW + BEACON_MAX_FUTURE_MS, NOW)).toBe(true);
  });

  it("skips anything older or further ahead", () => {
    expect(isBeaconTimeAcceptable(NOW - BEACON_MAX_PAST_MS - 1, NOW)).toBe(false);
    expect(isBeaconTimeAcceptable(NOW + BEACON_MAX_FUTURE_MS + 1, NOW)).toBe(false);
  });
});

describe("rateLimitWaitMs", () => {
  beforeEach(() => resetBeaconRateLimit());

  it("admits the first batch and blocks a second within the window", () => {
    expect(rateLimitWaitMs("u1", NOW)).toBe(0);
    expect(rateLimitWaitMs("u1", NOW + 5_000)).toBe(BEACON_RATE_LIMIT_MS - 5_000);
    expect(rateLimitWaitMs("u1", NOW + BEACON_RATE_LIMIT_MS)).toBe(0);
  });

  it("is per user", () => {
    expect(rateLimitWaitMs("u1", NOW)).toBe(0);
    expect(rateLimitWaitMs("u2", NOW)).toBe(0);
  });
});

describe("ingestBeaconBatch", () => {
  it("ingests in time order, skips out-of-window fixes, reports the last state", async () => {
    const calls: Array<{ at: number; steps: unknown }> = [];
    const fakeIngest = async (
      _userId: string,
      _lng: number,
      _lat: number,
      _acc: number,
      now: Date = new Date(),
      opts?: { steps?: { cum: number; sessionMs: number } | null },
    ) => {
      calls.push({ at: now.getTime(), steps: opts?.steps ?? null });
      return { inPark: true as boolean | null, parkId: 7, newlyUnlocked: [] };
    };
    const body = {
      pings: [
        { ...ping, at: NOW - 30_000, stepsCum: 40, stepsSessionMs: NOW - 3_600_000 },
        { ...ping, at: NOW - 90_000 }, // out of order — must run first
        { ...ping, at: NOW - 7 * 60 * 60 * 1000 }, // too old — skipped
        { ...ping, at: NOW + 10 * 60 * 1000 }, // too far ahead — skipped
      ],
    };
    const r = await ingestBeaconBatch("u1", body, NOW, fakeIngest);
    expect(r).toEqual({ accepted: 2, skipped: 2, inPark: true, parkId: 7 });
    expect(calls.map((c) => c.at)).toEqual([NOW - 90_000, NOW - 30_000]);
    expect(calls[0].steps).toBeNull();
    expect(calls[1].steps).toEqual({ cum: 40, sessionMs: NOW - 3_600_000 });
  });

  it("reports null park state when nothing was accepted", async () => {
    const r = await ingestBeaconBatch(
      "u1",
      { pings: [{ ...ping, at: NOW - BEACON_MAX_PAST_MS - 1 }] },
      NOW,
      async () => ({ inPark: true, newlyUnlocked: [] }),
    );
    expect(r).toEqual({ accepted: 0, skipped: 1, inPark: null, parkId: null });
  });
});
