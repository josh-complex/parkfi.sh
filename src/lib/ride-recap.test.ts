import { describe, expect, it } from "vite-plus/test";

import { formatRideRecap, rideRecapSegments } from "#/lib/ride-recap.ts";

import type { RideMetrics } from "#/lib/ride-metrics.ts";

function metrics(over: Partial<RideMetrics> = {}): RideMetrics {
  return {
    startedAt: "2026-07-13T12:00:00.000Z",
    endedAt: "2026-07-13T12:01:30.000Z",
    durationS: 90,
    dropCount: 2,
    airtimeS: 8,
    maxG: 4.12,
    inversions: 0,
    verticalM: 60,
    maxDropM: 35,
    estTopSpeedKmh: 96,
    baroAvailable: true,
    gyroAvailable: true,
    confidence: 0.8,
    ...over,
  };
}

describe("rideRecapSegments", () => {
  it("orders drops, inversions, g, airtime, speed", () => {
    expect(rideRecapSegments(metrics({ inversions: 3 }))).toEqual([
      "2 drops",
      "3 inversions",
      "4.1 g",
      "8 s airtime",
      "speed est. 96 km/h",
    ]);
  });

  it("omits zero-valued metrics", () => {
    expect(
      rideRecapSegments(
        metrics({ dropCount: 0, inversions: 0, airtimeS: 0, estTopSpeedKmh: null }),
      ),
    ).toEqual(["4.1 g"]);
  });

  it("omits sub-1g max (nothing notable)", () => {
    expect(rideRecapSegments(metrics({ maxG: 0.9 }))).not.toContain("0.9 g");
  });

  it("omits speed when the barometer was absent (null)", () => {
    expect(rideRecapSegments(metrics({ estTopSpeedKmh: null }))).not.toContain(
      "speed est. 96 km/h",
    );
  });

  it("uses singular units for a count of 1", () => {
    const parts = rideRecapSegments(metrics({ dropCount: 1, inversions: 1 }));
    expect(parts).toContain("1 drop");
    expect(parts).toContain("1 inversion");
  });

  it("rounds g to one decimal and speed to a whole number", () => {
    const parts = rideRecapSegments(metrics({ maxG: 4.049, estTopSpeedKmh: 96.7 }));
    expect(parts).toContain("4.0 g");
    expect(parts).toContain("speed est. 97 km/h");
  });
});

describe("formatRideRecap", () => {
  it("joins segments with a middot", () => {
    expect(formatRideRecap(metrics())).toBe("2 drops · 4.1 g · 8 s airtime · speed est. 96 km/h");
  });

  it("falls back to a neutral line when nothing stood out", () => {
    expect(
      formatRideRecap(
        metrics({ dropCount: 0, inversions: 0, maxG: 0.5, airtimeS: 0, estTopSpeedKmh: null }),
      ),
    ).toBe("Ride logged.");
  });
});
