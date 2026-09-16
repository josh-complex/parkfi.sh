import { describe, expect, it } from "vite-plus/test";

import { busiestRides, parkStats, shortRideName } from "./park-stats.ts";
import type { BoardItem } from "./types.ts";

const ride = (over: Partial<BoardItem> = {}): BoardItem =>
  ({
    id: 1,
    name: "A Ride",
    slug: "a-ride",
    entityType: "ATTRACTION",
    status: "OPERATING",
    standbyWait: 20,
    category: "thrill",
    meta: null,
    ...over,
  }) as BoardItem;

describe("parkStats", () => {
  it("drops single-rider rows and un-enriched ghosts from every tally", () => {
    const stats = parkStats([
      ride({ id: 1, name: "VelociCoaster", standbyWait: 60 }),
      // Universal posts the single-rider line as its own row, with no waits and
      // no category — counting it would inflate the denominator.
      ride({ id: 2, name: "VelociCoaster Single Rider", category: null, standbyWait: null }),
      // A duplicate record that never got enriched.
      ride({ id: 3, name: "VelociCoaster", category: null, standbyWait: 60 }),
      ride({ id: 4, name: "Hagrid's", standbyWait: 40 }),
    ]);
    expect(stats.rides.map((r) => r.id)).toEqual([1, 4]);
    expect(stats.avgWait).toBe(50);
  });

  it("averages only rides that are running and posting", () => {
    const stats = parkStats([
      ride({ id: 1, standbyWait: 30 }),
      ride({ id: 2, status: "DOWN", standbyWait: 90 }),
      ride({ id: 3, standbyWait: null }),
    ]);
    expect(stats.avgWait).toBe(30);
    expect(stats.issues.map((r) => r.id)).toEqual([2]);
    expect(stats.busiest.map((r) => r.id)).toEqual([1]);
  });

  it("reports no average rather than zero when nothing posts a wait", () => {
    const stats = parkStats([ride({ standbyWait: null })]);
    expect(stats.avgWait).toBeNull();
  });

  it("flags a park the board has collapsed to closed", () => {
    expect(parkStats([ride({ status: "CLOSED", standbyWait: null })]).closed).toBe(true);
    expect(parkStats([]).closed).toBe(false);
  });
});

describe("busiestRides", () => {
  const house = (id: number, wait: number) =>
    ride({
      id,
      name: `House ${id}`,
      standbyWait: wait,
      // Only the tag matters here; the rest of the meta block is enrichment the
      // haunted-house test doesn't read.
      meta: { tags: ["Haunted House"] } as BoardItem["meta"],
    });

  it("holds haunted houses back while ordinary rides are running", () => {
    const stats = parkStats([house(1, 90), ride({ id: 2, standbyWait: 30 })]);
    expect(busiestRides(stats, 6).map((r) => r.id)).toEqual([2]);
  });

  it("falls back to the houses on an event night, when they are all there is", () => {
    const stats = parkStats([house(1, 90), house(2, 45)]);
    expect(busiestRides(stats, 6).map((r) => r.id)).toEqual([1, 2]);
  });
});

describe("shortRideName", () => {
  it("keeps a name that already fits", () => {
    expect(shortRideName("VelociCoaster")).toBe("VelociCoaster");
  });

  it("prefers the possessive to a blind truncation", () => {
    expect(shortRideName("Hagrid's Magical Creatures Motorbike Adventure")).toBe("Hagrid's");
  });

  it("cuts the marketing tail first", () => {
    expect(shortRideName("Star Tours – The Adventures Continue")).toBe("Star Tours");
    expect(shortRideName("VelociCoaster™")).toBe("VelociCoaster");
  });

  it("truncates on a word boundary when there is nothing better", () => {
    expect(shortRideName("The Amazing Adventures of Spider-Man")).toBe("The Amazing…");
  });

  it("doesn't leave a dangling connector on the cut", () => {
    expect(shortRideName("TRON Lightcycle / Run")).toBe("TRON Lightcycle…");
  });
});
