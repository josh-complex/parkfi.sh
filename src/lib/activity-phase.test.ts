import { describe, expect, it } from "vite-plus/test";

import { dayPhase, phaseEyebrow, resolveDayPhase } from "./activity-phase.ts";

describe("dayPhase", () => {
  it("maps hours to the four phases", () => {
    expect(dayPhase(6)).toBe("dawn");
    expect(dayPhase(12)).toBe("day");
    expect(dayPhase(18)).toBe("dusk");
    expect(dayPhase(23)).toBe("night");
    expect(dayPhase(2)).toBe("night");
  });

  it("uses half-open boundaries (dawn 5–8, day 8–17, dusk 17–20)", () => {
    expect(dayPhase(5)).toBe("dawn");
    expect(dayPhase(8)).toBe("day");
    expect(dayPhase(17)).toBe("dusk");
    expect(dayPhase(20)).toBe("night");
    expect(dayPhase(4)).toBe("night");
  });
});

describe("phaseEyebrow", () => {
  it("plain daytime header, today vs past", () => {
    expect(phaseEyebrow("day", true)).toBe("Today's park day");
    expect(phaseEyebrow("day", false)).toBe("Park day");
  });

  it("flavors the off-peak phases the same for today and past", () => {
    expect(phaseEyebrow("night", true)).toBe("Park day · After dark");
    expect(phaseEyebrow("night", false)).toBe("Park day · After dark");
    expect(phaseEyebrow("dusk", true)).toBe("Park day · Golden hour");
    expect(phaseEyebrow("dawn", true)).toBe("Park day · Rope drop");
  });
});

describe("resolveDayPhase", () => {
  const TZ = "America/New_York"; // EDT (UTC-4) in July

  it("today uses the live clock, not last-seen", () => {
    // now = 21:00 EDT on the 19th; last-seen was mid-afternoon.
    const now = new Date("2026-07-20T01:00:00Z");
    const r = resolveDayPhase(
      { day: "2026-07-19", lastSeenAt: "2026-07-19T18:00:00Z", timezone: TZ },
      now,
    );
    expect(r.isToday).toBe(true);
    expect(r.phase).toBe("night");
  });

  it("a past day is skinned by its last-seen hour", () => {
    const now = new Date("2026-07-25T16:00:00Z");
    // last-seen 22:30 EDT on the 18th → night.
    const r = resolveDayPhase(
      { day: "2026-07-18", lastSeenAt: "2026-07-19T02:30:00Z", timezone: TZ },
      now,
    );
    expect(r.isToday).toBe(false);
    expect(r.phase).toBe("night");
  });

  it("a morning-only past visit reads as daytime", () => {
    const now = new Date("2026-07-25T16:00:00Z");
    // last-seen 11:00 EDT → day.
    const r = resolveDayPhase(
      { day: "2026-07-18", lastSeenAt: "2026-07-18T15:00:00Z", timezone: TZ },
      now,
    );
    expect(r.phase).toBe("day");
  });
});
