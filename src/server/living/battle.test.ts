import { describe, expect, it } from "vite-plus/test";

import { FadedType } from "./codes.ts";
import { fadedSpec } from "./battle.ts";

describe("fadedSpec", () => {
  it("returns the named spec for a known faded type", () => {
    const s = fadedSpec(FadedType.BREAKER, 1);
    expect(s.name).toBe("Breaker");
    expect(s.hp).toBeGreaterThan(0);
    expect(s.atk).toBeGreaterThan(0);
  });

  it("scales hp and atk up with rarity", () => {
    const r1 = fadedSpec(FadedType.BREAKER, 1);
    const r3 = fadedSpec(FadedType.BREAKER, 3);
    expect(r3.hp).toBeGreaterThan(r1.hp);
    expect(r3.atk).toBeGreaterThan(r1.atk);
  });

  it("clamps rarity below 1 to the base spec", () => {
    const r0 = fadedSpec(FadedType.SHADE, 0);
    const r1 = fadedSpec(FadedType.SHADE, 1);
    expect(r0.hp).toBe(r1.hp);
  });

  it("is deterministic", () => {
    expect(fadedSpec(FadedType.WISP, 2)).toEqual(fadedSpec(FadedType.WISP, 2));
  });
});
