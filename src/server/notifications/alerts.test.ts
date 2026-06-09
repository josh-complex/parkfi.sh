import { describe, expect, it } from "vite-plus/test";

import { AlertMode, decideAlert, type AlertRow } from "./alerts.ts";

const NOW = 1_700_000_000_000;
const COOLDOWN = 30 * 60_000;

function row(overrides: Partial<AlertRow>): AlertRow {
  return {
    id: 1,
    userId: "u1",
    attractionId: 100,
    attractionName: "Test Coaster",
    parkSlug: "test-park",
    mode: AlertMode.THRESHOLD,
    thresholdMin: 20,
    changeDelta: null,
    armed: true,
    lastFiredAt: null,
    lastWaitMin: null,
    lastStatus: 1,
    wait: null,
    status: 1,
    ...overrides,
  };
}

describe("decideAlert — threshold mode", () => {
  it("fires when standby crosses to/below the target while armed and cooled", () => {
    const d = decideAlert(row({ wait: 15 }), NOW, COOLDOWN);
    expect(d.fire).toBe(true);
    expect(d.set.armed).toBe(false);
    expect(d.set.lastFiredAt).toEqual(new Date(NOW));
  });

  it("does not fire when standby is above the target, and re-arms", () => {
    const d = decideAlert(row({ wait: 30, armed: false }), NOW, COOLDOWN);
    expect(d.fire).toBe(false);
    expect(d.set.armed).toBe(true);
  });

  it("does not re-fire while still matched but already disarmed", () => {
    const d = decideAlert(
      row({ wait: 15, armed: false, lastFiredAt: new Date(NOW - 60_000) }),
      NOW,
      COOLDOWN,
    );
    expect(d.fire).toBe(false);
    expect(d.set.armed).toBeUndefined(); // stays disarmed (still met)
  });

  it("is suppressed by cooldown even when armed and matched", () => {
    const d = decideAlert(
      row({ wait: 15, armed: true, lastFiredAt: new Date(NOW - 5 * 60_000) }),
      NOW,
      COOLDOWN,
    );
    expect(d.fire).toBe(false);
  });

  it("fires again once the cooldown has elapsed", () => {
    const d = decideAlert(
      row({ wait: 15, armed: true, lastFiredAt: new Date(NOW - COOLDOWN - 1) }),
      NOW,
      COOLDOWN,
    );
    expect(d.fire).toBe(true);
  });

  it("does nothing when the ride has no recent wait", () => {
    const d = decideAlert(row({ wait: null }), NOW, COOLDOWN);
    expect(d.fire).toBe(false);
    expect(d.set.armed).toBe(true); // not met -> re-arm
  });
});

describe("decideAlert — change mode", () => {
  const change = (o: Partial<AlertRow>) =>
    row({ mode: AlertMode.CHANGE, thresholdMin: null, changeDelta: 10, ...o });

  it("fires when standby drifts at least the delta from baseline", () => {
    const d = decideAlert(change({ wait: 40, lastWaitMin: 20 }), NOW, COOLDOWN);
    expect(d.fire).toBe(true);
    expect(d.set.lastWaitMin).toBe(40); // baseline resets on fire
  });

  it("does not fire for sub-delta drift", () => {
    const d = decideAlert(change({ wait: 25, lastWaitMin: 20 }), NOW, COOLDOWN);
    expect(d.fire).toBe(false);
  });

  it("fires on a status flip regardless of wait drift", () => {
    const d = decideAlert(
      change({ wait: 20, lastWaitMin: 20, lastStatus: 2, status: 1 }),
      NOW,
      COOLDOWN,
    );
    expect(d.fire).toBe(true);
  });
});

describe("decideAlert — bookkeeping", () => {
  it("always carries the latest status into lastStatus for edge detection", () => {
    const d = decideAlert(row({ wait: 30, status: 2, lastStatus: 1, armed: false }), NOW, COOLDOWN);
    expect(d.set.lastStatus).toBe(2);
  });
});
