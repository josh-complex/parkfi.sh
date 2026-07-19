import { describe, expect, it } from "vite-plus/test";

import {
  advanceTransitState,
  aggregateDisneyDayStats,
  classifyTransition,
  CLASSICS_1971_SET,
  countSetMatches,
  EMPTY_TRANSIT_STATE,
  MAX_TRANSIT_S,
  MOUNTAIN_SET,
  RESORT_ZONES,
  TRANSIT_DEDUPE_S,
  zoneForPoint,
  type DisneyDayRow,
  type TransitState,
} from "./disney.ts";

// ---------------------------------------------------------------------------
// Sets.
// ---------------------------------------------------------------------------

describe("countSetMatches", () => {
  it("counts only pairs present in the set, park-qualified", () => {
    const ridden = [
      { park: "magic-kingdom", slug: "space-mountain" },
      { park: "magic-kingdom", slug: "haunted-mansion" }, // classic, not mountain
      // Same slug, wrong park — must not count toward the MK set.
      { park: "disneyland", slug: "big-thunder-mountain-railroad" },
      { park: "animal-kingdom", slug: "expedition-everest-legend-of-the-forbidden-mountain" },
    ];
    expect(countSetMatches(ridden, MOUNTAIN_SET)).toBe(2);
    expect(countSetMatches(ridden, CLASSICS_1971_SET)).toBe(1);
  });

  it("duplicate rides count once", () => {
    const ridden = [
      { park: "magic-kingdom", slug: "space-mountain" },
      { park: "magic-kingdom", slug: "space-mountain" },
    ];
    expect(countSetMatches(ridden, MOUNTAIN_SET)).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Day-derived Disney stats.
// ---------------------------------------------------------------------------

describe("aggregateDisneyDayStats", () => {
  const ident = { wdwIds: new Set([1, 2, 3, 4]), epcotId: 2 };
  const row = (o: Partial<DisneyDayRow> & { parkId: number; day: string }): DisneyDayRow => ({
    distanceM: 0,
    steps: 0,
    ...o,
  });

  it("counts a four-park day only when all four WDW ids share a day", () => {
    const s = aggregateDisneyDayStats(
      [
        row({ parkId: 1, day: "2026-07-04" }),
        row({ parkId: 2, day: "2026-07-04" }),
        row({ parkId: 3, day: "2026-07-04" }),
        row({ parkId: 4, day: "2026-07-04" }),
        // A three-park day doesn't count.
        row({ parkId: 1, day: "2026-07-05" }),
        row({ parkId: 2, day: "2026-07-05" }),
        row({ parkId: 3, day: "2026-07-05" }),
      ],
      ident,
    );
    expect(s.four_park_days).toBe(1);
    expect(s.wdw_parks_unique).toBe(4);
  });

  it("non-WDW parks don't dilute the four-park day", () => {
    const s = aggregateDisneyDayStats(
      [
        row({ parkId: 1, day: "2026-07-04" }),
        row({ parkId: 2, day: "2026-07-04" }),
        row({ parkId: 3, day: "2026-07-04" }),
        row({ parkId: 4, day: "2026-07-04" }),
        row({ parkId: 99, day: "2026-07-04" }), // Universal hop, irrelevant
      ],
      ident,
    );
    expect(s.four_park_days).toBe(1);
  });

  it("never awards four-park days when the catalog lacks the four gates", () => {
    const s = aggregateDisneyDayStats([row({ parkId: 1, day: "2026-07-04" })], {
      wdwIds: new Set([1]),
      epcotId: null,
    });
    expect(s.four_park_days).toBe(0);
  });

  it("scopes EPCOT steps and best-day distance to the EPCOT id", () => {
    const s = aggregateDisneyDayStats(
      [
        row({ parkId: 2, day: "2026-07-04", steps: 12_000, distanceM: 9_000 }),
        row({ parkId: 2, day: "2026-07-05", steps: 8_000, distanceM: 11_000 }),
        row({ parkId: 1, day: "2026-07-06", steps: 20_000, distanceM: 15_000 }), // MK, ignored
      ],
      ident,
    );
    expect(s.epcot_steps).toBe(20_000);
    expect(s.epcot_best_day_distance_m).toBe(11_000);
  });

  it("home_park_days is the max day count at any single park (any operator)", () => {
    const s = aggregateDisneyDayStats(
      [
        row({ parkId: 99, day: "2026-07-01" }),
        row({ parkId: 99, day: "2026-07-02" }),
        row({ parkId: 99, day: "2026-07-03" }),
        row({ parkId: 1, day: "2026-07-03" }),
      ],
      ident,
    );
    expect(s.home_park_days).toBe(3);
  });

  it("folds to zeros on no data", () => {
    const s = aggregateDisneyDayStats([], ident);
    expect(s).toEqual({
      four_park_days: 0,
      wdw_parks_unique: 0,
      epcot_steps: 0,
      epcot_best_day_distance_m: 0,
      home_park_days: 0,
    });
  });
});

// ---------------------------------------------------------------------------
// Zones.
// ---------------------------------------------------------------------------

describe("zoneForPoint", () => {
  const zone = (slug: string) => RESORT_ZONES.find((z) => z.slug === slug)!;

  it("hits a zone at its center and misses outside the radius", () => {
    const ttc = zone("ttc");
    expect(zoneForPoint([ttc.lng, ttc.lat])?.slug).toBe("ttc");
    // ~1 km east of the TTC is open water/parking — no zone.
    expect(zoneForPoint([ttc.lng + 0.01, ttc.lat])).toBeNull();
  });

  it("seeded zones don't overlap (each center resolves to itself)", () => {
    for (const z of RESORT_ZONES) {
      expect(zoneForPoint([z.lng, z.lat])?.slug).toBe(z.slug);
    }
  });
});

// ---------------------------------------------------------------------------
// Trip classification.
// ---------------------------------------------------------------------------

describe("classifyTransition", () => {
  it("monorail: non-walkable pair credits with or without step evidence", () => {
    expect(classifyTransition("ttc", "mk", 120, true)).toBe("monorail_rides");
    expect(classifyTransition("ttc", "epcot-monorail", 0, false)).toBe("monorail_rides");
  });

  it("monorail: walkable pair needs low-step proof", () => {
    expect(classifyTransition("ttc", "polynesian", 90, true)).toBe("monorail_rides");
    expect(classifyTransition("ttc", "polynesian", 900, true)).toBeNull(); // walked
    expect(classifyTransition("ttc", "polynesian", 0, false)).toBeNull(); // web: unknowable
  });

  it("high steps on any monorail pair means walked — no credit", () => {
    expect(classifyTransition("ttc", "mk", 5_000, true)).toBeNull();
  });

  it("ferry: mid-lagoon → dock is a crossing; dock → lagoon is silent", () => {
    expect(classifyTransition("seven-seas-lagoon", "mk", 40, true)).toBe("ferry_rides");
    expect(classifyTransition("seven-seas-lagoon", "ttc", 0, false)).toBe("ferry_rides");
    expect(classifyTransition("ttc", "seven-seas-lagoon", 0, true)).toBeNull();
  });

  it("skyliner: station pair with a cabin-change leg needs low-step proof", () => {
    expect(classifyTransition("skyliner-hs", "skyliner-caribbean-beach", 200, true)).toBe(
      "skyliner_rides",
    );
    expect(classifyTransition("skyliner-hs", "skyliner-caribbean-beach", 0, false)).toBeNull();
  });

  it("direct epcot↔hs is never a gondola: high steps is the Crescent Lake walk, low is ambiguous (boat)", () => {
    expect(classifyTransition("skyliner-epcot", "skyliner-hs", 2_800, true)).toBe("crescent_walks");
    expect(classifyTransition("skyliner-epcot", "skyliner-hs", 100, true)).toBeNull();
    expect(classifyTransition("skyliner-epcot", "skyliner-hs", 0, false)).toBeNull();
  });

  it("cross-system pairs credit nothing", () => {
    expect(classifyTransition("ttc", "skyliner-epcot", 0, true)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// State machine.
// ---------------------------------------------------------------------------

describe("advanceTransitState", () => {
  const t0 = new Date("2026-07-19T14:00:00Z");
  const at = (s: number) => new Date(t0.getTime() + s * 1000);
  const inZone = (slug: string, atTime: Date, extra: Partial<TransitState> = {}): TransitState => ({
    ...EMPTY_TRANSIT_STATE,
    zoneSlug: slug,
    zoneAt: atTime,
    ...extra,
  });

  it("between zones: anchor freezes, steps accumulate", () => {
    const { next, credits } = advanceTransitState(inZone("ttc", t0), null, at(60), 40, true);
    expect(credits).toEqual([]);
    expect(next.zoneSlug).toBe("ttc");
    expect(next.zoneAt).toEqual(t0);
    expect(next.zoneSteps).toBe(40);
  });

  it("same zone refreshes without credit (GPS flapping, loitering)", () => {
    const { next, credits } = advanceTransitState(
      inZone("ttc", t0, { zoneSteps: 500 }),
      "ttc",
      at(120),
      30,
      true,
    );
    expect(credits).toEqual([]);
    expect(next.zoneAt).toEqual(at(120));
    expect(next.zoneSteps).toBe(0);
  });

  it("credits a monorail leg on arriving at the far station", () => {
    const { next, credits } = advanceTransitState(
      inZone("ttc", t0, { zoneSteps: 80 }),
      "mk",
      at(6 * 60),
      20,
      true,
    );
    expect(credits).toEqual(["monorail_rides"]);
    expect(next.transitKind).toBe("monorail_rides");
    expect(next.transitAt).toEqual(at(6 * 60));
  });

  it("a resort-loop journey credits once: later legs refresh the dedupe window", () => {
    const leg1 = advanceTransitState(inZone("ttc", t0), "polynesian", at(5 * 60), 50, true);
    expect(leg1.credits).toEqual(["monorail_rides"]);
    const leg2 = advanceTransitState(leg1.next, "grand-floridian", at(11 * 60), 60, true);
    expect(leg2.credits).toEqual([]);
    expect(leg2.next.transitAt).toEqual(at(11 * 60)); // window refreshed
    const leg3 = advanceTransitState(leg2.next, "mk", at(17 * 60), 40, true);
    expect(leg3.credits).toEqual([]);
  });

  it("a fresh journey after the dedupe window credits again", () => {
    const prior = inZone("ttc", t0, {
      transitKind: "monorail_rides",
      transitAt: new Date(t0.getTime() - (TRANSIT_DEDUPE_S + 60) * 1000),
    });
    const { credits } = advanceTransitState(prior, "mk", at(5 * 60), 0, true);
    expect(credits).toEqual(["monorail_rides"]);
  });

  it("ferry arrival at the TTC credits the crossing AND the TTC visit", () => {
    const { credits } = advanceTransitState(
      inZone("seven-seas-lagoon", t0),
      "ttc",
      at(5 * 60),
      10,
      true,
    );
    expect(credits).toEqual(["ttc_visits", "ferry_rides"]);
  });

  it("a stale anchor (over MAX_TRANSIT_S) moves the zone without credit", () => {
    const { next, credits } = advanceTransitState(
      inZone("ttc", t0),
      "mk",
      at(MAX_TRANSIT_S + 120),
      0,
      true,
    );
    expect(credits).toEqual([]);
    expect(next.zoneSlug).toBe("mk");
  });

  it("first zone ever seen: no trip, but a TTC entry still counts as a visit", () => {
    const { credits } = advanceTransitState(EMPTY_TRANSIT_STATE, "ttc", t0, 0, true);
    expect(credits).toEqual(["ttc_visits"]);
  });
});
