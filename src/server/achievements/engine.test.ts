import { describe, expect, it } from "vite-plus/test";

import { aggregateDayRows, presenceDelta, settleDay, type DayStatRow } from "./engine.ts";

const MAX_GAP_S = 300;

function dayRow(overrides: Partial<DayStatRow>): DayStatRow {
  return {
    parkId: 1,
    day: "2026-07-06", // a Monday
    distanceM: 0,
    presentSeconds: 0,
    queueSeconds: 0,
    rides: 0,
    ropeDrop: false,
    nightOwl: false,
    rainy: false,
    ...overrides,
  };
}

describe("presenceDelta", () => {
  it("counts the inter-ping delta when in the same park and recent", () => {
    expect(presenceDelta(true, 30, MAX_GAP_S)).toBe(30);
  });

  it("counts the delta at the exact gap boundary (inclusive)", () => {
    expect(presenceDelta(true, MAX_GAP_S, MAX_GAP_S)).toBe(MAX_GAP_S);
  });

  it("contributes nothing when the gap exceeds the cap (app backgrounded)", () => {
    expect(presenceDelta(true, MAX_GAP_S + 1, MAX_GAP_S)).toBe(0);
  });

  it("contributes nothing when the previous ping was in a different park", () => {
    expect(presenceDelta(false, 30, MAX_GAP_S)).toBe(0);
  });

  it("contributes nothing with no prior ping (elapsed null)", () => {
    expect(presenceDelta(true, null, MAX_GAP_S)).toBe(0);
  });

  it("contributes nothing for a zero or negative delta (clock skew / dup ping)", () => {
    expect(presenceDelta(true, 0, MAX_GAP_S)).toBe(0);
    expect(presenceDelta(true, -5, MAX_GAP_S)).toBe(0);
  });
});

describe("settleDay", () => {
  const TZ = "America/New_York"; // EDT (UTC-4) in July

  it("credits the dwell to the anchored ping's local day, not `now`", () => {
    // Anchored ping at 23:55 EDT on 2026-07-06; the settling ping (`now`) lands
    // at 01:00 EDT the next morning. Using `now` would credit 2026-07-07 — a day
    // with no user_park_day row — silently dropping the ride. It must use the
    // anchor's own day.
    const anchorAt = new Date("2026-07-07T03:55:00Z"); // 2026-07-06 23:55 EDT
    const now = new Date("2026-07-07T05:00:00Z"); // 2026-07-07 01:00 EDT
    expect(settleDay(anchorAt, now, TZ)).toBe("2026-07-06");
    expect(settleDay(anchorAt, now, TZ)).not.toBe(localDayOf(now, TZ));
  });

  it("returns that day when anchor and now share a local day", () => {
    const anchorAt = new Date("2026-07-07T18:00:00Z"); // 14:00 EDT
    const now = new Date("2026-07-07T18:30:00Z"); // 14:30 EDT
    expect(settleDay(anchorAt, now, TZ)).toBe("2026-07-07");
  });

  it("falls back to `now` when the cursor lacks a timestamp", () => {
    const now = new Date("2026-07-07T18:00:00Z");
    expect(settleDay(null, now, TZ)).toBe("2026-07-07");
    expect(settleDay(undefined, now, TZ)).toBe("2026-07-07");
  });
});

describe("aggregateDayRows", () => {
  it("is all-zero for no rows", () => {
    const s = aggregateDayRows([]);
    expect(s.park_days).toBe(0);
    expect(s.parks_unique).toBe(0);
    expect(s.streak_best).toBe(0);
    expect(s.weekend_days).toBe(0);
    expect(s.full_days).toBe(0);
    expect(s.park_seconds).toBe(0);
  });

  it("sums totals and takes per-day maxima", () => {
    const s = aggregateDayRows([
      dayRow({
        day: "2026-07-04",
        distanceM: 8_000,
        queueSeconds: 600,
        presentSeconds: 3_600,
        rides: 2,
      }),
      dayRow({
        day: "2026-07-05",
        distanceM: 12_000,
        queueSeconds: 900,
        presentSeconds: 5_400,
        rides: 3,
      }),
    ]);
    expect(s.distance_m).toBe(20_000);
    expect(s.queue_seconds).toBe(1_500);
    expect(s.park_seconds).toBe(9_000);
    expect(s.rides).toBe(5);
    expect(s.best_day_distance_m).toBe(12_000);
    expect(s.best_day_queue_seconds).toBe(900);
    expect(s.park_days).toBe(2);
  });

  it("counts weekend park-days (Sat/Sun) in park-local time", () => {
    const s = aggregateDayRows([
      dayRow({ day: "2026-07-03" }), // Fri
      dayRow({ day: "2026-07-04" }), // Sat
      dayRow({ day: "2026-07-05" }), // Sun
      dayRow({ day: "2026-07-06" }), // Mon
    ]);
    expect(s.weekend_days).toBe(2);
  });

  it("counts full days only when a row is both rope drop AND night owl", () => {
    const s = aggregateDayRows([
      dayRow({ day: "2026-07-04", ropeDrop: true, nightOwl: true }),
      dayRow({ day: "2026-07-05", ropeDrop: true, nightOwl: false }),
      dayRow({ day: "2026-07-06", ropeDrop: false, nightOwl: true }),
    ]);
    expect(s.full_days).toBe(1);
    expect(s.rope_drops).toBe(2);
    expect(s.night_owls).toBe(2);
  });

  it("counts distinct parks and park-hop days", () => {
    const s = aggregateDayRows([
      dayRow({ day: "2026-07-04", parkId: 1 }),
      dayRow({ day: "2026-07-04", parkId: 2 }), // same day, 2 parks → a hop day
      dayRow({ day: "2026-07-05", parkId: 1 }), // single park
    ]);
    expect(s.parks_unique).toBe(2);
    expect(s.park_hop_days).toBe(1);
  });

  it("finds the longest consecutive-day streak, ignoring gaps", () => {
    const s = aggregateDayRows([
      dayRow({ day: "2026-07-03" }),
      dayRow({ day: "2026-07-04" }),
      dayRow({ day: "2026-07-05" }), // 3-day run
      dayRow({ day: "2026-07-10" }), // gap
      dayRow({ day: "2026-07-11" }), // 2-day run
    ]);
    expect(s.streak_best).toBe(3);
  });
});

/** Mirror of the engine's Intl day derivation, for asserting the negative case. */
function localDayOf(d: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}
