import { describe, expect, it } from "vite-plus/test";

import { QueueType, type QueueTypeCode } from "./codes.ts";
import {
  applyUniversalWaits,
  indexUniversalWaits,
  universalResortForPark,
  waitMinutes,
  waitRow,
} from "./universal-cdn-waits.ts";

import type { NormalizedEntity } from "./normalize.ts";
import type { UniversalWaitAttraction } from "./schemas.ts";

type Queue = UniversalWaitAttraction["queues"][number];

function attraction(
  placeId: string,
  name: string,
  queues: Array<Partial<Queue> & { queue_type: string }>,
): UniversalWaitAttraction {
  return {
    wait_time_attraction_id: placeId,
    venue_id: `uor.${placeId.split(".")[1]}`,
    name,
    queues: queues.map((q) => ({ queue_id: `${placeId}_${q.queue_type.toLowerCase()}`, ...q })),
  };
}

function entity(
  name: string,
  operatorExternalId: string | null,
  queueTypes: Array<QueueTypeCode> = [QueueType.STANDBY],
): NormalizedEntity {
  return {
    externalId: `tp-${name}`,
    name,
    entityType: "ATTRACTION",
    observedAt: new Date(),
    status: 1,
    queues: queueTypes.map((queueType) => ({
      queueType,
      waitMin:
        queueType === QueueType.STANDBY ? 20 : queueType === QueueType.PAID_STANDBY ? 5 : null,
      state: null,
      priceCents: null,
      currency: null,
      returnStart: null,
      returnEnd: null,
      boardingGroup: null,
      boardingGroupEnd: null,
      boardingAllocation: null,
    })),
    showtimes: [],
    hoursToday: [],
    diningWaits: [],
    operatorExternalId,
  };
}

const wait = (e: NormalizedEntity, type: QueueTypeCode) =>
  e.queues.find((q) => q.queueType === type)?.waitMin;
const types = (e: NormalizedEntity) => e.queues.map((q) => q.queueType).sort((a, b) => a - b);

describe("waitMinutes", () => {
  it("reads the 995 sentinel as 'nothing posted'", () => {
    // Every closed single-rider queue carried it on 2026-09-03.
    expect(waitMinutes(995)).toBeNull();
    expect(waitMinutes(900)).toBeNull();
    expect(waitMinutes(null)).toBeNull();
    expect(waitMinutes(undefined)).toBeNull();
    expect(waitMinutes(-1)).toBeNull();
  });

  it("keeps real waits, including zero", () => {
    expect(waitMinutes(0)).toBe(0);
    expect(waitMinutes(5)).toBe(5);
    expect(waitMinutes(240)).toBe(240);
  });
});

describe("universalResortForPark", () => {
  it("maps the Orlando parks and nothing else", () => {
    expect(universalResortForPark("islands-of-adventure")).toBe("uor");
    expect(universalResortForPark("epic-universe")).toBe("uor");
    expect(universalResortForPark("volcano-bay")).toBe("uor");
    expect(universalResortForPark("magic-kingdom")).toBeNull();
  });
});

