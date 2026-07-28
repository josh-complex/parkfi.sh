import { describe, expect, it } from "vite-plus/test";

import { QueueState, QueueType, type QueueTypeCode } from "./codes.ts";
import {
  applyVirtualLineStates,
  indexVirtualLineQueues,
  keyFromPlaceId,
  virtualLineJoinKey,
  virtualLineState,
} from "./universal-virtual-line.ts";

import type { NormalizedEntity } from "./normalize.ts";
import type { UniversalQueue } from "./schemas.ts";

function queue(placeId: string, over: Partial<UniversalQueue> = {}): UniversalQueue {
  return { PlaceId: placeId, Name: placeId, IsEnabled: true, IsUnavailable: false, ...over };
}

function entity(
  name: string,
  queueTypes: Array<QueueTypeCode> = [QueueType.RETURN_TIME],
): NormalizedEntity {
  return {
    externalId: name,
    name,
    entityType: "ATTRACTION",
    observedAt: new Date(),
    status: 1,
    queues: queueTypes.map((queueType) => ({
      queueType,
      waitMin: null,
      state: QueueState.LIMITED, // what TP.wiki always gives us for UOR
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
    operatorExternalId: null,
  };
}

describe("virtualLineJoinKey", () => {
  it("survives the registry's inconsistent handling of '&'", () => {
    // The registry drops the ampersand on one ride and spells it on another,
    // against the same catalog — both must land on the ride's real name.
    expect(virtualLineJoinKey("popeye blutos bilge rat barges")).toBe(
      virtualLineJoinKey("Popeye & Bluto's Bilge-Rat Barges®"),
    );
    expect(virtualLineJoinKey("fast and furious - supercharged")).toBe(
      virtualLineJoinKey("Fast & Furious - Supercharged™"),
    );
  });

  it("ignores trademark marks, apostrophes and articles", () => {
    expect(virtualLineJoinKey("the cat in the hat")).toBe(
      virtualLineJoinKey("The Cat in The Hat™"),
    );
    expect(virtualLineJoinKey("kang and kodos twirl n hurl")).toBe(
      virtualLineJoinKey("Kang & Kodos' Twirl 'n' Hurl"),
    );
  });
});

describe("keyFromPlaceId", () => {
  it("maps each venue segment to our park slug", () => {
    expect(keyFromPlaceId("uor.ioa.rides.the_incredible_hulk_coaster")?.parkSlug).toBe(
      "islands-of-adventure",
    );
    expect(keyFromPlaceId("uor.usf.rides.revenge_of_the_mummy")?.parkSlug).toBe(
      "universal-studios-florida",
    );
    // The registry says `ueu` where the public CDN feed says `eu`.
    expect(keyFromPlaceId("uor.ueu.rides.yoshis_adventure")?.parkSlug).toBe("epic-universe");
    expect(keyFromPlaceId("uor.eu.rides.yoshis_adventure")?.parkSlug).toBe("epic-universe");
  });

  it("rejects non-ride and unparseable ids", () => {
    // A stale parade entry and a bare venue id both appear in the live registry.
    expect(keyFromPlaceId("uor.usf.shows.2025.mardi.gras.parade")).toBeNull();
    expect(keyFromPlaceId("uor.eu.snw")).toBeNull();
    expect(keyFromPlaceId("nonsense")).toBeNull();
  });

  it("corrects the registry's own misspellings", () => {
    // Upstream types "cart" for Kart — one of only ~21 enabled queues.
    expect(keyFromPlaceId("uor.ueu.rides.mario_cart_bowsers_challenge")?.key).toBe(
      virtualLineJoinKey("Mario Kart™: Bowser's Challenge"),
    );
    expect(keyFromPlaceId("uor.ueu.rides.hiccups_wing_glider")?.key).toBe(
      virtualLineJoinKey("Hiccup Wing Glider"),
    );
  });
});

describe("virtualLineState", () => {
  it("distinguishes off, paused and available", () => {
    expect(virtualLineState(queue("x", { IsEnabled: false }))).toBe(QueueState.NOT_OFFERED);
    expect(virtualLineState(queue("x", { IsUnavailable: true }))).toBe(QueueState.PAUSED);
    expect(virtualLineState(queue("x"))).toBe(QueueState.AVAILABLE);
  });
});

describe("applyVirtualLineStates", () => {
  const states = indexVirtualLineQueues([
    queue("uor.ioa.rides.the_incredible_hulk_coaster"),
    queue("uor.ioa.rides.flight_of_the_hippogriff", { IsEnabled: false }),
    queue("uor.ioa.rides.jurassic_world_velocicoaster", { IsUnavailable: true }),
    queue("uor.usf.rides.revenge_of_the_mummy"),
  ]);

  it("replaces TP.wiki's constant with the registry's state", () => {
    const hulk = entity("The Incredible Hulk Coaster®");
    const hippogriff = entity("Flight of the Hippogriff™");
    const velocicoaster = entity("Jurassic World VelociCoaster");
    const applied = applyVirtualLineStates(
      [hulk, hippogriff, velocicoaster],
      "islands-of-adventure",
      states,
    );

    expect(applied).toBe(3);
    expect(hulk.queues[0]!.state).toBe(QueueState.AVAILABLE);
    expect(hippogriff.queues[0]!.state).toBe(QueueState.NOT_OFFERED);
    expect(velocicoaster.queues[0]!.state).toBe(QueueState.PAUSED);
  });

  it("scopes states to their own park", () => {
    // Same registry, wrong park: the USF mummy must not match in IOA.
    const mummy = entity("Revenge of the Mummy™");
    expect(applyVirtualLineStates([mummy], "islands-of-adventure", states)).toBe(0);
    expect(mummy.queues[0]!.state).toBe(QueueState.LIMITED);
    expect(applyVirtualLineStates([mummy], "universal-studios-florida", states)).toBe(1);
    expect(mummy.queues[0]!.state).toBe(QueueState.AVAILABLE);
  });

  it("never invents a RETURN_TIME queue TP.wiki did not report", () => {
    // Synthesising one would write an `attraction_queue_support` row and make
    // the board advertise a Virtual Line the ride does not run.
    const standbyOnly = entity("The Incredible Hulk Coaster®", [QueueType.STANDBY]);
    expect(applyVirtualLineStates([standbyOnly], "islands-of-adventure", states)).toBe(0);
    expect(standbyOnly.queues).toHaveLength(1);
    expect(standbyOnly.queues[0]!.queueType).toBe(QueueType.STANDBY);
  });

  it("leaves unmatched rides on the upstream value", () => {
    const other = entity("Pteranodon Flyers™");
    expect(applyVirtualLineStates([other], "islands-of-adventure", states)).toBe(0);
    expect(other.queues[0]!.state).toBe(QueueState.LIMITED);
  });

  it("is a no-op for a park with no registry entries", () => {
    const ride = entity("The Incredible Hulk Coaster®");
    expect(applyVirtualLineStates([ride], "volcano-bay", states)).toBe(0);
  });
});
