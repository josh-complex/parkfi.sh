import { describe, expect, it } from "vite-plus/test";

import {
  coasterClampReason,
  creditDecision,
  isPingFresh,
  isWithinDedupeWindow,
  resolveRideAttractionId,
  rideTraceSchema,
} from "./rides.ts";

/** A plausible metrics fixture; override per-case. */
function metrics(overrides: Record<string, unknown> = {}) {
  const startedAt = "2026-07-09T15:00:00.000Z";
  const endedAt = "2026-07-09T15:01:30.000Z"; // 90s wall — matches durationS below
  return {
    startedAt,
    endedAt,
    durationS: 90,
    dropCount: 3,
    airtimeS: 8,
    maxG: 4.1,
    inversions: 2,
    verticalM: 120,
    maxDropM: 35,
    estTopSpeedKmh: 96,
    baroAvailable: true,
    gyroAvailable: true,
    confidence: 0.8,
    ...overrides,
  };
}

describe("rideTraceSchema — plausibility bounds", () => {
  it("accepts a plausible trace", () => {
    expect(rideTraceSchema.safeParse({ metrics: metrics() }).success).toBe(true);
  });

  it("rejects maxG above the human limit", () => {
    expect(rideTraceSchema.safeParse({ metrics: metrics({ maxG: 9 }) }).success).toBe(false);
  });

  it("rejects a duration over the 6-minute cap", () => {
    expect(rideTraceSchema.safeParse({ metrics: metrics({ durationS: 400 }) }).success).toBe(false);
  });

  it("rejects a zero/negative duration", () => {
    expect(rideTraceSchema.safeParse({ metrics: metrics({ durationS: 0 }) }).success).toBe(false);
  });

  it("rejects airtime exceeding duration", () => {
    expect(
      rideTraceSchema.safeParse({ metrics: metrics({ airtimeS: 120, durationS: 90 }) }).success,
    ).toBe(false);
  });

  it("rejects too many drops / inversions", () => {
    expect(rideTraceSchema.safeParse({ metrics: metrics({ dropCount: 21 }) }).success).toBe(false);
    expect(rideTraceSchema.safeParse({ metrics: metrics({ inversions: 16 }) }).success).toBe(false);
  });

  it("rejects verticalM over the bound", () => {
    expect(rideTraceSchema.safeParse({ metrics: metrics({ verticalM: 601 }) }).success).toBe(false);
  });

  it("rejects an unparseable timestamp", () => {
    expect(rideTraceSchema.safeParse({ metrics: metrics({ startedAt: "nope" }) }).success).toBe(
      false,
    );
  });

  it("rejects wall-clock disagreeing with durationS by >10%", () => {
    // 90s wall but claims 120s duration.
    expect(rideTraceSchema.safeParse({ metrics: metrics({ durationS: 120 }) }).success).toBe(false);
  });

  it("accepts a null estTopSpeedKmh (no barometer)", () => {
    expect(
      rideTraceSchema.safeParse({
        metrics: metrics({ estTopSpeedKmh: null, baroAvailable: false }),
      }).success,
    ).toBe(true);
  });

  it("accepts a MISSING estTopSpeedKmh key and normalizes it to null", () => {
    // The native bridge drops null-valued keys (Android JSONObject.put(k, null)
    // removes k), so no-baro devices send the key absent — must not reject.
    const m = metrics({ baroAvailable: false });
    delete (m as Record<string, unknown>).estTopSpeedKmh;
    const parsed = rideTraceSchema.safeParse({ metrics: m });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.metrics.estTopSpeedKmh).toBeNull();
  });

  it("accepts samples with a MISSING altRel key and normalizes to null", () => {
    const samples = [
      { t: 0, aMag: 9.8 },
      { t: 250, aMag: 11.2 },
    ];
    const parsed = rideTraceSchema.safeParse({ metrics: metrics(), samples });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.samples?.[0]?.altRel).toBeNull();
  });

  it("rejects more than 600 trace samples", () => {
    const samples = Array.from({ length: 601 }, (_, i) => ({ t: i, aMag: 9.8, altRel: null }));
    expect(rideTraceSchema.safeParse({ metrics: metrics(), samples }).success).toBe(false);
  });
});

