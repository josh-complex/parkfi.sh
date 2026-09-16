import { describe, expect, it } from "vite-plus/test";

import { EMPTY_RIDE_FILTER } from "./ride-filter.tsx";
import { applySearchToFilter, filterToSearch, validateWaitsSearch } from "./waits-search.ts";

describe("validateWaitsSearch", () => {
  it("drops every key that isn't set, so the plain board is exactly `/`", () => {
    expect(validateWaitsSearch({})).toEqual({});
    expect(validateWaitsSearch({ parks: "", q: "   " })).toEqual({});
  });

  it("keeps only values the UI can actually show", () => {
    // 45 is a real chip; 37 is not, so it degrades to no cap rather than a
    // filter nothing on the page can undo.
    expect(validateWaitsSearch({ max: "45" })).toEqual({ max: 45 });
    expect(validateWaitsSearch({ max: "37" })).toEqual({});
    expect(validateWaitsSearch({ h: 42 })).toEqual({ h: 42 });
    expect(validateWaitsSearch({ h: 41 })).toEqual({});
    expect(validateWaitsSearch({ sort: "park", dir: "asc" })).toEqual({
      sort: "park",
      dir: "asc",
    });
    expect(validateWaitsSearch({ sort: "chaos" })).toEqual({});
  });

  it("ignores `view` — the list/tiles choice is localStorage, not a link", () => {
    // Old shared links still carry it; it just doesn't reach the board any
    // more, and nothing writes it back.
    expect(validateWaitsSearch({ view: "tiles" })).toEqual({});
    expect(validateWaitsSearch({ parks: "epcot", view: "tiles" })).toEqual({ parks: "epcot" });
  });

  it("reads flags in every shape a hand-written URL might carry", () => {
    expect(validateWaitsSearch({ open: "1", sr: "true", xp: true })).toEqual({
      open: true,
      sr: true,
      xp: true,
    });
    expect(validateWaitsSearch({ open: "0", sr: "no" })).toEqual({});
  });

  it("lets unknown park and category values through — they simply match nothing", () => {
    // The catalog isn't available at parse time, and a stale shared link should
    // land on an empty board rather than a 404.
    expect(validateWaitsSearch({ parks: "atlantis" })).toEqual({ parks: "atlantis" });
  });
});

describe("applySearchToFilter / filterToSearch", () => {
  it("round-trips a filtered board", () => {
    const search = validateWaitsSearch({
      parks: "epcot,magic-kingdom",
      cat: "thrill",
      q: "space",
      open: "1",
      max: "45",
      h: 42,
      sort: "park",
      dir: "asc",
    });
    const filter = applySearchToFilter(EMPTY_RIDE_FILTER, search);
    expect([...filter.parks].sort()).toEqual(["epcot", "magic-kingdom"]);
    expect(filter.query).toBe("space");
    expect(filter.maxWait).toBe(45);
    expect(filter.heightBand).toBe(42);
    expect(filter.openOnly).toBe(true);
    expect(filterToSearch(filter, "park", "asc")).toEqual(search);
  });

  it("omits defaults so an unfiltered board never grows a query string", () => {
    expect(filterToSearch(EMPTY_RIDE_FILTER, "wait", "desc")).toEqual({});
  });

  it("serialises a park selection in a stable order", () => {
    const a = applySearchToFilter(EMPTY_RIDE_FILTER, { parks: "epcot,magic-kingdom" });
    const b = applySearchToFilter(EMPTY_RIDE_FILTER, { parks: "magic-kingdom,epcot" });
    expect(filterToSearch(a, "wait", "desc")).toEqual(filterToSearch(b, "wait", "desc"));
  });

  it("leaves the map's overlay layers alone", () => {
    // The board neither shows nor serialises them, so a visit here must not
    // silently clear what the map had turned on.
    const withLayers = {
      ...EMPTY_RIDE_FILTER,
      layers: { ...EMPTY_RIDE_FILTER.layers, dining: true },
    };
    expect(applySearchToFilter(withLayers, { parks: "epcot" }).layers.dining).toBe(true);
  });
});
