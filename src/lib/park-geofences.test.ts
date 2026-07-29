import { describe, expect, it } from "vite-plus/test";

import { haversineM, parkGeofencesFromParks, type ParkGeoInput } from "./park-geofences.ts";

/** Build a park row with a small square bbox centred on [lng, lat]. */
function boxPark(id: number, lng: number, lat: number, halfDeg = 0.005): ParkGeoInput {
  return {
    id,
    latitude: lat,
    longitude: lng,
    latMin: lat - halfDeg,
    latMax: lat + halfDeg,
    lngMin: lng - halfDeg,
    lngMax: lng + halfDeg,
  };
}

describe("haversineM", () => {
  it("is ~0 for the same point", () => {
    expect(haversineM([-81.5, 28.4], [-81.5, 28.4])).toBeLessThan(1e-6);
  });

  it("measures ~111 km per degree of latitude", () => {
    const d = haversineM([0, 0], [0, 1]);
    expect(d).toBeGreaterThan(110_000);
    expect(d).toBeLessThan(112_000);
  });
});

describe("parkGeofencesFromParks", () => {
  it("centres each fence on the bbox midpoint and stringifies the id", () => {
    const [f] = parkGeofencesFromParks([boxPark(7, -81.5, 28.4)], null);
    expect(f.id).toBe("7");
    expect(f.lng).toBeCloseTo(-81.5, 6);
    expect(f.lat).toBeCloseTo(28.4, 6);
  });

  it("clamps the radius into the sane range", () => {
    // A tiny bbox → radius floored to the minimum (200 m).
    const [tiny] = parkGeofencesFromParks([boxPark(1, 0, 0, 0.0001)], null);
    expect(tiny.radiusM).toBe(200);
    // A huge bbox → radius capped at the maximum (2500 m).
    const [huge] = parkGeofencesFromParks([boxPark(2, 0, 0, 0.5)], null);
    expect(huge.radiusM).toBe(2_500);
  });

  it("prefers the real-footprint fence bbox over the attraction hull", () => {
    // Tight attraction hull (would floor to the 200 m minimum) + a fence bbox
    // ~3× wider — the circle must derive from the fence.
    const park: ParkGeoInput = {
      ...boxPark(5, -81.581, 28.418, 0.003),
      fence: {
        latMin: 28.418 - 0.009,
        latMax: 28.418 + 0.009,
        lngMin: -81.581 - 0.009,
        lngMax: -81.581 + 0.009,
      },
    };
    const [f] = parkGeofencesFromParks([park], null);
    const [hullOnly] = parkGeofencesFromParks([boxPark(5, -81.581, 28.418, 0.003)], null);
    expect(f.radiusM).toBeGreaterThan(hullOnly.radiusM);
    // Half-diagonal of an ~2 km-wide box + the 150 m buffer lands well past 1 km.
    expect(f.radiusM).toBeGreaterThan(1_000);
    expect(f.lat).toBeCloseTo(28.418, 5);
    expect(f.lng).toBeCloseTo(-81.581, 5);
  });

  it("falls back to the hull bbox when fence is null", () => {
    const park: ParkGeoInput = { ...boxPark(6, -81.5, 28.4), fence: null };
    const [withNullFence] = parkGeofencesFromParks([park], null);
    const [plain] = parkGeofencesFromParks([boxPark(6, -81.5, 28.4)], null);
    expect(withNullFence).toEqual(plain);
  });

  it("falls back to the stored centroid when there's no bbox", () => {
    const noBox: ParkGeoInput = {
      id: 3,
      latitude: 33.8,
      longitude: -117.9,
      latMin: null,
      latMax: null,
      lngMin: null,
      lngMax: null,
    };
    const [f] = parkGeofencesFromParks([noBox], null);
    expect(f.lat).toBeCloseTo(33.8, 6);
    expect(f.lng).toBeCloseTo(-117.9, 6);
    expect(f.radiusM).toBe(200);
  });

  it("drops parks with no usable coordinates", () => {
    const nada: ParkGeoInput = {
      id: 4,
      latitude: null,
      longitude: null,
      latMin: null,
      latMax: null,
      lngMin: null,
      lngMax: null,
    };
    expect(parkGeofencesFromParks([nada], null)).toHaveLength(0);
  });

  it("sorts nearest-first when a reference point is given", () => {
    const orlando = boxPark(10, -81.5, 28.4);
    const anaheim = boxPark(20, -117.9, 33.8);
    const nearOrlando: [number, number] = [-81.4, 28.4];
    const fences = parkGeofencesFromParks([anaheim, orlando], nearOrlando);
    expect(fences.map((f) => f.id)).toEqual(["10", "20"]);
  });

  it("caps at the iOS 20-region limit", () => {
    const many = Array.from({ length: 30 }, (_, i) => boxPark(i, i * 0.1, 0));
    expect(parkGeofencesFromParks(many, [0, 0])).toHaveLength(20);
  });
});