describe("waitRow", () => {
  it("honours the single-rider line's own status", () => {
    const open = waitRow(
      attraction("uor.ioa.rides.the_incredible_hulk_coaster", "The Incredible Hulk Coaster®", [
        { queue_type: "STANDBY", status: "OPEN", display_wait_time: 5 },
        { queue_type: "SINGLE", status: "OPEN", display_wait_time: 10 },
      ]),
    );
    expect(open).toMatchObject({
      parkSlug: "islands-of-adventure",
      hasSingle: true,
      singleWait: 10,
    });
    const full = waitRow(
      attraction("uor.ueu.rides.mine-cart_madness", "Mine-Cart Madness™", [
        { queue_type: "STANDBY", status: "OPEN", display_wait_time: 60 },
        { queue_type: "SINGLE", status: "AT_CAPACITY", display_wait_time: 0 },
      ]),
    );
    expect(full?.hasSingle).toBe(true);
    expect(full?.singleWait).toBeNull();
  });

  it("nulls the single-rider sentinel on an open line", () => {
    const row = waitRow(
      attraction("uor.ioa.rides.doctor_dooms_fearfall", "Doctor Doom's Fearfall®", [
        { queue_type: "STANDBY", status: "OPEN", display_wait_time: 10 },
        { queue_type: "SINGLE", status: "OPEN", display_wait_time: 995 },
      ]),
    );
    expect(row?.hasSingle).toBe(true);
    expect(row?.singleWait).toBeNull();
  });

  it("ignores the EXPRESS queue entirely", () => {
    // Live 2026-09-03: EXPRESS carried `CLOSED` on all 30 rides at all times,
    // no ops-system id, and a value that never moved all day — a placard, not
    // a wait. Nothing about it is published.
    const row = waitRow(
      attraction("uor.ioa.rides.jurassic_world_velocicoaster", "Jurassic World VelociCoaster", [
        { queue_type: "STANDBY", status: "OPEN", display_wait_time: 45 },
        { queue_type: "EXPRESS", status: "CLOSED", display_wait_time: 20 },
      ]),
    );
    expect(row).toEqual({
      placeId: "uor.ioa.rides.jurassic_world_velocicoaster",
      parkSlug: "islands-of-adventure",
      nameKey: expect.any(String),
      hasSingle: false,
      singleWait: null,
    });
  });

  it("places Epic Universe under either venue spelling", () => {
    // Attraction ids say `ueu`; the feed's own venue_id says `uor.eu`.
    expect(
      waitRow(attraction("uor.ueu.rides.stardust_racers", "Stardust Racers", []))?.parkSlug,
    ).toBe("epic-universe");
    expect(
      waitRow(attraction("uor.eu.rides.stardust_racers", "Stardust Racers", []))?.parkSlug,
    ).toBe("epic-universe");
    expect(waitRow(attraction("uor.citywalk.x", "x", []))).toBeNull();
  });
});

