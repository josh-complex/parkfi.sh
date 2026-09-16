import { describe, expect, it } from "vite-plus/test";

import {
  averageWait,
  buildPicks,
  buildProfileLookups,
  formatLaterWindow,
  parkPulses,
  splitMovers,
  type Mover,
  type Ride,
} from "./waits-data.ts";

/** 3:10 PM Eastern on a Monday — the hour every "since" label is read against. */
const NOW = Date.parse("2026-09-14T19:10:00Z");

let nextId = 1;
function ride(over: Partial<Ride> = {}): Ride {
  return {
    id: nextId++,
    name: "A Ride",
    slug: "a-ride",
    category: "attraction",
    status: "OPERATING",
    standbyWait: 30,
    latitude: null,
    longitude: null,
    parkSlug: "magic-kingdom",
    parkName: "Magic Kingdom Park",
    // Null by default — "the schedule feed says nothing about this park", which
    // is the case that falls back to the ride count. Tests that care about the
    // calendar set it explicitly.
    parkOpen: null,
    parkTimezone: "America/New_York",
    closeHour: 22,
    operatorSlug: "wdw",
    operatorName: "Walt Disney World",
    land: "Fantasyland",
    heightRequirement: null,
    minHeightIn: null,
    expressPass: null,
    singleRider: null,
    childSwap: null,
    imageThumbUrl: null,
    imageCardUrl: null,
    imageHeroUrl: null,
    imageAlt: null,
    imageThumbhash: null,
    hauntedHouse: false,
    showtimes: [],
    ...over,
  };
}

function mover(over: Partial<Mover> = {}): Mover {
  const waitMin = over.waitMin ?? 20;
  const prevWait = over.prevWait ?? 40;
  return {
    rideId: 0,
    rideName: "A Ride",
    rideSlug: "a-ride",
    parkSlug: "magic-kingdom",
    parkName: "Magic Kingdom Park",
    waitMin,
    prevWait,
    delta: waitMin - prevWait,
    ...over,
  };
}

describe("averageWait", () => {
  it("averages only rides that are open and actually posting a number", () => {
    expect(
      averageWait([
        ride({ standbyWait: 10 }),
        ride({ standbyWait: 30 }),
        // Posts nothing (a character meet), so it can't drag the mean down.
        ride({ standbyWait: null }),
        // Closed, so its last number isn't today's news.
        ride({ standbyWait: 90, status: "CLOSED" }),
      ]),
    ).toBe(20);
  });

  it("is null rather than zero when nothing is posting", () => {
    expect(averageWait([ride({ status: "CLOSED", standbyWait: null })])).toBeNull();
  });
});

