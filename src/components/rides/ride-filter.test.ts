import { describe, expect, it } from "vite-plus/test";

import { EMPTY_RIDE_FILTER, rideMatchesFilter, type RideFilter } from "./ride-filter.tsx";

const ride = (over: Partial<Parameters<typeof rideMatchesFilter>[0]> = {}) => ({
  category: "thrill",
  status: "OPERATING",
  standbyWait: 20,
  heightRequirement: null,
  ...over,
});

const filter = (over: Partial<RideFilter> = {}): RideFilter => ({ ...EMPTY_RIDE_FILTER, ...over });

describe("rideMatchesFilter — no height requirement", () => {
  it("keeps a ride whose published minimum is zero", () => {
    // Disney publishes this as the prose "Any Height", which the old
    // `heightRequirement != null` test wrongly excluded.
    expect(
      rideMatchesFilter(
        ride({ heightRequirement: "Any Height", minHeightIn: 0 }),
        filter({ noHeightReq: true }),
      ),
    ).toBe(true);
  });

  it("drops a ride with a real minimum", () => {
    expect(
      rideMatchesFilter(
        ride({ heightRequirement: '40" (102cm) or taller', minHeightIn: 40 }),
        filter({ noHeightReq: true }),
      ),
    ).toBe(false);
  });

  it("still falls back to the prose when no numeric height is stored", () => {
    expect(rideMatchesFilter(ride(), filter({ noHeightReq: true }))).toBe(true);
    expect(
      rideMatchesFilter(
        ride({ heightRequirement: '40" (102cm) or taller' }),
        filter({ noHeightReq: true }),
      ),
    ).toBe(false);
  });
});

describe("rideMatchesFilter — height band", () => {
  it("matches every ride a rider that tall can get on", () => {
    const f = filter({ heightBand: 42 });
    expect(rideMatchesFilter(ride({ minHeightIn: 0 }), f)).toBe(true);
    expect(rideMatchesFilter(ride({ minHeightIn: 42 }), f)).toBe(true);
    expect(rideMatchesFilter(ride({ minHeightIn: 48 }), f)).toBe(false);
  });

  it("excludes rides whose minimum we don't know rather than guessing", () => {
    expect(rideMatchesFilter(ride({ minHeightIn: null }), filter({ heightBand: 42 }))).toBe(false);
  });
});

describe("rideMatchesFilter — operator attribute chips", () => {
  it("narrows to a published true only", () => {
    expect(rideMatchesFilter(ride({ expressPass: true }), filter({ expressPass: true }))).toBe(
      true,
    );
    expect(rideMatchesFilter(ride({ expressPass: false }), filter({ expressPass: true }))).toBe(
      false,
    );
    // Disney rows carry null (not published) — the chip must not claim them.
    expect(rideMatchesFilter(ride({ expressPass: null }), filter({ expressPass: true }))).toBe(
      false,
    );
  });

  it("leaves rides alone when the chip is off", () => {
    expect(rideMatchesFilter(ride({ singleRider: null, childSwap: null }), filter())).toBe(true);
  });
});