describe("applyUniversalWaits", () => {
  const index = indexUniversalWaits([
    attraction("uor.ioa.rides.the_incredible_hulk_coaster", "The Incredible Hulk Coaster®", [
      { queue_type: "STANDBY", status: "OPEN", display_wait_time: 5 },
      { queue_type: "EXPRESS", status: "CLOSED", display_wait_time: 10 },
      { queue_type: "SINGLE", status: "OPEN", display_wait_time: 10 },
    ]),
    attraction(
      "uor.ioa.rides.harry_potter_and_the_forbidden_journey!",
      "Harry Potter and the Forbidden Journey™",
      [
        { queue_type: "STANDBY", status: "OPEN", display_wait_time: 10 },
        { queue_type: "EXPRESS", status: "CLOSED", display_wait_time: 995 },
        { queue_type: "SINGLE", status: "OPEN", display_wait_time: 995 },
      ],
    ),
    attraction("uor.ioa.rides.caro-seuss-el", "Caro-Seuss-el™", [
      { queue_type: "STANDBY", status: "OPEN", display_wait_time: 5 },
    ]),
    attraction("uor.ioa.rides.jurassic_world_velocicoaster", "Jurassic World VelociCoaster", [
      { queue_type: "STANDBY", status: "OPEN", display_wait_time: 45 },
      { queue_type: "EXPRESS", status: "CLOSED", display_wait_time: 20 },
    ]),
    attraction("uor.usf.rides.revenge_of_the_mummy", "Revenge of the Mummy™", [
      { queue_type: "STANDBY", status: "OPEN", display_wait_time: 25 },
      { queue_type: "SINGLE", status: "OPEN", display_wait_time: 5 },
    ]),
  ]);

  it("joins on the operator place id and adds the single-rider queue TP.wiki lacked", () => {
    const hulk = entity(
      "The Incredible Hulk Coaster®",
      "uor.ioa.rides.the_incredible_hulk_coaster",
    );
    expect(applyUniversalWaits([hulk], "islands-of-adventure", index)).toBe(1);
    expect(types(hulk)).toEqual([QueueType.STANDBY, QueueType.SINGLE_RIDER].sort((a, b) => a - b));
    expect(wait(hulk, QueueType.STANDBY)).toBe(20); // TP.wiki's standby untouched
    expect(wait(hulk, QueueType.SINGLE_RIDER)).toBe(10);
  });

  it("never adds an Express queue, even where the feed has one", () => {
    const veloci = entity(
      "Jurassic World VelociCoaster",
      "uor.ioa.rides.jurassic_world_velocicoaster",
    );
    expect(applyUniversalWaits([veloci], "islands-of-adventure", index)).toBe(0);
    expect(types(veloci)).toEqual([QueueType.STANDBY]);
  });

  it("strips a PAID_STANDBY queue TP.wiki reported for a Universal ride", () => {
    // TP.wiki sources UOR from this same feed, so its PAID_STANDBY is the same
    // placard number — it goes too, whether or not the feed knows the ride.
    const veloci = entity(
      "Jurassic World VelociCoaster",
      "uor.ioa.rides.jurassic_world_velocicoaster",
      [QueueType.STANDBY, QueueType.PAID_STANDBY],
    );
    const unknown = entity("Pteranodon Flyers™", "uor.ioa.rides.pteranodon_flyers", [
      QueueType.STANDBY,
      QueueType.PAID_STANDBY,
    ]);
    expect(applyUniversalWaits([veloci, unknown], "islands-of-adventure", index)).toBe(0);
    expect(types(veloci)).toEqual([QueueType.STANDBY]);
    expect(types(unknown)).toEqual([QueueType.STANDBY]);
  });

  it("overwrites a queue TP.wiki did report with the operator's value", () => {
    // TP.wiki lists SINGLE_RIDER for a couple of rides with a null wait.
    const hulk = entity(
      "The Incredible Hulk Coaster®",
      "uor.ioa.rides.the_incredible_hulk_coaster",
      [QueueType.STANDBY, QueueType.SINGLE_RIDER],
    );
    applyUniversalWaits([hulk], "islands-of-adventure", index);
    expect(hulk.queues).toHaveLength(2);
    expect(wait(hulk, QueueType.SINGLE_RIDER)).toBe(10);
  });

  it("falls back to the normalized name when the two sides spell a slug differently", () => {
    // TP.wiki: `…journey_`; the CDN: `…journey!`.
    const fj = entity(
      "Harry Potter and the Forbidden Journey™",
      "uor.ioa.rides.harry_potter_and_the_forbidden_journey_",
    );
    expect(applyUniversalWaits([fj], "islands-of-adventure", index)).toBe(1);
    expect(fj.queues.some((q) => q.queueType === QueueType.SINGLE_RIDER)).toBe(true);
    expect(wait(fj, QueueType.SINGLE_RIDER)).toBeNull(); // sentinel → nothing posted
  });

  it("adds nothing for a ride with no single-rider line", () => {
    const carousel = entity("Caro-Seuss-el™", "uor.ioa.rides.caro-seuss-el");
    expect(applyUniversalWaits([carousel], "islands-of-adventure", index)).toBe(0);
    expect(carousel.queues).toHaveLength(1);
  });

  it("scopes matches to the park being ingested", () => {
    const mummy = entity("Revenge of the Mummy™", "uor.usf.rides.revenge_of_the_mummy");
    expect(applyUniversalWaits([mummy], "islands-of-adventure", index)).toBe(0);
    expect(mummy.queues).toHaveLength(1);
    expect(applyUniversalWaits([mummy], "universal-studios-florida", index)).toBe(1);
    expect(wait(mummy, QueueType.SINGLE_RIDER)).toBe(5);
  });

  it("leaves rides the feed does not know untouched", () => {
    const other = entity("Pteranodon Flyers™", "uor.ioa.rides.pteranodon_flyers");
    expect(applyUniversalWaits([other], "islands-of-adventure", index)).toBe(0);
    expect(other.queues).toHaveLength(1);
  });
});
