import { describe, expect, it } from "vite-plus/test";

import { hasRideSignature, isOverlong, RIDE_SIGNATURE, type RideMetrics } from "./ride-metrics.ts";

/** A neutral, signature-LESS baseline (round-2 client: reports burst/sustain/
 *  overlong); override the one field under test. */
function metrics(overrides: Partial<RideMetrics> = {}): RideMetrics {
  return {
    startedAt: "2026-07-09T15:00:00.000Z",
    endedAt: "2026-07-09T15:00:45.000Z",
    durationS: 45,
    dropCount: 0,
    airtimeS: 0,
    airtimeBurstS: 0,
    maxG: 1.3,
    maxGSustainS: 0,
    inversions: 0,
    verticalM: 0,
    maxDropM: 0,
    estTopSpeedKmh: null,
    baroAvailable: false,
    gyroAvailable: false,
    confidence: 0.55,
    overlong: false,
    ...overrides,
  };
}

/** A pre-round-2 client: no burst/sustain/overlong fields at all. */
function legacy(overrides: Partial<RideMetrics> = {}): RideMetrics {
  const m = metrics(overrides);
  delete m.airtimeBurstS;
  delete m.maxGSustainS;
  delete m.overlong;
  return m;
}

/**
 * Parity table — mirrored line for line in
 * packages/ride-recorder/android/src/test/.../RideSignatureTest.kt (and by
 * review in RideDetection.swift). Update the two together.
 */
const PARITY_TABLE: Array<{ name: string; m: Partial<RideMetrics>; expect: boolean }> = [
  {
    name: "real coaster: drops + high sustained g + airtime burst",
    m: {
      dropCount: 2,
      airtimeS: 3.0,
      airtimeBurstS: 1.2,
      maxG: 3.8,
      maxGSustainS: 2.0,
      durationS: 95,
    },
    expect: true,
  },
  {
    name: "launch coaster: no drop/airtime, but 3.5 g held 1.4 s over 60 s",
    m: { airtimeS: 0.2, airtimeBurstS: 0.2, maxG: 3.5, maxGSustainS: 1.4, durationS: 60 },
    expect: true,
  },
  {
    name: "queue walk to the 345 s cap: overlong, whatever else it shows",
    m: {
      airtimeS: 0.6,
      airtimeBurstS: 0.15,
      maxG: 2.4,
      maxGSustainS: 0.3,
      durationS: 345,
      overlong: true,
    },
    expect: false,
  },
  {
    name: "queue walk, two phone-handling dips: cumulative 0.7 s but no burst ≥ 0.5",
    m: { airtimeS: 0.7, airtimeBurstS: 0.3, maxG: 2.4, maxGSustainS: 0.4, durationS: 120 },
    expect: false,
  },
  {
    name: "elevator",
    m: { maxG: 1.15, durationS: 45 },
    expect: false,
  },
  {
    name: "bus: long, bumpy, sub-walking-band g",
    m: { airtimeS: 0.1, airtimeBurstS: 0.1, maxG: 1.6, durationS: 200 },
    expect: false,
  },
  { name: "single drop alone", m: { dropCount: 1 }, expect: true },
  { name: "inversion alone", m: { inversions: 1 }, expect: true },
  {
    name: "airtime burst exactly at threshold",
    m: { airtimeS: 0.5, airtimeBurstS: 0.5 },
    expect: true,
  },
  {
    name: "airtime burst just under threshold",
    m: { airtimeS: 2.0, airtimeBurstS: 0.49 },
    expect: false,
  },
  {
    name: "maxG-only at all three floors (2.3 g, 40 s, 1.0 s sustain)",
    m: { maxG: 2.3, maxGSustainS: 1.0, durationS: 40 },
    expect: true,
  },
  {
    name: "maxG-only with sustain just under 1.0 s",
    m: { maxG: 3.0, maxGSustainS: 0.99, durationS: 60 },
    expect: false,
  },
  {
    name: "overlong flag vetoes even real coaster evidence",
    m: {
      dropCount: 2,
      airtimeBurstS: 1.2,
      maxG: 3.8,
      maxGSustainS: 2.0,
      durationS: 95,
      overlong: true,
    },
    expect: false,
  },
];

