import { describe, expect, it } from "vite-plus/test";

import { hasRideSignature, RIDE_SIGNATURE, type RideMetrics } from "./ride-metrics.ts";

/** A neutral, signature-LESS baseline; override the one field under test. */
function metrics(overrides: Partial<RideMetrics> = {}): RideMetrics {
  return {
    startedAt: "2026-07-09T15:00:00.000Z",
    endedAt: "2026-07-09T15:00:45.000Z",
    durationS: 45,
    dropCount: 0,
    airtimeS: 0,
    maxG: 1.3,
    inversions: 0,
    verticalM: 0,
    maxDropM: 0,
    estTopSpeedKmh: null,
    baroAvailable: false,
    gyroAvailable: false,
    confidence: 0.55,
    ...overrides,
  };
}

describe("hasRideSignature", () => {
  it("suppresses a walking fixture (no drop / airtime / g / inversion)", () => {
    // 45 s of pocketed walking clears the device variance trigger but carries no
    // coaster evidence — must not read as a ride.
    expect(hasRideSignature(metrics())).toBe(false);
  });

  it("accepts a legit coaster (drops + high g)", () => {
    expect(hasRideSignature(metrics({ dropCount: 2, maxG: 3.8 }))).toBe(true);
  });

  it("accepts on a single drop alone", () => {
    expect(hasRideSignature(metrics({ dropCount: RIDE_SIGNATURE.minDropCount }))).toBe(true);
  });

  it("accepts on an inversion alone", () => {
    expect(hasRideSignature(metrics({ inversions: RIDE_SIGNATURE.minInversions }))).toBe(true);
  });

  it("accepts at the airtime threshold, rejects just below", () => {
    expect(hasRideSignature(metrics({ airtimeS: RIDE_SIGNATURE.minAirtimeS }))).toBe(true);
    expect(hasRideSignature(metrics({ airtimeS: RIDE_SIGNATURE.minAirtimeS - 0.01 }))).toBe(false);
  });

  it("accepts maxG exactly at the threshold, rejects just below with nothing else", () => {
    // Baseline durationS (45) clears maxGMinDurationS, so maxG is the only gate.
    expect(hasRideSignature(metrics({ maxG: RIDE_SIGNATURE.minMaxG }))).toBe(true);
    expect(hasRideSignature(metrics({ maxG: RIDE_SIGNATURE.minMaxG - 0.01 }))).toBe(false);
  });

  it("rejects a walking-band maxG spike (W5: 1.8 sat inside 1.5–2.5 g step impacts)", () => {
    expect(hasRideSignature(metrics({ maxG: 2.0 }))).toBe(false);
  });

  it("requires sustained duration for a maxG-only signature", () => {
    // A short high-g burst (phone handling, a stumble) is not a ride…
    expect(
      hasRideSignature(metrics({ maxG: 3.0, durationS: RIDE_SIGNATURE.maxGMinDurationS - 1 })),
    ).toBe(false);
    // …but the same g sustained past the duration floor is.
    expect(
      hasRideSignature(metrics({ maxG: 3.0, durationS: RIDE_SIGNATURE.maxGMinDurationS })),
    ).toBe(true);
    // The duration floor only applies to maxG-only evidence: a short trace with
    // a real drop still passes.
    expect(hasRideSignature(metrics({ dropCount: 1, durationS: 25 }))).toBe(true);
  });
});
