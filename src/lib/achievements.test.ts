import { describe, expect, it } from "vite-plus/test";

import {
  ACHIEVEMENTS,
  MAX_LEVEL,
  TIER_BY_ID,
  formatStatValue,
  levelForXp,
  satisfiedTierIds,
  tierMetal,
  xpForLevel,
  xpForTierIds,
} from "./achievements.ts";

describe("catalog invariants", () => {
  const allTiers = ACHIEVEMENTS.flatMap((f) => f.tiers);

  it("has at least 36 tiers total (it's 206)", () => {
    expect(allTiers.length).toBeGreaterThanOrEqual(36);
    expect(allTiers.length).toBe(206);
  });

  it("has 60 families (44 hand-written + 16 generated headliners)", () => {
    expect(ACHIEVEMENTS.length).toBe(60);
  });

  it("has unique tier ids", () => {
    const ids = new Set(allTiers.map((t) => t.id));
    expect(ids.size).toBe(allTiers.length);
  });

  it("has strictly ascending thresholds per family", () => {
    for (const family of ACHIEVEMENTS) {
      for (let i = 1; i < family.tiers.length; i++) {
        expect(family.tiers[i].threshold).toBeGreaterThan(family.tiers[i - 1].threshold);
      }
    }
  });

  it("round-trips every tier id through TIER_BY_ID", () => {
    for (const family of ACHIEVEMENTS) {
      family.tiers.forEach((tier, tierIndex) => {
        const ref = TIER_BY_ID.get(tier.id);
        expect(ref).toBeDefined();
        expect(ref?.family.key).toBe(family.key);
        expect(ref?.tier.id).toBe(tier.id);
        expect(ref?.tierIndex).toBe(tierIndex);
      });
    }
  });
});

describe("satisfiedTierIds", () => {
  it("returns exactly the walker tiers satisfied by a distance stat", () => {
    expect(satisfiedTierIds({ distance_m: 100_000 })).toEqual(["walker.1", "walker.2", "walker.3"]);
  });

  it("returns nothing for an empty stats object", () => {
    expect(satisfiedTierIds({})).toEqual([]);
  });
});

describe("xpForTierIds", () => {
  it("sums xp for known ids", () => {
    expect(xpForTierIds(["walker.1", "walker.2"])).toBe(150);
  });

  it("ignores unknown ids", () => {
    expect(xpForTierIds(["walker.1", "not-a-real-id"])).toBe(50);
  });
});

describe("levelForXp", () => {
  it("is level 1 at 0 xp", () => {
    const info = levelForXp(0);
    expect(info.level).toBe(1);
    expect(info.title).toBe("Turnstile Tourist");
    expect(info.intoLevel).toBe(0);
  });

  it("is monotonically non-decreasing in xp", () => {
    let prevLevel = 1;
    for (let xp = 0; xp <= xpForLevel(MAX_LEVEL) + 1000; xp += 137) {
      const level = levelForXp(xp).level;
      expect(level).toBeGreaterThanOrEqual(prevLevel);
      prevLevel = level;
    }
  });

  it("caps at MAX_LEVEL with no forNext", () => {
    const info = levelForXp(xpForLevel(MAX_LEVEL) + 1_000_000);
    expect(info.level).toBe(MAX_LEVEL);
    expect(info.forNext).toBe(null);
  });
});

describe("tierMetal", () => {
  it("is null with nothing unlocked", () => {
    expect(tierMetal(0, 5)).toBe(null);
    expect(tierMetal(3, 0)).toBe(null);
  });

  it("matches the mockup bands on a 5-tier family", () => {
    expect(tierMetal(1, 5)).toBe("bronze");
    expect(tierMetal(2, 5)).toBe("bronze");
    expect(tierMetal(3, 5)).toBe("silver");
    expect(tierMetal(4, 5)).toBe("gold");
    expect(tierMetal(5, 5)).toBe("platinum");
  });

  it("maxing any family is platinum", () => {
    expect(tierMetal(2, 2)).toBe("platinum");
    expect(tierMetal(3, 3)).toBe("platinum");
  });
});

describe("formatStatValue", () => {
  it("formats counts", () => {
    expect(formatStatValue("count", 17)).toBe("17");
  });

  it("formats meters under 1km in meters", () => {
    expect(formatStatValue("meters", 850)).toBe("850 m");
  });

  it("formats meters at/over 1km in km", () => {
    expect(formatStatValue("meters", 12_400)).toBe("12.4 km");
  });

  it("formats seconds as h/m", () => {
    expect(formatStatValue("seconds", 4 * 3600 + 20 * 60)).toBe("4h 20m");
  });

  it("formats sub-hour seconds as minutes only", () => {
    expect(formatStatValue("seconds", 25 * 60)).toBe("25m");
  });
});
