import { describe, expect, it } from "vite-plus/test";

import {
  clockLabel,
  hoursLabel,
  isOpenLate,
  isOpenNow,
  parkNowMinutes,
  parkToday,
  servesBreakfast,
  statusLabel,
  type ScheduleEntry,
} from "./dining-hours.ts";

const op = (startTime: string, endTime: string): ScheduleEntry => ({
  scheduleType: "Operating",
  startTime,
  endTime,
});

/**
 * 9:30 PM on the Fourth of July at the parks — which is already the *fifth* in
 * UTC. Every date the dining surfaces reason about is park-local, and this is
 * the instant where that stops being a distinction without a difference: the
 * database's `current_date` and the browser's `toISOString()` both say the 5th
 * here, which is how the whole hours surface came to read tomorrow's schedule
 * every evening. The server's reads pin the same timezone (`PARK_TODAY` in the
 * dining router), so the two halves agree on which day they are discussing.
 */
const EVENING = new Date("2026-07-05T01:30:00Z");

describe("the park's own day", () => {
  it("is still yesterday's date at 9:30 PM Eastern, where UTC has rolled over", () => {
    expect(EVENING.toISOString().slice(0, 10)).toBe("2026-07-05");
    expect(parkToday(EVENING)).toBe("2026-07-04");
  });

  it("reads the clock park-local too, so a date and a time never disagree", () => {
    expect(parkNowMinutes(EVENING)).toBe(21 * 60 + 30);
  });

  it("agrees with UTC during the park's own afternoon", () => {
    const afternoon = new Date("2026-07-04T18:00:00Z"); // 2 PM Eastern
    expect(parkToday(afternoon)).toBe("2026-07-04");
    expect(parkNowMinutes(afternoon)).toBe(14 * 60);
  });
});

describe("the list page's filters at an evening Eastern clock", () => {
  const nowMin = parkNowMinutes(EVENING); // 21:30
  const dinner = [op("17:00:00", "22:00:00")];
  const lunchOnly = [op("11:00:00", "15:00:00")];
  const pastMidnight = [op("16:00:00", "01:00:00")];

  it("calls a venue serving until 10 open, and one that shut at 3 closed", () => {
    expect(isOpenNow(dinner, nowMin)).toBe(true);
    expect(isOpenNow(lunchOnly, nowMin)).toBe(false);
  });

  it("keeps a past-midnight service open on the near side of midnight", () => {
    expect(isOpenNow(pastMidnight, nowMin)).toBe(true);
  });

  it("classifies breakfast and late service off the window, not the clock", () => {
    expect(servesBreakfast([op("08:00:00", "11:00:00")])).toBe(true);
    expect(servesBreakfast(dinner)).toBe(false);
    expect(isOpenLate(dinner)).toBe(true);
    expect(isOpenLate(lunchOnly)).toBe(false);
  });
});

describe("statusLabel", () => {
  const nowMin = 19 * 60 + 30; // 7:30 PM

  it("names the window the guest is standing in, not the last of the day", () => {
    expect(statusLabel([op("11:00:00", "15:00:00"), op("17:00:00", "21:00:00")], nowMin)).toBe(
      "Open til 9 PM",
    );
  });

  it("points a shut venue at its next service today", () => {
    expect(statusLabel([op("21:45:00", "23:30:00")], nowMin)).toBe("Closed · Opens 9:45 PM");
  });

  it("says nothing more than closed once the last service has started", () => {
    expect(statusLabel([op("11:00:00", "15:00:00")], nowMin)).toBe("Closed");
  });

  it("has nothing to say about a venue with no posted service", () => {
    expect(statusLabel([], nowMin)).toBeNull();
  });
});

describe("clockLabel", () => {
  it("drops the minutes on the hour, and keeps them off it", () => {
    expect(clockLabel("17:00:00")).toBe("5 PM");
    expect(clockLabel("17:30:00")).toBe("5:30 PM");
    expect(clockLabel("00:00:00")).toBe("12 AM");
  });

  it("spans the day's first opening to its last close", () => {
    expect(hoursLabel([op("11:00:00", "15:00:00"), op("17:00:00", "21:00:00")])).toBe("11 AM–9 PM");
    expect(hoursLabel([])).toBeNull();
  });
});
