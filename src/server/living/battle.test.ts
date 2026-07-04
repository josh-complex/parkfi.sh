import { describe, expect, it } from "vite-plus/test";

import { HeartlessType } from "./codes.ts";
import { fieldParty, heartlessSpec, partyCapacity, type CompanionInput } from "./battle.ts";

describe("heartlessSpec", () => {
  it("returns the named spec for a known Heartless type", () => {
    const s = heartlessSpec(HeartlessType.BREAKER, 1);
    expect(s.name).toBe("Breaker");
    expect(s.hp).toBeGreaterThan(0);
    expect(s.atk).toBeGreaterThan(0);
  });

  it("scales hp and atk up with rarity", () => {
    const r1 = heartlessSpec(HeartlessType.BREAKER, 1);
    const r3 = heartlessSpec(HeartlessType.BREAKER, 3);
    expect(r3.hp).toBeGreaterThan(r1.hp);
    expect(r3.atk).toBeGreaterThan(r1.atk);
  });

  it("clamps rarity below 1 to the base spec", () => {
    const r0 = heartlessSpec(HeartlessType.SHADE, 0);
    const r1 = heartlessSpec(HeartlessType.SHADE, 1);
    expect(r0.hp).toBe(r1.hp);
  });

  it("is deterministic", () => {
    expect(heartlessSpec(HeartlessType.WISP, 2)).toEqual(heartlessSpec(HeartlessType.WISP, 2));
  });
});

describe("partyCapacity", () => {
  it("gates slots by rank band (1 Dreamer, 2 Apprentice, 3 Guardian)", () => {
    expect(partyCapacity(1)).toBe(1);
    expect(partyCapacity(4)).toBe(1);
    expect(partyCapacity(5)).toBe(2);
    expect(partyCapacity(14)).toBe(2);
    expect(partyCapacity(15)).toBe(3);
    expect(partyCapacity(30)).toBe(3);
  });
});

describe("fieldParty", () => {
  const mk = (over: Partial<CompanionInput>): CompanionInput => ({
    id: 1,
    name: "Ally",
    element: null,
    role: "attacker",
    level: 1,
    baseStats: { hp: 24, atk: 8 },
    homeWorldId: 10,
    homeParkId: 100,
    ...over,
  });

  it("amplifies the ally action at a breach in the companion's home World", () => {
    const [home] = fieldParty([mk({ homeWorldId: 10 })], 10, 100, 1);
    const [guest] = fieldParty([mk({ homeWorldId: 10 })], 20, 100, 1);
    expect(home.tier).toBe("home");
    expect(guest.tier).toBe("guest");
    expect(home.action).toBe(12); // 8 * 1.5
    expect(guest.action).toBe(8); // 8 * 1.0
  });

  it("benches companions from another park (away)", () => {
    const party = fieldParty([mk({ homeParkId: 999, homeWorldId: 77 })], 10, 100, 3);
    expect(party).toHaveLength(0);
  });

  it("maps role to the ally-action kind", () => {
    const [atk] = fieldParty([mk({ role: "attacker" })], 10, 100, 1);
    const [sup] = fieldParty([mk({ role: "support", baseStats: { atk: 6 } })], 10, 100, 1);
    expect(atk.kind).toBe("attack");
    expect(sup.kind).toBe("heal");
  });

  it("caps the party at the rank's capacity, home-first then by action", () => {
    const roster = [
      mk({ id: 1, name: "GuestWeak", homeWorldId: 20, baseStats: { atk: 4 } }),
      mk({ id: 2, name: "HomeStrong", homeWorldId: 10, baseStats: { atk: 9 } }),
      mk({ id: 3, name: "GuestStrong", homeWorldId: 30, baseStats: { atk: 8 } }),
    ];
    const rank1 = fieldParty(roster, 10, 100, 1);
    expect(rank1.map((c) => c.name)).toEqual(["HomeStrong"]);
    const rank5 = fieldParty(roster, 10, 100, 5);
    expect(rank5.map((c) => c.name)).toEqual(["HomeStrong", "GuestStrong"]);
  });

  it("is a no-op for an empty roster (solo balance preserved)", () => {
    expect(fieldParty([], 10, 100, 3)).toEqual([]);
  });
});
