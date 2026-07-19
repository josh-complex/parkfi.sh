import { describe, expect, it } from "vite-plus/test";

import {
  aggregateDayRows,
  geofenceBounds,
  parkForPoint,
  presenceDelta,
  settleDay,
  type CachedPark,
  type DayStatRow,
} from "./engine.ts";

import type { GeoPolygon } from "#/db/schema.ts";

const MAX_GAP_S = 300;

function dayRow(overrides: Partial<DayStatRow>): DayStatRow {
  return {
    parkId: 1,
    day: "2026-07-06", // a Monday
    distanceM: 0,
    presentSeconds: 0,
    queueSeconds: 0,
    rides: 0,
    ropeDrop: false,
    nightOwl: false,
    rainy: false,
    ...overrides,
  };
}

describe("presenceDelta", () => {
  it("counts the inter-ping delta when in the same park and recent", () => {
    expect(presenceDelta(true, 30, MAX_GAP_S)).toBe(30);
  });

  it("counts the delta at the exact gap boundary (inclusive)", () => {
    expect(presenceDelta(true, MAX_GAP_S, MAX_GAP_S)).toBe(MAX_GAP_S);
  });

  it("contributes nothing when the gap exceeds the cap (app backgrounded)", () => {
    expect(presenceDelta(true, MAX_GAP_S + 1, MAX_GAP_S)).toBe(0);
  });

  it("contributes nothing when the previous ping was in a different park", () => {
    expect(presenceDelta(false, 30, MAX_GAP_S)).toBe(0);
  });

  it("contributes nothing with no prior ping (elapsed null)", () => {
    expect(presenceDelta(true, null, MAX_GAP_S)).toBe(0);
  });

  it("contributes nothing for a zero or negative delta (clock skew / dup ping)", () => {
    expect(presenceDelta(true, 0, MAX_GAP_S)).toBe(0);
    expect(presenceDelta(true, -5, MAX_GAP_S)).toBe(0);
  });
});

describe("settleDay", () => {
  const TZ = "America/New_York"; // EDT (UTC-4) in July

  it("credits the dwell to the anchored ping's local day, not `now`", () => {
    // Anchored ping at 23:55 EDT on 2026-07-06; the settling ping (`now`) lands
    // at 01:00 EDT the next morning. Using `now` would credit 2026-07-07 — a day
    // with no user_park_day row — silently dropping the ride. It must use the
    // anchor's own day.
    const anchorAt = new Date("2026-07-07T03:55:00Z"); // 2026-07-06 23:55 EDT
    const now = new Date("2026-07-07T05:00:00Z"); // 2026-07-07 01:00 EDT
    expect(settleDay(anchorAt, now, TZ)).toBe("2026-07-06");
    expect(settleDay(anchorAt, now, TZ)).not.toBe(localDayOf(now, TZ));
  });

  it("returns that day when anchor and now share a local day", () => {
    const anchorAt = new Date("2026-07-07T18:00:00Z"); // 14:00 EDT
    const now = new Date("2026-07-07T18:30:00Z"); // 14:30 EDT
    expect(settleDay(anchorAt, now, TZ)).toBe("2026-07-07");
  });

  it("falls back to `now` when the cursor lacks a timestamp", () => {
    const now = new Date("2026-07-07T18:00:00Z");
    expect(settleDay(null, now, TZ)).toBe("2026-07-07");
    expect(settleDay(undefined, now, TZ)).toBe("2026-07-07");
  });
});

describe("aggregateDayRows", () => {
  it("is all-zero for no rows", () => {
    const s = aggregateDayRows([]);
    expect(s.park_days).toBe(0);
    expect(s.parks_unique).toBe(0);
    expect(s.streak_best).toBe(0);
    expect(s.weekend_days).toBe(0);
    expect(s.full_days).toBe(0);
    expect(s.park_seconds).toBe(0);
  });

  it("sums totals and takes per-day maxima", () => {
    const s = aggregateDayRows([
      dayRow({
        day: "2026-07-04",
        distanceM: 8_000,
        queueSeconds: 600,
        presentSeconds: 3_600,
        rides: 2,
      }),
      dayRow({
        day: "2026-07-05",
        distanceM: 12_000,
        queueSeconds: 900,
        presentSeconds: 5_400,
        rides: 3,
      }),
    ]);
    expect(s.distance_m).toBe(20_000);
    expect(s.queue_seconds).toBe(1_500);
    expect(s.park_seconds).toBe(9_000);
    expect(s.rides).toBe(5);
    expect(s.best_day_distance_m).toBe(12_000);
    expect(s.best_day_queue_seconds).toBe(900);
    expect(s.park_days).toBe(2);
  });

  it("counts weekend park-days (Sat/Sun) in park-local time", () => {
    const s = aggregateDayRows([
      dayRow({ day: "2026-07-03" }), // Fri
      dayRow({ day: "2026-07-04" }), // Sat
      dayRow({ day: "2026-07-05" }), // Sun
      dayRow({ day: "2026-07-06" }), // Mon
    ]);
    expect(s.weekend_days).toBe(2);
  });

  it("counts full days only when a row is both rope drop AND night owl", () => {
    const s = aggregateDayRows([
      dayRow({ day: "2026-07-04", ropeDrop: true, nightOwl: true }),
      dayRow({ day: "2026-07-05", ropeDrop: true, nightOwl: false }),
      dayRow({ day: "2026-07-06", ropeDrop: false, nightOwl: true }),
    ]);
    expect(s.full_days).toBe(1);
    expect(s.rope_drops).toBe(2);
    expect(s.night_owls).toBe(2);
  });

  it("counts distinct parks and park-hop days", () => {
    const s = aggregateDayRows([
      dayRow({ day: "2026-07-04", parkId: 1 }),
      dayRow({ day: "2026-07-04", parkId: 2 }), // same day, 2 parks → a hop day
      dayRow({ day: "2026-07-05", parkId: 1 }), // single park
    ]);
    expect(s.parks_unique).toBe(2);
    expect(s.park_hop_days).toBe(1);
  });

  it("finds the longest consecutive-day streak, ignoring gaps", () => {
    const s = aggregateDayRows([
      dayRow({ day: "2026-07-03" }),
      dayRow({ day: "2026-07-04" }),
      dayRow({ day: "2026-07-05" }), // 3-day run
      dayRow({ day: "2026-07-10" }), // gap
      dayRow({ day: "2026-07-11" }), // 2-day run
    ]);
    expect(s.streak_best).toBe(3);
  });
});