describe("parkPulses", () => {
  it("keeps hard-ticket houses out of the average but counts them as attractions", () => {
    const [mk] = parkPulses([
      ride({ standbyWait: 20 }),
      ride({ standbyWait: 20 }),
      // An HHN house posting 120 on an event night would otherwise triple the
      // park's headline number.
      ride({ standbyWait: 120, hauntedHouse: true }),
    ]);
    expect(mk?.avg).toBe(20);
    expect(mk?.total).toBe(3);
    expect(mk?.open).toBe(3);
  });

  it("falls back to the ride count when the schedule feed says nothing", () => {
    const [mk] = parkPulses([ride({ status: "CLOSED", standbyWait: null })]);
    expect(mk?.closed).toBe(true);
    expect(mk?.avg).toBeNull();
  });

  it("keeps a park open on its event hours before any queue posts a wait", () => {
    // Horror Nights the moment the gates open, or a Magic Kingdom party
    // evening: the calendar says open, nothing is posting yet.
    const [usf] = parkPulses([
      ride({ parkSlug: "universal-studios-florida", status: "CLOSED", parkOpen: true }),
    ]);
    expect(usf?.closed).toBe(false);
    expect(usf?.open).toBe(0);
    expect(usf?.avg).toBeNull();
  });

  it("keeps a park open on an event night its houses are the only thing running", () => {
    const [usf] = parkPulses([
      ride({ parkSlug: "universal-studios-florida", status: "CLOSED", parkOpen: true }),
      ride({
        parkSlug: "universal-studios-florida",
        standbyWait: 90,
        hauntedHouse: true,
        parkOpen: true,
      }),
    ]);
    expect(usf?.closed).toBe(false);
    expect(usf?.open).toBe(1);
    // Houses stay out of the headline average, so an event night has none.
    expect(usf?.avg).toBeNull();
  });

  it("closes a park the calendar has shut, however the stale feed reads", () => {
    // The overnight feed keeps re-posting waits for hours after close; the
    // calendar is the only thing that knows better.
    const [mk] = parkPulses([ride({ standbyWait: 25, parkOpen: false })]);
    expect(mk?.closed).toBe(true);
  });

  it("runs the resorts' order and pushes the water parks to the tail", () => {
    const slugs = parkPulses([
      ride({ parkSlug: "blizzard-beach", parkName: "Disney's Blizzard Beach Water Park" }),
      ride({ parkSlug: "epcot", parkName: "EPCOT" }),
      ride({ parkSlug: "magic-kingdom", parkName: "Magic Kingdom Park" }),
      ride({ parkSlug: "epic-universe", parkName: "Universal Epic Universe" }),
    ]).map((p) => p.slug);
    expect(slugs).toEqual(["magic-kingdom", "epcot", "epic-universe", "blizzard-beach"]);
  });

  it("attaches each park's hour-over-hour delta and leaves the rest null", () => {
    const [mk] = parkPulses(
      [ride()],
      [{ parkSlug: "magic-kingdom", avgNow: 30, avgPrev: 36, rides: 12, delta: -6 }],
    );
    expect(mk?.delta).toBe(-6);
    expect(parkPulses([ride()])[0]?.delta).toBeNull();
  });
});

