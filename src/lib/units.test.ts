import { describe, expect, it } from "vite-plus/test";

import { formatDistance, valhallaUnits } from "./units.ts";

describe("formatDistance", () => {
  it("shows metres then kilometres for metric", () => {
    expect(formatDistance(40, "metric")).toBe("40 m");
    expect(formatDistance(999, "metric")).toBe("999 m");
    expect(formatDistance(1500, "metric")).toBe("1.5 km");
  });

  it("shows feet (rounded to 10) then miles for imperial", () => {
    expect(formatDistance(40, "imperial")).toBe("130 ft"); // 131.2 ft → 130
    expect(formatDistance(120, "imperial")).toBe("390 ft"); // 393.7 ft → 390
    expect(formatDistance(500, "imperial")).toBe("0.3 mi"); // 1640 ft → miles
  });

  it("tips into the larger unit when rounding reaches the boundary", () => {
    expect(formatDistance(304, "imperial")).toBe("0.2 mi"); // 997.4 ft rounds to 1000
    expect(formatDistance(999.5, "metric")).toBe("1.0 km"); // rounds to 1000 m
  });

  it("never emits a negative distance", () => {
    expect(formatDistance(0, "imperial")).toBe("0 ft");
    expect(formatDistance(0, "metric")).toBe("0 m");
  });
});

describe("valhallaUnits", () => {
  it("maps the unit system to Valhalla's narrative units", () => {
    expect(valhallaUnits("imperial")).toBe("miles");
    expect(valhallaUnits("metric")).toBe("kilometers");
  });
});
