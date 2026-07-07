import { describe, expect, it } from "vite-plus/test";

import { distanceMeters, pointInPolygon } from "./geo.ts";

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
  it("approximates ~111m per 0.001 deg latitude", () => {
    const d = distanceMeters([-81.5, 28.4], [-81.5, 28.401]);
    expect(d).toBeGreaterThan(100);
    expect(d).toBeLessThan(120);
  });
});
