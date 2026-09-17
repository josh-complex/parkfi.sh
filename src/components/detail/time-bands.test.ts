import { describe, expect, it } from "vite-plus/test";

import { bandGrid, bandOpenDays, TIME_BANDS, type DayHours } from "./time-bands.tsx";

function hours(...pairs: Array<[number, number]>) {
  return pairs.map(([hour, slots]) => ({ hour, slots }));
}

const bandIndex = (key: string) => TIME_BANDS.findIndex((b) => b.key === key);

describe("bandGrid", () => {
  it("cuts the clock so prime time is 5 to 8", () => {
    const days: Array<DayHours> = [
      { date: "2026-09-17", checked: true, hours: hours([16, 2], [17, 3], [19, 1], [20, 5]) },
    ];
    const { rows } = bandGrid(days);
    expect(rows[bandIndex("afternoon")]!.cells[0]!.slots).toBe(2);
    expect(rows[bandIndex("prime")]!.cells[0]!.slots).toBe(4);
    expect(rows[bandIndex("late")]!.cells[0]!.slots).toBe(5);
    expect(rows[bandIndex("morning")]!.cells[0]!.slots).toBe(0);
  });

  it("keeps a date nobody swept distinct from one that held nothing", () => {
    const days: Array<DayHours> = [
      { date: "2026-09-17", checked: true, hours: [] },
      { date: "2026-09-18", checked: false, hours: [] },
    ];
    const { rows } = bandGrid(days);
    const prime = rows[bandIndex("prime")]!.cells;
    expect(prime[0]!.slots).toBe(0);
    expect(prime[1]!.slots).toBeNull();
  });

  it("takes one ramp across the whole grid, so prime reads against late", () => {
    // Per-row ramps would paint a row holding a single 7 PM table the same
    // colour as a row holding twelve 9 PM ones, which inverts the reading.
    const days: Array<DayHours> = [
      { date: "2026-09-17", checked: true, hours: hours([18, 1], [21, 12]) },
    ];
    const { lo, hi } = bandGrid(days);
    expect([lo, hi]).toEqual([1, 12]);
  });

  it("has no scale to draw when the horizon is empty", () => {
    expect(bandGrid([{ date: "2026-09-17", checked: true, hours: [] }]).hi).toBe(0);
  });
});

describe("bandOpenDays", () => {
  it("counts open days against swept days, not against the calendar", () => {
    const days: Array<DayHours> = [
      { date: "2026-09-17", checked: true, hours: hours([19, 2]) },
      { date: "2026-09-18", checked: true, hours: hours([21, 4]) },
      { date: "2026-09-19", checked: false, hours: [] },
    ];
    const { rows } = bandGrid(days);
    expect(bandOpenDays(rows[bandIndex("prime")]!)).toEqual({ open: 1, checked: 2 });
    expect(bandOpenDays(rows[bandIndex("late")]!)).toEqual({ open: 1, checked: 2 });
  });
});
