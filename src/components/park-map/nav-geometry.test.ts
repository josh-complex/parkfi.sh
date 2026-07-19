import { describe, expect, it } from "vite-plus/test";

import { distanceMeters } from "#/server/living/geofence.ts";

import {
  angleDelta,
  bearingBetween,
  buildRouteModel,
  coarseCoord,
  compassDirection,
  computeProgress,
  extendSnappedTrail,
  isStartManeuver,
  projectOntoRoute,
  remainingRouteCoords,
  roundCoord,
  routeBearingAt,
  SNAP_OFF_ROUTE_M,
} from "./nav-geometry.ts";

import type { RouteManeuver, RouteResult } from "#/server/routing/valhalla.ts";

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

describe("routeBearingAt", () => {
  // A 200m eastward path with a corner turning 100m north.
  const route: Array<[number, number]> = [at(0, 0), at(200, 0), at(200, 100)];

  it("points along the route's direction of travel, not toward the fix", () => {
    // Standing 10m north of the eastbound leg: the bearing is still east.
    expect(routeBearingAt(route, at(50, 10))!).toBeCloseTo(90, 0);
  });

  it("blends into the next leg as the look-ahead crosses a corner", () => {
    // 10m before the corner, the 20m look-ahead lands 10m up the north leg —
    // the bearing swings between east (90°) and north (0°/360°).
    const b = routeBearingAt(route, at(190, 0))!;
    expect(b).toBeGreaterThan(20);
    expect(b).toBeLessThan(90);
  });

  it("holds the final segment's direction at the route end", () => {
    expect(routeBearingAt(route, at(200, 95))!).toBeCloseTo(0, 0);
  });

  it("returns null without a usable route", () => {
    expect(routeBearingAt(null, at(0, 0))).toBeNull();
    expect(routeBearingAt([at(1, 1)], at(0, 0))).toBeNull();
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

describe("isStartManeuver", () => {
  it("flags Valhalla start codes 1/2/3 only", () => {
    expect(isStartManeuver(1)).toBe(true);
    expect(isStartManeuver(2)).toBe(true);
    expect(isStartManeuver(3)).toBe(true);
    expect(isStartManeuver(15)).toBe(false); // turn left
    expect(isStartManeuver(4)).toBe(false); // destination
  });
});

// A 200m-east-then-100m-north route (total 300m) with the canonical maneuver
// shape Valhalla emits: a start preamble, one real turn, and a destination.
const maneuver = (
  type: number,
  beginShapeIndex: number,
  extra?: Partial<RouteManeuver>,
): RouteManeuver => ({
  instruction: `maneuver ${type}`,
  distanceMeters: 0,
  timeSeconds: 0,
  type,
  beginShapeIndex,
  ...extra,
});
const routeResult: RouteResult = {
  coordinates: [at(0, 0), at(200, 0), at(200, 100)],
  distanceMeters: 300,
  durationSeconds: 300, // 1 m/s, so eta seconds == remaining metres
  maneuvers: [maneuver(1, 0), maneuver(15, 1), maneuver(4, 2)],
};

describe("buildRouteModel", () => {
  it("prefix-sums the route and locates each maneuver along it", () => {
    const model = buildRouteModel(routeResult)!;
    expect(model).not.toBeNull();
    expect(model.totalM).toBeCloseTo(300, 0);
    expect(model.cumM).toHaveLength(3);
    expect(model.cumM[1]).toBeCloseTo(200, 0);
    expect(model.maneuverAlongM).toEqual([
      expect.closeTo(0, 0),
      expect.closeTo(200, 0),
      expect.closeTo(300, 0),
    ]);
  });

  it("returns null for a degenerate route", () => {
    expect(buildRouteModel({ ...routeResult, coordinates: [at(0, 0)] })).toBeNull();
  });
});

describe("computeProgress", () => {
  const model = buildRouteModel(routeResult)!;

  it("skips the start maneuver and headlines the real next turn (defect 1.1)", () => {
    // Standing at the origin: the next actionable maneuver is the turn (index 1),
    // never the start preamble (index 0).
    const p = computeProgress(model, at(0, 0))!;
    expect(p.nextManeuverIndex).toBe(1);
    expect(p.distToNextM).toBeCloseTo(200, 0);
  });

  it("ticks distance-to-turn and remaining/ETA down as you walk (defect 1.2)", () => {
    const p = computeProgress(model, at(100, 3))!; // 100m along, 3m off the path
    expect(p.alongM).toBeCloseTo(100, 0);
    expect(p.distToNextM).toBeCloseTo(100, 0);
    expect(p.remainingM).toBeCloseTo(200, 0);
    expect(p.etaSeconds).toBeCloseTo(200, 0);
    expect(p.offRouteM).toBeCloseTo(3, 0);
  });

  it("advances to the destination maneuver past the turn", () => {
    const p = computeProgress(model, at(200, 50))!; // 250m along, on the north leg
    expect(p.nextManeuverIndex).toBe(2); // destination
    expect(p.distToNextM).toBeCloseTo(50, 0);
    expect(p.remainingM).toBeCloseTo(50, 0);
  });

  it("reports a genuine off-route fix beyond the snap threshold", () => {
    const p = computeProgress(model, at(100, 60))!; // 60m off the path
    expect(p.offRouteM).toBeGreaterThan(SNAP_OFF_ROUTE_M);
  });
});

describe("remainingRouteCoords", () => {
  const model = buildRouteModel(routeResult)!;

  it("starts the line at the interpolated on-path point and keeps later vertices", () => {
    const rest = remainingRouteCoords(model, 50)!; // 50m along the eastbound leg
    expect(rest).toHaveLength(3);
    expect(distanceMeters(rest[0], at(50, 0))).toBeLessThan(1);
    expect(rest[1]).toEqual(at(200, 0)); // the corner survives
    expect(rest[2]).toEqual(at(200, 100));
  });

  it("drops passed vertices once the walker is beyond them", () => {
    const rest = remainingRouteCoords(model, 250)!; // 50m up the north leg
    expect(rest).toHaveLength(2);
    expect(distanceMeters(rest[0], at(200, 50))).toBeLessThan(1);
    expect(rest[1]).toEqual(at(200, 100));
  });

  it("returns the full geometry before the start and null past the end", () => {
    expect(remainingRouteCoords(model, 0)).toEqual(routeResult.coordinates);
    expect(remainingRouteCoords(model, -5)).toEqual(routeResult.coordinates);
    expect(remainingRouteCoords(model, model.totalM)).toBeNull();
    expect(remainingRouteCoords(model, model.totalM + 10)).toBeNull();
  });

  it("lands exactly on a vertex without duplicating it", () => {
    const rest = remainingRouteCoords(model, model.cumM[1])!; // standing on the corner
    expect(rest).toHaveLength(2);
    expect(distanceMeters(rest[0], at(200, 0))).toBeLessThan(1);
    expect(rest[1]).toEqual(at(200, 100));
  });
});

describe("roundCoord", () => {
  it("rounds to 4 decimals (~11 m) so nearby fixes share a query/cache key", () => {
    expect(roundCoord([-81.123456789, 28.7654321004])).toEqual([-81.1235, 28.7654]);
  });

  it("leaves already-round coords untouched", () => {
    expect(roundCoord([-81.51, 28.43])).toEqual([-81.51, 28.43]);
  });
});

describe("coarseCoord", () => {
  it("rounds to 3 decimals (~110 m) so wobbling fixes share an estimate key", () => {
    expect(coarseCoord([-81.123456789, 28.7654321004])).toEqual([-81.123, 28.765]);
  });

  it("keys GPS wobble around one spot to the same coord", () => {
    // ~20 m apart — typical low-profile watch jitter while standing still.
    expect(coarseCoord([-81.5101, 28.43005])).toEqual(coarseCoord([-81.51025, 28.4301]));
  });
});

describe("compassDirection", () => {
  it("names the eight compass points", () => {
    expect(compassDirection(0)).toBe("north");
    expect(compassDirection(45)).toBe("northeast");
    expect(compassDirection(90)).toBe("east");
    expect(compassDirection(180)).toBe("south");
    expect(compassDirection(270)).toBe("west");
  });

  it("wraps across the 0/360 seam and normalizes negatives", () => {
    expect(compassDirection(350)).toBe("north");
    expect(compassDirection(337.5)).toBe("north"); // rounds up across the seam
    expect(compassDirection(-45)).toBe("northwest");
    expect(compassDirection(405)).toBe("northeast");
  });
});
