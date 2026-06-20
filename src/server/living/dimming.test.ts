import { describe, expect, it } from "vite-plus/test";

import { AttractionStatus } from "#/server/parks/codes.ts";

import { FadedType } from "./codes.ts";
import { spawnDecision } from "./dimming.ts";

// spawnDecision is the pure heart of the Dimming engine — the rule that turns a
// real live-park state into a spawn. Tested in isolation (no DB/device).
describe("spawnDecision", () => {
  it("spawns nothing for an operating ride", () => {
    expect(spawnDecision({ status: AttractionStatus.OPERATING, standbyMin: 30 })).toBe(null);
  });

  it("spawns a Breaker when a ride goes DOWN", () => {
    const d = spawnDecision({ status: AttractionStatus.DOWN, standbyMin: 20 });
    expect(d).not.toBe(null);
    expect(d?.fadedType).toBe(FadedType.BREAKER);
  });

  it("spawns a rarer Breaker when a long-standby headliner goes DOWN", () => {
    const minor = spawnDecision({ status: AttractionStatus.DOWN, standbyMin: 20 });
    const major = spawnDecision({ status: AttractionStatus.DOWN, standbyMin: 90 });
    expect(major?.rarity).toBeGreaterThan(minor?.rarity ?? 0);
  });

  it("handles a missing standby gracefully", () => {
    const d = spawnDecision({ status: AttractionStatus.DOWN, standbyMin: null });
    expect(d?.fadedType).toBe(FadedType.BREAKER);
  });
});
