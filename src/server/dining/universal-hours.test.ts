import { describe, expect, it } from "vite-plus/test";

import { universalAddressLine, universalScheduleRows, universalTime12 } from "./universal-hours.ts";

describe("universalTime12", () => {
  it("converts 12-hour strings to HH:MM:SS", () => {
    expect(universalTime12("11:00 AM")).toBe("11:00:00");
    expect(universalTime12("09:00 PM")).toBe("21:00:00");
    expect(universalTime12("12:00 PM")).toBe("12:00:00");
    expect(universalTime12("12:30 AM")).toBe("00:30:00");
  });

  it("returns null for Closed markers and junk", () => {
    expect(universalTime12("Closed")).toBeNull();
    expect(universalTime12("")).toBeNull();
    expect(universalTime12(null)).toBeNull();
    expect(universalTime12("25:00 PM")).toBeNull();
  });
});

describe("universalScheduleRows", () => {
  // 2026-07-23 is a Thursday (day 4 in the feed's 0=Sunday convention).
  const FROM = "2026-07-23";

  const daily = (day: number, open = "11:00 AM", close = "09:00 PM") => ({
    open: { day, time: open },
    close: { day, time: close },
  });

  it("expands a full week pattern into a dated forward window", () => {
    const hours = { periods: [0, 1, 2, 3, 4, 5, 6].map((d) => daily(d)) };
    const rows = universalScheduleRows("uor.x", hours, FROM, 14);
    expect(rows).toHaveLength(14);
    expect(rows[0]).toEqual({
      facilityId: "uor.x",
      scheduleDate: "2026-07-23",
      scheduleType: "Operating",
      startTime: "11:00:00",
      endTime: "21:00:00",
    });
    expect(rows.at(-1)!.scheduleDate).toBe("2026-08-05");
  });

  it("skips days whose period is missing or marked Closed", () => {
    const hours = {
      periods: [
        daily(4), // Thursday open
        { open: { day: 5, time: "Closed" }, close: { day: 5, time: "Closed" } }, // Friday dark
      ],
    };
    const rows = universalScheduleRows("uor.x", hours, FROM, 7);
    // One Thursday in a 7-day window starting Thursday... plus the next
    // Thursday lands outside (day 7). Window covers Jul 23–29: one Thursday.
    expect(rows.map((r) => r.scheduleDate)).toEqual(["2026-07-23"]);
  });

  it("keeps split shifts and collapses duplicate periods", () => {
    const hours = {
      periods: [
        daily(4, "11:00 AM", "02:00 PM"),
        daily(4, "05:00 PM", "09:00 PM"),
        daily(4, "11:00 AM", "02:00 PM"), // duplicate
      ],
    };
    const rows = universalScheduleRows("uor.x", hours, FROM, 1);
    expect(rows.map((r) => `${r.startTime}-${r.endTime}`)).toEqual([
      "11:00:00-14:00:00",
      "17:00:00-21:00:00",
    ]);
  });

  it("returns empty for missing/empty patterns and bad dates", () => {
    expect(universalScheduleRows("uor.x", null, FROM)).toEqual([]);
    expect(universalScheduleRows("uor.x", { periods: [] }, FROM)).toEqual([]);
    expect(universalScheduleRows("uor.x", { periods: [daily(1)] }, "garbage")).toEqual([]);
  });
});

describe("universalAddressLine", () => {
  it("formats the one-line address", () => {
    expect(
      universalAddressLine({
        address_line1: "5600 Universal Boulevard",
        city: "Orlando",
        state: "FL",
        postal_code: "32819",
        country_code: "USA",
      }),
    ).toBe("5600 Universal Boulevard, Orlando, FL 32819");
  });

  it("tolerates partial and missing objects", () => {
    expect(universalAddressLine({ city: "Orlando" })).toBe("Orlando");
    expect(universalAddressLine(null)).toBeNull();
    expect(universalAddressLine({})).toBeNull();
  });
});