/** Mirror of the engine's Intl day derivation, for asserting the negative case. */
function localDayOf(d: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

// A ~1.1 km square park at the equator: polygon spans (0,0)–(0.01,0.01), while
// the stored (attraction-hull) bbox covers only the middle — the exact shape of
// the prod mismatch (hull ⊂ polygon).
const squareBoundary: GeoPolygon = {
  type: "Polygon",
  coordinates: [
    [
      [0, 0],
      [0.01, 0],
      [0.01, 0.01],
      [0, 0.01],
      [0, 0],
    ],
  ],
};
const storedHull = { latMin: 0.003, latMax: 0.007, lngMin: 0.003, lngMax: 0.007 };

function cachedPark(boundary: GeoPolygon | null): CachedPark {
  return {
    id: 1,
    timezone: "America/New_York",
    ...geofenceBounds(storedHull, boundary),
    boundary,
  };
}

describe("geofenceBounds", () => {
  it("derives the prefilter from the boundary (padded), not the stored hull", () => {
    const b = geofenceBounds(storedHull, squareBoundary);
    expect(b.latMin).toBeLessThan(0);
    expect(b.latMax).toBeGreaterThan(0.01);
    expect(b.lngMin).toBeLessThan(0);
    expect(b.lngMax).toBeGreaterThan(0.01);
    // Pad is the buffer (~30 m ≈ 0.00027°), not some huge margin.
    expect(b.latMin).toBeGreaterThan(-0.001);
  });
  it("falls back to the padded stored hull without a boundary", () => {
    const b = geofenceBounds(storedHull, null);
    expect(b.latMin).toBeLessThan(0.003);
    expect(b.latMin).toBeGreaterThan(0.002);
    expect(b.latMax).toBeGreaterThan(0.007);
  });
});

describe("parkForPoint", () => {
  const parks = [cachedPark(squareBoundary)];
  it("matches a point inside the polygon but outside the stored hull", () => {
    // The pre-fix dead zone: near the rim, nowhere near an attraction.
    expect(parkForPoint([0.0005, 0.0005], parks)?.id).toBe(1);
  });
  it("matches a point within the buffer just outside the polygon", () => {
    // ~11 m south of the edge — GPS drift outside a tight fence line.
    expect(parkForPoint([0.005, -0.0001], parks)?.id).toBe(1);
  });
  it("rejects a point beyond the buffer", () => {
    // ~111 m south of the edge.
    expect(parkForPoint([0.005, -0.001], parks)).toBeNull();
  });
  it("gates by padded bbox alone when a park has no boundary", () => {
    const noPoly = [cachedPark(null)];
    expect(parkForPoint([0.005, 0.005], noPoly)?.id).toBe(1);
    expect(parkForPoint([0.001, 0.001], noPoly)).toBeNull();
  });
});

describe("parkForPoint adjacency", () => {
  it("strict containment beats an adjacent park's buffer regardless of order", () => {
    // Two parks sharing the lng=0.01 edge (the USF/IOA shape). A point just
    // inside the second park sits within the first park's buffer; listing
    // order must not decide it.
    const east: GeoPolygon = {
      type: "Polygon",
      coordinates: [
        [
          [0.01, 0],
          [0.02, 0],
          [0.02, 0.01],
          [0.01, 0.01],
          [0.01, 0],
        ],
      ],
    };
    const parks: CachedPark[] = [
      cachedPark(squareBoundary),
      { id: 2, timezone: "America/New_York", ...geofenceBounds(storedHull, east), boundary: east },
    ];
    const justInsideEast: [number, number] = [0.0101, 0.005]; // ~11m past the shared edge
    expect(parkForPoint(justInsideEast, parks)?.id).toBe(2);
    expect(parkForPoint([0.0099, 0.005], parks)?.id).toBe(1);
  });
});
