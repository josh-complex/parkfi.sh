import { describe, expect, it } from "vite-plus/test";

import { decideStayAlert, StayAlertMode, type StayAlertRow } from "./stayAlerts.ts";

const NOW = 1_700_000_000_000;
const COOLDOWN = 30 * 60_000;

function row(overrides: Partial<StayAlertRow>): StayAlertRow {
  return {
    id: 1,
    userId: "u1",
    resortId: "", // any resort
    scope: "", // any resort
    mode: StayAlertMode.BECOMES_AVAILABLE,
    priceBelow: null,
    armed: true,
    lastFiredAt: null,
    lastAvailable: null,
    lastPrice: null,
    checkIn: "2026-07-04",
    checkOut: "2026-07-06",
    available: null,
    price: null,
    cheapestResortId: null,
    ...overrides,
  };
}

describe("decideStayAlert — becomes_available", () => {
  it("fires when a room opens while armed and cooled", () => {
    const d = decideStayAlert(row({ available: true, price: 350 }), NOW, COOLDOWN);
    expect(d.fire).toBe(true);
    expect(d.set.armed).toBe(false);
    expect(d.set.lastFiredAt).toEqual(new Date(NOW));
  });

  it("does not fire when nothing is available, and re-arms", () => {
    const d = decideStayAlert(row({ available: false, armed: false }), NOW, COOLDOWN);
    expect(d.fire).toBe(false);
    expect(d.set.armed).toBe(true);
  });

  // The core "one email, not a flood" guarantee: a room that stays available for
  // hours fires exactly once — disarmed + cooled fires never re-trigger.
  it("does not re-fire while still available but already disarmed", () => {
    const d = decideStayAlert(
      row({ available: true, armed: false, lastFiredAt: new Date(NOW - 60_000) }),
      NOW,
      COOLDOWN,
    );
    expect(d.fire).toBe(false);
    expect(d.set.armed).toBeUndefined(); // stays disarmed (still met)
  });

  it("is suppressed by cooldown even when armed and matched", () => {
    const d = decideStayAlert(
      row({ available: true, armed: true, lastFiredAt: new Date(NOW - 5 * 60_000) }),
      NOW,
      COOLDOWN,
    );
    expect(d.fire).toBe(false);
  });

  it("fires again once the cooldown has elapsed", () => {
    const d = decideStayAlert(
      row({ available: true, armed: true, lastFiredAt: new Date(NOW - COOLDOWN - 1) }),
      NOW,
      COOLDOWN,
    );
    expect(d.fire).toBe(true);
  });

  it("does nothing when the query has no observation yet", () => {
    const d = decideStayAlert(row({ available: null }), NOW, COOLDOWN);
    expect(d.fire).toBe(false);
    expect(d.set.armed).toBe(true); // not met -> re-arm
  });
});

describe("decideStayAlert — becomes_available with a price ceiling", () => {
  const capped = (o: Partial<StayAlertRow>) => row({ priceBelow: 300, ...o });

  it("fires when a room opens at or under the ceiling", () => {
    const d = decideStayAlert(capped({ available: true, price: 280 }), NOW, COOLDOWN);
    expect(d.fire).toBe(true);
  });

  it("does not fire when a room is open but above the ceiling", () => {
    const d = decideStayAlert(capped({ available: true, price: 350 }), NOW, COOLDOWN);
    expect(d.fire).toBe(false);
    expect(d.set.armed).toBe(true);
  });

  it("does not fire when the open room has no observed price", () => {
    const d = decideStayAlert(capped({ available: true, price: null }), NOW, COOLDOWN);
    expect(d.fire).toBe(false);
  });
});

describe("decideStayAlert — price_below", () => {
  const priced = (o: Partial<StayAlertRow>) =>
    row({ mode: StayAlertMode.PRICE_BELOW, priceBelow: 300, ...o });

  it("fires when an available price is at or below the target", () => {
    const d = decideStayAlert(priced({ available: true, price: 280 }), NOW, COOLDOWN);
    expect(d.fire).toBe(true);
  });

  it("does not fire when the price is above the target", () => {
    const d = decideStayAlert(priced({ available: true, price: 320 }), NOW, COOLDOWN);
    expect(d.fire).toBe(false);
    expect(d.set.armed).toBe(true);
  });

  it("does not fire on an unavailable room even if its (null) price looks low", () => {
    const d = decideStayAlert(priced({ available: false, price: null }), NOW, COOLDOWN);
    expect(d.fire).toBe(false);
  });
});

describe("decideStayAlert — bookkeeping", () => {
  it("always carries the latest available/price for next-sweep edge detection", () => {
    const d = decideStayAlert(
      row({ available: true, price: 410, armed: false, lastFiredAt: new Date(NOW - 60_000) }),
      NOW,
      COOLDOWN,
    );
    expect(d.set.lastAvailable).toBe(true);
    expect(d.set.lastPrice).toBe(410);
  });
});