describe("hasRideSignature — parity table", () => {
  for (const row of PARITY_TABLE) {
    it(`${row.expect ? "accepts" : "suppresses"}: ${row.name}`, () => {
      expect(hasRideSignature(metrics(row.m))).toBe(row.expect);
    });
  }
});

describe("hasRideSignature — legacy clients (no round-2 fields)", () => {
  it("gates on cumulative airtime when the burst is absent", () => {
    expect(hasRideSignature(legacy({ airtimeS: 0.6 }))).toBe(true);
    expect(hasRideSignature(legacy({ airtimeS: 0.4 }))).toBe(false);
  });

  it("keeps the W5 duration-only maxG rule when sustain is absent", () => {
    expect(hasRideSignature(legacy({ maxG: 3.0, durationS: 60 }))).toBe(true);
    expect(hasRideSignature(legacy({ maxG: 3.0, durationS: 39 }))).toBe(false);
  });

  it("infers overlong from duration when the flag is absent (the 345 s queue capture)", () => {
    expect(isOverlong(legacy({ durationS: 345 }))).toBe(true);
    expect(hasRideSignature(legacy({ maxG: 2.5, durationS: 345 }))).toBe(false);
    expect(isOverlong(legacy({ durationS: RIDE_SIGNATURE.maxSignatureDurationS }))).toBe(false);
  });

  it("honors an explicit overlong=false over the duration inference", () => {
    expect(isOverlong(metrics({ durationS: 300, overlong: false }))).toBe(false);
  });
});

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
    // Round-2 clients are gated on the contiguous burst, not the cumulative.
    const at = RIDE_SIGNATURE.minAirtimeS;
    expect(hasRideSignature(metrics({ airtimeS: at, airtimeBurstS: at }))).toBe(true);
    expect(hasRideSignature(metrics({ airtimeS: at, airtimeBurstS: at - 0.01 }))).toBe(false);
  });

  it("accepts maxG exactly at the threshold, rejects just below with nothing else", () => {
    // Baseline durationS (45) clears maxGMinDurationS and sustain is given, so
    // maxG is the only gate.
    const sustained = { maxGSustainS: RIDE_SIGNATURE.maxGMinSustainS };
    expect(hasRideSignature(metrics({ ...sustained, maxG: RIDE_SIGNATURE.minMaxG }))).toBe(true);
    expect(hasRideSignature(metrics({ ...sustained, maxG: RIDE_SIGNATURE.minMaxG - 0.01 }))).toBe(
      false,
    );
  });

  it("rejects a walking-band maxG spike (W5: 1.8 sat inside 1.5–2.5 g step impacts)", () => {
    expect(hasRideSignature(metrics({ maxG: 2.0 }))).toBe(false);
  });

  it("requires sustained duration for a maxG-only signature", () => {
    const sustained = { maxGSustainS: RIDE_SIGNATURE.maxGMinSustainS };
    // A short high-g burst (phone handling, a stumble) is not a ride…
    expect(
      hasRideSignature(
        metrics({ ...sustained, maxG: 3.0, durationS: RIDE_SIGNATURE.maxGMinDurationS - 1 }),
      ),
    ).toBe(false);
    // …but the same g sustained past the duration floor is.
    expect(
      hasRideSignature(
        metrics({ ...sustained, maxG: 3.0, durationS: RIDE_SIGNATURE.maxGMinDurationS }),
      ),
    ).toBe(true);
    // The duration floor only applies to maxG-only evidence: a short trace with
    // a real drop still passes.
    expect(hasRideSignature(metrics({ dropCount: 1, durationS: 25 }))).toBe(true);
  });
});
