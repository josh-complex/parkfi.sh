import { describe, expect, it } from "vite-plus/test";

import { distanceMeters } from "#/server/living/geofence.ts";

import {
  angleDelta,
  bearingBetween,
  extendSnappedTrail,
  projectOntoRoute,
} from "./nav-geometry.ts";

// A test-local metre offsetter around an Orlando-ish anchor, so routes read in
// metres east/north instead of raw degree soup.
const ORIGIN: [number, number] = [-81.51, 28.43];
const M_PER_DEG = 111_320;
const COS_LAT = Math.cos((ORIGIN[1] * Math.PI) / 180);
function at(eastM: number, northM: number): [number, number] {
  return [ORIGIN[0] + eastM / (M_PER_DEG * COS_LAT), ORIGIN[1] + northM / M_PER_DEG];
}

describe("angleDelta", () => {
  it("takes the short way across the 0/360 seam", () => {
    expect(angleDelta(350, 10)).toBe(20);
    expect(angleDelta(10, 350)).toBe(-20);
    expect(angleDelta(0, 180)).toBe(180);
  });
});

describe("bearingBetween", () => {
  it("matches the compass cardinals", () => {
    expect(bearingBetween(at(0, 0), at(0, 100))).toBeCloseTo(0, 0); // north
    expect(bearingBetween(at(0, 0), at(100, 0))).toBeCloseTo(90, 0); // east
    expect(bearingBetween(at(0, 0), at(0, -100))).toBeCloseTo(180, 0); // south
    expect(bearingBetween(at(0, 0), at(-100, 0))).toBeCloseTo(270, 0); // west
  });
});

describe("projectOntoRoute", () => {
  // A 200m eastward path with a corner turning 100m north.
  const route: Array<[number, number]> = [at(0, 0), at(200, 0), at(200, 100)];

  it("projects a point beside the path perpendicular onto it", () => {
    const p = projectOntoRoute(at(100, 8), route);
    expect(p).not.toBeNull();
    expect(p!.distM).toBeCloseTo(8, 0);
    expect(p!.alongM).toBeCloseTo(100, 0);
    expect(distanceMeters(p!.point, at(100, 0))).toBeLessThan(1);
  });

  it("clamps to segment ends and picks the nearest segment past a corner", () => {
    const p = projectOntoRoute(at(210, 50), route);
    expect(p).not.toBeNull();
    // Nearest is the northbound leg (10m west of it), 200 + 50 metres along.
    expect(p!.distM).toBeCloseTo(10, 0);
    expect(p!.alongM).toBeCloseTo(250, 0);
  });

  it("returns null for a degenerate route", () => {
    expect(projectOntoRoute(at(0, 0), [at(1, 1)])).toBeNull();
  });
});

describe("extendSnappedTrail", () => {
  const route: Array<[number, number]> = [at(0, 0), at(200, 0), at(200, 100)];

  it("appends raw fixes when there is no route", () => {
    const trail = extendSnappedTrail([], null, at(5, 5));
    expect(trail).toEqual([at(5, 5)]);
  });

  it("snaps on-route wobble onto the path", () => {
    let trail = extendSnappedTrail([], route, at(20, 6));
    trail = extendSnappedTrail(trail, route, at(40, -7));
    expect(trail).toHaveLength(2);
    for (const pt of trail) {
      const proj = projectOntoRoute(pt, route)!;
      expect(proj.distM).toBeLessThan(0.5);
    }
  });

  it("back-fills the route's corner instead of cutting it", () => {
    // Two fixes straddling the corner at (200, 0): raw points would draw a
    // straight chord; the snapped trail must include the corner vertex.
    let trail = extendSnappedTrail([], route, at(170, 4));
    trail = extendSnappedTrail(trail, route, at(196, 40));
    const corner = at(200, 0);
    expect(trail.some((pt) => distanceMeters(pt, corner) < 1)).toBe(true);
  });

  it("records a genuine departure from the route raw", () => {
    let trail = extendSnappedTrail([], route, at(100, 5));
    const offPath = at(100, 60); // 60m off the path — another walkway
    trail = extendSnappedTrail(trail, route, offPath);
    expect(trail[trail.length - 1]).toEqual(offPath);
  });

  it("keeps backtracking in walk order", () => {
    // Forward past the corner, then back the way we came — the fill vertices
    // must come out reversed, nearest-first.
    let trail = extendSnappedTrail([], route, at(196, 40));
    trail = extendSnappedTrail(trail, route, at(170, 4));
    const alongs = trail.map((pt) => projectOntoRoute(pt, route)!.alongM);
    for (let i = 1; i < alongs.length; i++) expect(alongs[i]).toBeLessThan(alongs[i - 1]);
  });

  it("skips the back-fill across an implausibly long gap", () => {
    let trail = extendSnappedTrail([], route, at(2, 0));
    trail = extendSnappedTrail(trail, route, at(200, 98)); // ~296m along in one hop
    // Snapped endpoints only — no vertex parade faking a walked path.
    expect(trail).toHaveLength(2);
  });
});
