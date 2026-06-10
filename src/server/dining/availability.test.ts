import { describe, expect, it } from "vite-plus/test";

import { parseAvailability } from "./availability.ts";

// Trimmed from a real dine-vas getAvailability range response: `restaurants` is
// keyed by service date, each date holds meal periods, and the bookable slots
// are nested under offersByAccessibility[].offers[].
const SAMPLE = {
  restaurants: {
    "2026-06-10": [],
    "2026-06-11": [
      {
        enterpriseMealPeriodId: "19150306",
        mealPeriodType: "Lunch",
        mealPeriodName: "Jaleo Lunch",
        cuisine: "Spanish",
        offersByAccessibility: [
          {
            accessibilityLevel: "GENERAL",
            offers: [
              { offerId: "678c9816:68", time: "11:35:00", label: "11:35 AM" },
              { offerId: "678c9816:69", time: "11:50:00", label: "11:50 AM" },
            ],
          },
        ],
      },
      {
        enterpriseMealPeriodId: "19141399",
        mealPeriodType: "Dinner",
        mealPeriodName: "Jaleo Dinner",
        offersByAccessibility: [
          { accessibilityLevel: "GENERAL", offers: [{ offerId: "678c9816:41", time: "16:00:00" }] },
        ],
      },
    ],
  },
};

describe("parseAvailability", () => {
  it("flattens nested offers per service date and prefers mealPeriodType", () => {
    const byDate = parseAvailability(SAMPLE);

    expect([...byDate.keys()]).toEqual(["2026-06-10", "2026-06-11"]);
    expect(byDate.get("2026-06-10")).toEqual([]);
    expect(byDate.get("2026-06-11")).toEqual([
      { mealPeriod: "Lunch", offerTime: "11:35:00", offerId: "678c9816:68" },
      { mealPeriod: "Lunch", offerTime: "11:50:00", offerId: "678c9816:69" },
      { mealPeriod: "Dinner", offerTime: "16:00:00", offerId: "678c9816:41" },
    ]);
  });

  it("falls back to mealPeriodName when type is absent", () => {
    const byDate = parseAvailability({
      restaurants: {
        "2026-06-11": [
          { mealPeriodName: "Brunch", offersByAccessibility: [{ offers: [{ time: "10:00:00" }] }] },
        ],
      },
    });
    expect(byDate.get("2026-06-11")).toEqual([
      { mealPeriod: "Brunch", offerTime: "10:00:00", offerId: null },
    ]);
  });

  it("returns an empty map for a missing/204 body", () => {
    expect(parseAvailability(null).size).toBe(0);
    expect(parseAvailability({}).size).toBe(0);
  });
});