describe("isPingFresh", () => {
  const now = new Date("2026-07-09T15:05:00.000Z");
  it("accepts a ping within 15 minutes", () => {
    expect(isPingFresh(new Date("2026-07-09T14:55:00.000Z"), now)).toBe(true);
  });
  it("rejects a ping older than 15 minutes", () => {
    expect(isPingFresh(new Date("2026-07-09T14:49:00.000Z"), now)).toBe(false);
  });
  it("rejects a missing ping", () => {
    expect(isPingFresh(null, now)).toBe(false);
  });
  it("rejects a future ping (clock skew)", () => {
    expect(isPingFresh(new Date("2026-07-09T15:10:00.000Z"), now)).toBe(false);
  });
});

describe("resolveRideAttractionId", () => {
  it("prefers the live anchor unconditionally", () => {
    expect(resolveRideAttractionId(42, [{ id: 7, distM: 5 }])).toBe(42);
  });
  it("falls back to the nearest candidate within range", () => {
    expect(
      resolveRideAttractionId(null, [
        { id: 7, distM: 110 },
        { id: 8, distM: 40 },
      ]),
    ).toBe(8);
  });
  it("returns null when no candidate is within range", () => {
    expect(resolveRideAttractionId(null, [{ id: 7, distM: 200 }])).toBeNull();
  });
  it("returns null with no anchor and no candidates", () => {
    expect(resolveRideAttractionId(null, [])).toBeNull();
  });
});

describe("coasterClampReason", () => {
  it("passes when there are no published stats", () => {
    expect(coasterClampReason({ inversions: 5, maxDropM: 40 }, null)).toBeNull();
  });
  it("rejects inversions beyond published + 2", () => {
    expect(
      coasterClampReason(
        { inversions: 5, maxDropM: 20 },
        { inversions: 2, dropHeightM: 50, maxHeightM: 60 },
      ),
    ).not.toBeNull();
  });
  it("allows inversions within the +2 tolerance", () => {
    expect(
      coasterClampReason(
        { inversions: 4, maxDropM: 20 },
        { inversions: 2, dropHeightM: 50, maxHeightM: 60 },
      ),
    ).toBeNull();
  });
  it("rejects maxDropM beyond 1.5× the published single-descent figure", () => {
    // 40 m drop vs a 20 m max-height coaster → spoof-shaped.
    expect(
      coasterClampReason(
        { inversions: 0, maxDropM: 40 },
        { inversions: 0, dropHeightM: null, maxHeightM: 20 },
      ),
    ).not.toBeNull();
  });
  it("no longer rejects a legitimately large cumulative ride (maxDropM within bound)", () => {
    // Same coaster whose Σ|Δalt| would blow past the old 3× drop check, but
    // whose single largest drop is within 1.5× the published figure.
    expect(
      coasterClampReason(
        { inversions: 0, maxDropM: 55 },
        { inversions: 0, dropHeightM: 40, maxHeightM: 60 },
      ),
    ).toBeNull();
  });
  it("falls back to dropHeightM when maxHeightM is null", () => {
    expect(
      coasterClampReason(
        { inversions: 0, maxDropM: 80 },
        { inversions: 0, dropHeightM: 50, maxHeightM: null },
      ),
    ).not.toBeNull(); // 80 > 50 × 1.5
  });
  it("skips a check whose published figure is null", () => {
    expect(
      coasterClampReason(
        { inversions: 9, maxDropM: 500 },
        { inversions: null, dropHeightM: null, maxHeightM: null },
      ),
    ).toBeNull();
  });
});

describe("isWithinDedupeWindow", () => {
  const t = new Date("2026-07-09T15:00:00.000Z");
  it("treats events within 5 minutes as the same ride", () => {
    expect(isWithinDedupeWindow(t, new Date("2026-07-09T15:04:00.000Z"))).toBe(true);
  });
  it("treats events more than 5 minutes apart as distinct", () => {
    expect(isWithinDedupeWindow(t, new Date("2026-07-09T15:06:00.000Z"))).toBe(false);
  });
});

describe("creditDecision — double-count guard", () => {
  it("does NOT credit ride count when anchored to the same attraction (dwell will)", () => {
    expect(creditDecision(42, 42)).toEqual({ creditRideCount: false, source: "sensor+dwell" });
  });
  it("credits when anchored to a different attraction", () => {
    expect(creditDecision(7, 42)).toEqual({ creditRideCount: true, source: "sensor" });
  });
  it("credits when there is no live anchor", () => {
    expect(creditDecision(null, 42)).toEqual({ creditRideCount: true, source: "sensor" });
  });
});