describe("buildPicks", () => {
  it("fires one pick per rule, in priority order, never the same ride twice", () => {
    const walkOn = ride({ name: "Walk On", standbyWait: 5 });
    const dropped = ride({ name: "Dropped", standbyWait: 25 });
    const show = ride({
      name: "A Show",
      standbyWait: null,
      showtimes: [{ type: "Performance Time", start: "2026-09-14T19:30:00Z", end: null }],
    });
    const picks = buildPicks({
      rides: [walkOn, dropped, show],
      movers: [
        mover({ rideId: dropped.id, waitMin: 25, prevWait: 55 }),
        // The walk-on also dropped, but rule 1 already spent it.
        mover({ rideId: walkOn.id, waitMin: 5, prevWait: 60 }),
      ],
      nowMs: NOW,
    });
    expect(picks.map((p) => p.rule)).toEqual(["walk-on", "biggest-drop", "starting-soon"]);
    expect(picks.map((p) => p.ride.name)).toEqual(["Walk On", "Dropped", "A Show"]);
  });

  it("prints the drop's size and the hour it is measured from, park-local", () => {
    const r = ride({ standbyWait: 25 });
    const [pick] = buildPicks({
      rides: [r],
      movers: [mover({ rideId: r.id, waitMin: 25, prevWait: 55 })],
      nowMs: NOW,
    });
    // 3:10 PM Eastern, less the 30-minute comparison window → the 2 PM hour.
    expect(pick?.reason).toBe("dropped 30 min since 2 PM");
  });

  it("skips rule 3 entirely when the profiles rollup isn't there", () => {
    const r = ride({ standbyWait: 25 });
    const rules = buildPicks({ rides: [r], movers: [], nowMs: NOW }).map((p) => p.rule);
    expect(rules).not.toContain("below-usual");
  });

  it("fires rule 3 once profiles exist, and says what the usual is", () => {
    const r = ride({ name: "Below Usual", standbyWait: 25 });
    const [pick] = buildPicks({
      rides: [r],
      movers: [],
      usualByRide: new Map([[r.id, 60]]),
      nowMs: NOW,
    });
    expect(pick?.rule).toBe("below-usual");
    expect(pick?.reason).toBe("35 under its usual for 3 PM");
  });

  it("ignores a show that isn't starting soon", () => {
    const show = ride({
      standbyWait: null,
      showtimes: [{ type: null, start: "2026-09-14T23:00:00Z", end: null }],
    });
    expect(buildPicks({ rides: [show], movers: [], nowMs: NOW })).toEqual([]);
  });

  it("backfills with each rule's runner-ups, round-robin, capped at five", () => {
    const walkOns = [3, 5, 7, 9].map((w) => ride({ name: `Walk On ${w}`, standbyWait: w }));
    const dropped = [
      ride({ name: "Drop A", standbyWait: 40 }),
      ride({ name: "Drop B", standbyWait: 50 }),
    ];
    const picks = buildPicks({
      rides: [...walkOns, ...dropped],
      movers: [
        mover({ rideId: dropped[0]!.id, waitMin: 40, prevWait: 90 }),
        mover({ rideId: dropped[1]!.id, waitMin: 50, prevWait: 80 }),
      ],
      nowMs: NOW,
    });
    // Pass 1 is one per rule; the passes after it take each rule's next-best.
    expect(picks.map((p) => p.ride.name)).toEqual([
      "Walk On 3",
      "Drop A",
      "Walk On 5",
      "Drop B",
      "Walk On 7",
    ]);
  });

  it("ranks a walk-on by what it saves, not by how short it is", () => {
    const stroll = ride({ name: "Walkthrough", standbyWait: 0 });
    const headliner = ride({ name: "Headliner", standbyWait: 10 });
    const picks = buildPicks({
      rides: [stroll, headliner],
      movers: [],
      // The walkthrough never has a queue; the headliner normally runs an hour.
      usualByRide: new Map([
        [stroll.id, 5],
        [headliner.id, 55],
      ]),
      nowMs: NOW,
    });
    expect(picks[0]?.rule).toBe("walk-on");
    expect(picks[0]?.ride.name).toBe("Headliner");
    // The walkthrough is demoted, not dropped — it still fills a later slot.
    expect(picks.map((p) => p.ride.name)).toContain("Walkthrough");
  });

  it("falls back to the shortest wait when no ride has a profile", () => {
    const picks = buildPicks({
      rides: [ride({ name: "Longer", standbyWait: 10 }), ride({ name: "Shorter", standbyWait: 5 })],
      movers: [],
      nowMs: NOW,
    });
    expect(picks.map((p) => p.ride.name)).toEqual(["Shorter", "Longer"]);
  });

  it("leaves water-park attractions out until a water park is asked for", () => {
    const slide = ride({ name: "Body Slide", standbyWait: 5, parkSlug: "typhoon-lagoon" });
    const coaster = ride({ name: "Coaster", standbyWait: 8 });
    const rides = [slide, coaster];

    const anyPark = buildPicks({ rides, movers: [], nowMs: NOW });
    expect(anyPark.map((p) => p.ride.name)).toEqual(["Coaster"]);

    const selected = buildPicks({
      rides,
      movers: [],
      selectedParks: new Set(["typhoon-lagoon"]),
      nowMs: NOW,
    });
    expect(selected.map((p) => p.ride.name)).toContain("Body Slide");
  });

  it("never picks a closed ride or an event-night house", () => {
    const picks = buildPicks({
      rides: [
        ride({ standbyWait: 5, status: "DOWN" }),
        ride({ standbyWait: 5, hauntedHouse: true }),
      ],
      movers: [],
      nowMs: NOW,
    });
    expect(picks).toEqual([]);
  });
});

describe("splitMovers", () => {
  it("splits by direction, biggest swing first, and floors out feed noise", () => {
    const rows = [
      mover({ rideId: 1, waitMin: 10, prevWait: 40 }),
      mover({ rideId: 2, waitMin: 30, prevWait: 40 }),
      // ±1 min is one tick of rounding, not news.
      mover({ rideId: 3, waitMin: 21, prevWait: 20 }),
      mover({ rideId: 4, waitMin: 60, prevWait: 30 }),
    ];
    const { dropping, climbing } = splitMovers(rows, new Map());
    expect(dropping.map((m) => m.rideId)).toEqual([1, 2]);
    expect(climbing.map((m) => m.rideId)).toEqual([4]);
  });
});

