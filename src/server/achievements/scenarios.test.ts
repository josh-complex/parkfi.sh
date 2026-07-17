import { describe, expect, it } from "vite-plus/test";

import { buildScenario, tzOffsetMs, zonedWallToUtc, type SimPark } from "./scenarios.ts";

const NY = "America/New_York";

function park(overrides: Partial<SimPark> = {}): SimPark {
  return {
    id: 1,
    slug: "magic-kingdom",
    name: "Magic Kingdom",
    timezone: NY,
    entrance: [-81.5812, 28.4177],
    attractions: [
      { id: 10, name: "Space Mountain", lng: -81.5789, lat: 28.4189 },
      { id: 11, name: "Big Thunder", lng: -81.5842, lat: 28.4201 },
      { id: 12, name: "Pirates", lng: -81.5852, lat: 28.4179 },
    ],
    ...overrides,
  };
}

/** Read the park-local hour a UTC instant maps to. */
function localHour(d: Date, tz: string): number {
  return Number(
    new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "2-digit", hourCycle: "h23" }).format(d),
  );
}

describe("zonedWallToUtc / tzOffsetMs", () => {
  it("maps a wall clock to the instant that reads back as that wall clock", () => {
    const d = zonedWallToUtc(2026, 7, 15, 9, 30, NY); // 09:30 EDT
    expect(localHour(d, NY)).toBe(9);
    // EDT is UTC-4 in July, so 09:30 local = 13:30 UTC.
    expect(d.getUTCHours()).toBe(13);
    expect(d.getUTCMinutes()).toBe(30);
  });

  it("handles winter standard time (offset shifts to UTC-5)", () => {
    const d = zonedWallToUtc(2026, 1, 15, 9, 30, NY); // 09:30 EST
    expect(localHour(d, NY)).toBe(9);
    expect(d.getUTCHours()).toBe(14);
  });

  it("tzOffsetMs is negative west of UTC", () => {
    expect(tzOffsetMs(new Date("2026-07-15T12:00:00Z"), NY)).toBe(-4 * 60 * 60 * 1000);
  });
});

describe("buildScenario", () => {
  it("throws when the park has no anchorable attractions", () => {
    expect(() => buildScenario("fullParkDay", { park: park({ attractions: [] }) })).toThrow(
      /no geocoded attractions/,
    );
  });

  it("fullParkDay produces a chronological script with a rope-drop and night-owl ping", () => {
    const ref = new Date("2026-07-15T18:00:00Z"); // afternoon in NY
    const script = buildScenario("fullParkDay", { park: park(), reference: ref });
    expect(script.length).toBeGreaterThan(30);
    // Chronological.
    for (let i = 1; i < script.length; i++) {
      expect(script[i].at.getTime()).toBeGreaterThanOrEqual(script[i - 1].at.getTime());
    }
    const hours = script.map((p) => localHour(p.at, NY));
    expect(Math.min(...hours)).toBeLessThan(10); // rope drop window
    expect(Math.max(...hours)).toBeGreaterThanOrEqual(22); // night owl
  });

  it("streak(n) spans n distinct local days", () => {
    const script = buildScenario("streak", { park: park(), days: 5 });
    const days = new Set(
      script.map((p) =>
        new Intl.DateTimeFormat("en-CA", {
          timeZone: NY,
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
        }).format(p.at),
      ),
    );
    // 5 dwell days (+ possibly one extra from the trailing exit ping past midnight).
    expect(days.size).toBeGreaterThanOrEqual(5);
  });

  it("parkHopDay requires a second park", () => {
    expect(() => buildScenario("parkHopDay", { park: park() })).toThrow(/second park/);
  });

  it("crossMidnightDwell straddles a local-day boundary", () => {
    const script = buildScenario("crossMidnightDwell", { park: park() });
    const days = new Set(
      script.map((p) =>
        new Intl.DateTimeFormat("en-CA", {
          timeZone: NY,
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
        }).format(p.at),
      ),
    );
    expect(days.size).toBeGreaterThanOrEqual(2);
  });

  it("always ends outside the park to settle any open anchor", () => {
    const script = buildScenario("fullParkDay", { park: park() });
    const last = script.at(-1)!;
    // The exit ping is ~0.02° off the last dwell attraction — far outside.
    const anyAttraction = park().attractions.some(
      (a) => Math.abs(a.lat - last.lat) < 0.01 && Math.abs(a.lng - last.lng) < 0.01,
    );
    expect(anyAttraction).toBe(false);
  });
});
