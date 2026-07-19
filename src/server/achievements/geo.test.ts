import { describe, expect, it } from "vite-plus/test";

import { distanceMeters, distanceToBoundary, pointInPolygon, polygonBbox } from "./geo.ts";

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

describe("polygonBbox", () => {
  it("returns the ring extent for a Polygon", () => {
    expect(polygonBbox(square)).toEqual({ latMin: 0, latMax: 1, lngMin: 0, lngMax: 1 });
  });
  it("spans all polygons of a MultiPolygon", () => {
    const multi: GeoPolygon = {
      type: "MultiPolygon",
      coordinates: [
        square.coordinates as [number, number][][],
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
    expect(polygonBbox(multi)).toEqual({ latMin: 0, latMax: 11, lngMin: 0, lngMax: 11 });
  });
  it("is null for null/empty geometry", () => {
    expect(polygonBbox(null)).toBeNull();
    expect(polygonBbox({ type: "Polygon", coordinates: [] })).toBeNull();
  });
});

describe("distanceToBoundary", () => {
  // A ~1.1 km square near the equator: 0.01° per side at (0,0).
  const smallSquare: GeoPolygon = {
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
  it("measures ~111m for a point 0.001° outside an edge", () => {
    const d = distanceToBoundary([0.005, -0.001], smallSquare);
    expect(d).toBeGreaterThan(100);
    expect(d).toBeLessThan(120);
  });
  it("is ~0 on the boundary itself", () => {
    expect(distanceToBoundary([0.005, 0], smallSquare)).toBeCloseTo(0, 3);
  });
  it("is large for a point deep inside (edge distance, not containment)", () => {
    const d = distanceToBoundary([0.005, 0.005], smallSquare);
    expect(d).toBeGreaterThan(500);
  });
  it("uses the nearest corner beyond segment ends", () => {
    // Diagonally off the (0,0) corner by 0.001° in both axes: ~157m.
    const d = distanceToBoundary([-0.001, -0.001], smallSquare);
    expect(d).toBeGreaterThan(150);
    expect(d).toBeLessThan(165);
  });
  it("is Infinity for null geometry", () => {
    expect(distanceToBoundary([0, 0], null)).toBe(Infinity);
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
