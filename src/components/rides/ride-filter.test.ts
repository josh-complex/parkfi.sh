import { describe, expect, it } from "vite-plus/test";

import {
  EMPTY_RIDE_FILTER,
  rideMatchesFilter,
  rideTypeKey,
  type RideFilter,
} from "./ride-filter.tsx";

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

describe("rideMatchesFilter — parks", () => {
  it("narrows to the selected parks and leaves an empty set meaning all", () => {
    const f = filter({ parks: new Set(["epcot"]) });
    expect(rideMatchesFilter(ride({ parkSlug: "epcot" }), f)).toBe(true);
    expect(rideMatchesFilter(ride({ parkSlug: "magic-kingdom" }), f)).toBe(false);
    expect(rideMatchesFilter(ride({ parkSlug: "magic-kingdom" }), filter())).toBe(true);
  });

  it("can't park-filter a row with no park — the map's items pass through", () => {
    // The map is already scoped to one park; its `BoardItem` carries no slug,
    // so a stray park selection there must not blank the map.
    expect(rideMatchesFilter(ride(), filter({ parks: new Set(["epcot"]) }))).toBe(true);
  });
});

describe("rideMatchesFilter — name search", () => {
  it("matches case-insensitively on a substring, ignoring surrounding space", () => {
    const r = ride({ name: "Space Mountain" });
    expect(rideMatchesFilter(r, filter({ query: "  space " }))).toBe(true);
    expect(rideMatchesFilter(r, filter({ query: "MOUNTAIN" }))).toBe(true);
    expect(rideMatchesFilter(r, filter({ query: "tron" }))).toBe(false);
  });

  it("is inert for rows with no name, and for an empty query", () => {
    expect(rideMatchesFilter(ride(), filter({ query: "space" }))).toBe(true);
    expect(rideMatchesFilter(ride({ name: "Tron" }), filter({ query: "   " }))).toBe(true);
  });
});

describe("rideMatchesFilter — the Houses type", () => {
  const houses = filter({ categories: new Set(["house"]) });

  it("narrows to tagged houses and drops everything else", () => {
    expect(rideMatchesFilter(ride({ hauntedHouse: true }), houses)).toBe(true);
    expect(rideMatchesFilter(ride({ hauntedHouse: false }), houses)).toBe(false);
    // A surface whose rows don't carry the tag at all (the map's `BoardItem`)
    // finds nothing rather than showing every ride as a house.
    expect(rideMatchesFilter(ride(), houses)).toBe(false);
  });

  it("types a house as a house, not as its stored category", () => {
    // The houses are filed as ordinary `attraction` rows, so picking Rides
    // must not drag the event's mazes back onto a daytime board.
    const rides = filter({ categories: new Set(["attraction"]) });
    const house = ride({ category: "attraction", hauntedHouse: true });
    expect(rideMatchesFilter(house, rides)).toBe(false);
    expect(rideMatchesFilter(house, houses)).toBe(true);
    expect(rideTypeKey(house)).toBe("house");
    expect(rideTypeKey(ride({ category: "attraction" }))).toBe("attraction");
  });

  it("leaves the board alone when no type is picked", () => {
    expect(rideMatchesFilter(ride({ hauntedHouse: false }), filter())).toBe(true);
    expect(rideMatchesFilter(ride({ hauntedHouse: true }), filter())).toBe(true);
  });
});
