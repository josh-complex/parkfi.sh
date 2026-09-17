import { describe, expect, it } from "vite-plus/test";

import {
  calendarCells,
  heatClass,
  heatRamped,
  weekdayCounts,
  weekdayMeans,
  type DayPoint,
} from "./day-series.tsx";

/** A run of days from `start`, one value each. 2026-09-13 is a Sunday. */
function run(start: string, values: Array<number | null>): Array<DayPoint> {
  const d0 = new Date(`${start}T00:00:00`);
  return values.map((value, i) => {
    const d = new Date(d0);
    d.setDate(d.getDate() + i);
    const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    return { date, value };
  });
}

describe("calendarCells", () => {
  it("draws whole Sunday-to-Saturday weeks, so a column is one weekday", () => {
    // Starts on a Wednesday, ends on a Tuesday: both ends need padding.
    const cells = calendarCells(run("2026-09-16", Array(14).fill(1)), "start");
    expect(cells.length % 7).toBe(0);
    expect(new Date(`${cells[0]!.iso}T00:00:00`).getDay()).toBe(0);
    expect(new Date(`${cells[cells.length - 1]!.iso}T00:00:00`).getDay()).toBe(6);
  });

  it("hangs a history on its last day and a forecast on its first", () => {
    const days = run("2026-09-16", Array(14).fill(1));
    const history = calendarCells(days, "end");
    const forecast = calendarCells(days, "start");
    // The history runs back five weeks from the last day; the forecast starts
    // in the week the first day falls in.
    expect(history[history.length - 1]!.iso).toBe(forecast[forecast.length - 1]!.iso);
    expect(history.length).toBe(35);
    expect(forecast[0]!.iso).toBe("2026-09-13");
  });

  it("stops a forecast at the last day held rather than padding out five weeks", () => {
    // Exactly the complaint the venue page's old chart drew: a fortnight of
    // sweep rendered as five rows, the last three of them empty.
    const cells = calendarCells(run("2026-09-16", Array(14).fill(3)), "start");
    expect(cells.length).toBe(21);
    expect(cells.filter((c) => c.value != null).length).toBe(14);
  });

  it("caps a long forecast at the window it was asked for", () => {
    const cells = calendarCells(run("2026-09-13", Array(60).fill(2)), "start", 5);
    expect(cells.length).toBe(35);
  });

  it("keeps a day we hold nothing for distinct from one we recorded as zero", () => {
    const cells = calendarCells(run("2026-09-13", [0, null, 4]), "start");
    expect(cells.slice(0, 3).map((c) => c.value)).toEqual([0, null, 4]);
    // The padding out to Saturday is "nothing recorded", never zero.
    expect(cells[6]!.value).toBeNull();
  });

  it("has nothing to draw for an empty series", () => {
    expect(calendarCells([], "start")).toEqual([]);
  });
});

describe("weekdayMeans", () => {
  it("folds the window onto seven weekdays, Sunday first", () => {
    // Two weeks from a Sunday: Sundays 10 and 20 average 15.
    const days = run("2026-09-13", [10, 1, 1, 1, 1, 1, 1, 20, 1, 1, 1, 1, 1, 1]);
    expect(weekdayMeans(days)[0]).toBe(15);
  });

  it("rounds to whole units, the way the bars label themselves", () => {
    expect(weekdayMeans(run("2026-09-13", [10, 0, 0, 0, 0, 0, 0, 11]))[0]).toBe(11);
  });

  it("leaves a weekday the window never covered null, not zero", () => {
    const means = weekdayMeans(run("2026-09-13", [5, 5, 5]));
    expect(means.slice(0, 3)).toEqual([5, 5, 5]);
    expect(means.slice(3)).toEqual([null, null, null, null]);
  });

  it("ignores days with nothing recorded instead of counting them as zero", () => {
    const means = weekdayMeans(run("2026-09-13", [8, null, null, null, null, null, null, null]));
    expect(means[0]).toBe(8);
    expect(means[1]).toBeNull();
  });
});

describe("weekdayCounts", () => {
  it("reports how many days each weekday's mean rests on", () => {
    // Two whole weeks: every weekday twice. This is the only shape the caption
    // is allowed to rank, which is why the venue page slices to whole weeks.
    expect(weekdayCounts(run("2026-09-13", Array(14).fill(1)))).toEqual([2, 2, 2, 2, 2, 2, 2]);
  });

  it("exposes the lopsided window a caption must not rank", () => {
    // Ten days from a Sunday: Sun–Tue measured twice, Wed–Sat once.
    expect(weekdayCounts(run("2026-09-13", Array(10).fill(1)))).toEqual([2, 2, 2, 1, 1, 1, 1]);
  });

  it("doesn't count a day we hold nothing for", () => {
    expect(weekdayCounts(run("2026-09-13", [5, null]))).toEqual([1, 0, 0, 0, 0, 0, 0]);
  });
});

describe("heatClass", () => {
  it("spreads five steps over a range wide enough to mean something", () => {
    const steps = new Set([1, 10, 20, 30, 40].map((v) => heatClass(v, 1, 40)));
    expect(steps.size).toBe(5);
  });

  it("draws a range too narrow to encode flat instead of as a full gradient", () => {
    // The complaint this guard exists for: a venue whose whole month runs 20–24
    // was painted navy-to-white, identical to one running 1–40.
    expect(heatRamped(20, 24)).toBe(false);
    const steps = new Set([20, 21, 22, 23, 24].map((v) => heatClass(v, 20, 24)));
    expect(steps.size).toBe(1);
  });

  it("ramps once the spread is worth five steps", () => {
    expect(heatRamped(20, 25)).toBe(true);
  });
});

describe("calendarCells padding", () => {
  it("marks the squares that exist only to square off the weeks", () => {
    // A forecast starting Wednesday: Sun–Tue in front of it are padding, not
    // days the sweep missed, and drawing them as boxes put four empty squares
    // ahead of every window that didn't start on a Sunday.
    const cells = calendarCells(run("2026-09-16", Array(7).fill(1)), "start");
    expect(cells.slice(0, 3).every((c) => c.pad)).toBe(true);
    expect(cells.slice(3, 10).every((c) => c.pad)).toBe(false);
    expect(cells.slice(10).every((c) => c.pad)).toBe(true);
  });

  it("keeps a hole inside the window off the padding list", () => {
    // Null in the middle is a gap in the sweep — a real claim, still drawn.
    const cells = calendarCells(run("2026-09-13", [1, null, 1]), "start");
    expect(cells[1]).toMatchObject({ value: null, pad: false });
    expect(cells[3]).toMatchObject({ value: null, pad: true });
  });
});
