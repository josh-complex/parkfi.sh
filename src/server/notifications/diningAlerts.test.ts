import { describe, expect, it } from "vite-plus/test";

import { decideDiningAlert, type DiningAlertRow } from "./diningAlerts.ts";

const NOW = 1_700_000_000_000;
const COOLDOWN = 30 * 60_000;

function row(overrides: Partial<DiningAlertRow>): DiningAlertRow {
  return {
    id: 1,
    userId: "u1",
    facilityId: "", // any restaurant
    partySize: 2,
    serviceDate: null,
    windowDays: 30,
    armed: true,
    lastFiredAt: null,
    lastAvailable: null,
    emailOptOut: false,
    matchedDate: null,
    matchedFacilityId: null,
    matchedOfferTime: null,
    matchedName: null,
    ...overrides,
  };
}

describe("decideDiningAlert", () => {
  it("fires when a table is available while armed and cooled", () => {
    const d = decideDiningAlert(
      row({ matchedDate: "2026-07-04", matchedName: "Be Our Guest" }),
      NOW,
      COOLDOWN,
    );
    expect(d.fire).toBe(true);
    expect(d.set.armed).toBe(false);
    expect(d.set.lastFiredAt).toEqual(new Date(NOW));
    expect(d.set.lastAvailable).toBe(true);
  });

  it("does not fire when nothing is available, and re-arms", () => {
    const d = decideDiningAlert(row({ matchedDate: null, armed: false }), NOW, COOLDOWN);
    expect(d.fire).toBe(false);
    expect(d.set.armed).toBe(true);
    expect(d.set.lastAvailable).toBe(false);
  });

  it("does not re-fire while still available but already disarmed", () => {
    const d = decideDiningAlert(
      row({ matchedDate: "2026-07-04", armed: false, lastFiredAt: new Date(NOW - 60_000) }),
      NOW,
      COOLDOWN,
    );
    expect(d.fire).toBe(false);
    expect(d.set.armed).toBeUndefined(); // stays disarmed (still met)
  });

  it("is suppressed by cooldown even when armed and matched", () => {
    const d = decideDiningAlert(
      row({ matchedDate: "2026-07-04", armed: true, lastFiredAt: new Date(NOW - 5 * 60_000) }),
      NOW,
      COOLDOWN,
    );
    expect(d.fire).toBe(false);
  });

  it("fires again once the cooldown has elapsed", () => {
    const d = decideDiningAlert(
      row({ matchedDate: "2026-07-04", armed: true, lastFiredAt: new Date(NOW - COOLDOWN - 1) }),
      NOW,
      COOLDOWN,
    );
    expect(d.fire).toBe(true);
  });
});