describe("formatLaterWindow", () => {
  it("only speaks up when the later window is meaningfully better", () => {
    expect(formatLaterWindow(60, { waitMin: 20, at: "8 PM" })).toBe("20 min at 8 PM");
    // 5 minutes off an hour's queue isn't worth planning a day around.
    expect(formatLaterWindow(60, { waitMin: 55, at: "8 PM" })).toBeNull();
    expect(formatLaterWindow(null, { waitMin: 20, at: "8 PM" })).toBeNull();
    expect(formatLaterWindow(60, null)).toBeNull();
  });
});

describe("buildProfileLookups", () => {
  it("reads this hour as the usual and the best hour still to come as later", () => {
    const r = ride();
    const { usualByRide, laterById } = buildProfileLookups({
      rides: [r],
      // NOW is 3 PM Eastern, so 15 is "this hour" and 11 is already gone.
      profiles: [
        { rideId: r.id, hour: 11, usual: 5 },
        { rideId: r.id, hour: 15, usual: 60 },
        { rideId: r.id, hour: 19, usual: 40 },
        { rideId: r.id, hour: 20, usual: 25 },
      ],
      nowMs: NOW,
    });
    expect(usualByRide.get(r.id)).toBe(60);
    expect(laterById.get(r.id)).toEqual({ waitMin: 25, at: "8 PM" });
  });

  it("has no later window once the good hours are behind you", () => {
    const r = ride();
    const { laterById } = buildProfileLookups({
      rides: [r],
      profiles: [{ rideId: r.id, hour: 9, usual: 5 }],
      nowMs: NOW,
    });
    expect(laterById.has(r.id)).toBe(false);
  });

  it("will not point past today's close", () => {
    // Epic Universe, 1 Sep 2026: the profile still carries an 8 PM row built
    // from August's 9 PM closes, but the park now shuts at 8.
    const r = ride({ closeHour: 20 });
    const { laterById } = buildProfileLookups({
      rides: [r],
      profiles: [
        { rideId: r.id, hour: 19, usual: 63 },
        { rideId: r.id, hour: 20, usual: 31 },
      ],
      nowMs: NOW,
    });
    expect(laterById.get(r.id)).toEqual({ waitMin: 63, at: "7 PM" });
  });

  it("has no later window when every remaining hour is past close", () => {
    const r = ride({ closeHour: 18 });
    const { laterById } = buildProfileLookups({
      rides: [r],
      profiles: [
        { rideId: r.id, hour: 20, usual: 25 },
        { rideId: r.id, hour: 21, usual: 15 },
      ],
      nowMs: NOW,
    });
    expect(laterById.has(r.id)).toBe(false);
  });

  it("falls back to unbounded when today has no operating window", () => {
    const r = ride({ closeHour: null });
    const { laterById } = buildProfileLookups({
      rides: [r],
      profiles: [{ rideId: r.id, hour: 20, usual: 25 }],
      nowMs: NOW,
    });
    expect(laterById.get(r.id)).toEqual({ waitMin: 25, at: "8 PM" });
  });

  it("ignores profile rows for rides that aren't on the board", () => {
    const { usualByRide } = buildProfileLookups({
      rides: [],
      profiles: [{ rideId: 999, hour: 15, usual: 60 }],
      nowMs: NOW,
    });
    expect(usualByRide.size).toBe(0);
  });

  it("is empty, not broken, before the rollup exists", () => {
    const { usualByRide, laterById } = buildProfileLookups({
      rides: [ride()],
      profiles: [],
      nowMs: NOW,
    });
    expect(usualByRide.size).toBe(0);
    expect(laterById.size).toBe(0);
  });
});
