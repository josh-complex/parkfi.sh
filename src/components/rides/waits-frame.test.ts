import { describe, expect, it } from "vite-plus/test";

import { filterToFrame, framesEqual, pointInFrame } from "./waits-frame.ts";

import type { MapFrame } from "./waits-frame.ts";

/** A box around Magic Kingdom, roughly. */
const MK: MapFrame = { west: -81.59, east: -81.57, south: 28.41, north: 28.43 };

const at = (latitude: number, longitude: number) => ({ latitude, longitude });

describe("pointInFrame", () => {
  it("includes points inside the box and on its edges", () => {
    expect(pointInFrame(at(28.42, -81.58), MK)).toBe(true);
    expect(pointInFrame(at(28.41, -81.59), MK)).toBe(true);
  });

  it("excludes points outside it", () => {
    expect(pointInFrame(at(28.36, -81.55), MK)).toBe(false); // EPCOT, south-east
    expect(pointInFrame(at(28.42, -81.46), MK)).toBe(false); // Universal, east
  });

  it("excludes a row with no coordinates — the map can't show it", () => {
    expect(pointInFrame({ latitude: null, longitude: null }, MK)).toBe(false);
    expect(pointInFrame({ latitude: 28.42, longitude: null }, MK)).toBe(false);
  });

  it("handles a frame panned across the antimeridian", () => {
    const wrapped: MapFrame = { west: 170, east: -170, south: -10, north: 10 };
    expect(pointInFrame(at(0, 179), wrapped)).toBe(true);
    expect(pointInFrame(at(0, -179), wrapped)).toBe(true);
    expect(pointInFrame(at(0, 0), wrapped)).toBe(false);
  });
});

describe("filterToFrame", () => {
  const rides = [at(28.42, -81.58), at(28.36, -81.55), { latitude: null, longitude: null }];

  it("narrows to the rows in view", () => {
    expect(filterToFrame(rides, MK)).toEqual([rides[0]]);
  });

  it("narrows nothing when the map is off", () => {
    expect(filterToFrame(rides, null)).toEqual(rides);
  });
});

describe("framesEqual", () => {
  it("treats sub-millimetre drift as the same frame", () => {
    expect(framesEqual(MK, { ...MK, west: MK.west + 1e-9 })).toBe(true);
    expect(framesEqual(MK, { ...MK, west: MK.west + 0.01 })).toBe(false);
  });

  it("compares nulls by identity", () => {
    expect(framesEqual(null, null)).toBe(true);
    expect(framesEqual(null, MK)).toBe(false);
  });
});
