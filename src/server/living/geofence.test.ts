import { describe, expect, it } from "vite-plus/test";

import {
  convexHull,
  distanceMeters,
  pointInPolygon,
  realmForPoint,
  tierFor,
  type LngLat,
} from "./geofence.ts";

import type { GeoPolygon } from "#/db/schema.ts";

// A unit square in [lng,lat] from (0,0) to (1,1).
const square: GeoPolygon = {
  type: "Polygon",
  coordinates: [
    [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
      [0, 0],
    ],
  ],
};

describe("pointInPolygon", () => {
  it("returns true for an interior point", () => {
    expect(pointInPolygon([0.5, 0.5], square)).toBe(true);
  });
  it("returns false for an exterior point", () => {
    expect(pointInPolygon([2, 2], square)).toBe(false);
  });
  it("returns false for null/empty geometry", () => {
    expect(pointInPolygon([0.5, 0.5], null)).toBe(false);
  });
  it("handles MultiPolygon — hit in the second polygon", () => {
    const multi: GeoPolygon = {
      type: "MultiPolygon",
      coordinates: [
        [
          [
            [0, 0],
            [1, 0],
            [1, 1],
            [0, 1],
            [0, 0],
          ],
        ],
        [
          [
            [10, 10],
            [11, 10],
            [11, 11],
            [10, 11],
            [10, 10],
          ],
        ],
      ],
    };
    expect(pointInPolygon([10.5, 10.5], multi)).toBe(true);
    expect(pointInPolygon([5, 5], multi)).toBe(false);
  });
});

describe("distanceMeters", () => {
  it("is ~0 for identical points", () => {
    expect(distanceMeters([-81.5, 28.4], [-81.5, 28.4])).toBeCloseTo(0, 5);
  });
  it("approximates a short real-world distance", () => {
    // ~0.001 deg latitude ≈ 111 m.
    const d = distanceMeters([-81.5, 28.4], [-81.5, 28.401]);
    expect(d).toBeGreaterThan(100);
    expect(d).toBeLessThan(120);
  });
});

describe("realmForPoint", () => {
  const realms = [
    { id: 1, boundary: square },
    { id: 2, boundary: null, centroid: [5, 5] as LngLat },
  ];
  it("prefers a polygon hit", () => {
    expect(realmForPoint([0.5, 0.5], realms)).toBe(1);
  });
  it("falls back to nearest centroid within radius", () => {
    // ~0.0001 deg from the centroid — well within 75 m.
    expect(realmForPoint([5.0001, 5.0001], realms)).toBe(2);
  });
  it("returns null when nothing matches", () => {
    expect(realmForPoint([50, 50], realms)).toBe(null);
  });
});

describe("tierFor", () => {
  it("home when in the companion's home realm", () => {
    expect(tierFor({ homeRealmId: 7, currentRealmId: 7, homeParkId: 1, currentParkId: 1 })).toBe(
      "home",
    );
  });
  it("guest when elsewhere in the same park", () => {
    expect(tierFor({ homeRealmId: 7, currentRealmId: 9, homeParkId: 1, currentParkId: 1 })).toBe(
      "guest",
    );
  });
  it("away when in a different park", () => {
    expect(tierFor({ homeRealmId: 7, currentRealmId: 9, homeParkId: 1, currentParkId: 2 })).toBe(
      "away",
    );
  });
});

describe("convexHull", () => {
  it("returns the outer ring of a point cloud", () => {
    const hull = convexHull([
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
      [0.5, 0.5], // interior — must be dropped
    ]);
    expect(hull).not.toContainEqual([0.5, 0.5]);
    expect(hull.length).toBe(4);
  });
  it("passes through degenerate (<=2 point) inputs", () => {
    expect(convexHull([[0, 0]]).length).toBe(1);
  });
});
