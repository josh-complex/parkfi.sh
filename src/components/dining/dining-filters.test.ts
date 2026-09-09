import { describe, expect, it } from "vite-plus/test";

import { byMealPeriod, daysOutLabel, offerTimeLabel, type Offer } from "./dining-filters.ts";

const offer = (time: string, mealPeriod: string): Offer => ({ time, mealPeriod, deepLink: null });

describe("offerTimeLabel", () => {
  it("renders a Postgres time as a 12-hour clock time", () => {
    expect(offerTimeLabel("17:15:00")).toBe("5:15 PM");
    expect(offerTimeLabel("08:05:00")).toBe("8:05 AM");
  });

  it("handles both noon and midnight, where hour % 12 is zero", () => {
    expect(offerTimeLabel("12:00:00")).toBe("12:00 PM");
    expect(offerTimeLabel("00:30:00")).toBe("12:30 AM");
  });
});

describe("byMealPeriod", () => {
  it("buckets offers in first-seen order, which is time order from the query", () => {
    expect(
      byMealPeriod([
        offer("11:00:00", "Lunch"),
        offer("11:30:00", "Lunch"),
        offer("17:00:00", "Dinner"),
      ]),
    ).toEqual([
      ["Lunch", [offer("11:00:00", "Lunch"), offer("11:30:00", "Lunch")]],
      ["Dinner", [offer("17:00:00", "Dinner")]],
    ]);
  });

  it("keeps venue-specific period names Disney writes out in full", () => {
    // `mealPeriodType` is preferred upstream, but some venues only publish a
    // name like "Jaleo Lunch" — grouping must not assume the canonical three.
    const groups = byMealPeriod([offer("11:00:00", "Jaleo Lunch"), offer("17:00:00", "Dinner")]);
    expect(groups.map(([period]) => period)).toEqual(["Jaleo Lunch", "Dinner"]);
  });
});

describe("daysOutLabel", () => {
  it("names the near days and counts the rest", () => {
    expect(daysOutLabel("2026-09-08", "2026-09-08")).toBe("today");
    expect(daysOutLabel("2026-09-08", "2026-09-09")).toBe("tomorrow");
    expect(daysOutLabel("2026-09-08", "2026-09-12")).toBe("in 4 days");
  });

  it("counts across a DST boundary, where the day is not 24 hours", () => {
    // US DST ends Nov 1 2026; without rounding the diff this reads "in 2 days".
    expect(daysOutLabel("2026-10-31", "2026-11-03")).toBe("in 3 days");
  });
});
