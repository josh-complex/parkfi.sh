import { describe, expect, it } from "vite-plus/test";

import { HeartlessType } from "./codes.ts";
import { heartlessSpec } from "./battle.ts";

describe("heartlessSpec", () => {
  it("returns the named spec for a known faded type", () => {
    const s = heartlessSpec(HeartlessType.BREAKER, 1);
    expect(s.name).toBe("Breaker");
    expect(s.hp).toBeGreaterThan(0);
    expect(s.atk).toBeGreaterThan(0);
  });

  it("scales hp and atk up with rarity", () => {
    const r1 = heartlessSpec(HeartlessType.BREAKER, 1);
    const r3 = heartlessSpec(HeartlessType.BREAKER, 3);
    expect(r3.hp).toBeGreaterThan(r1.hp);
    expect(r3.atk).toBeGreaterThan(r1.atk);
  });

  it("clamps rarity below 1 to the base spec", () => {
    const r0 = heartlessSpec(HeartlessType.SHADE, 0);
    const r1 = heartlessSpec(HeartlessType.SHADE, 1);
    expect(r0.hp).toBe(r1.hp);
  });

  it("is deterministic", () => {
    expect(heartlessSpec(HeartlessType.WISP, 2)).toEqual(heartlessSpec(HeartlessType.WISP, 2));
  });
});
