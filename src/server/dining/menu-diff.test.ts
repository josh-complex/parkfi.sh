import { describe, expect, it } from "vite-plus/test";

import { diffMenu, type PrevMenuRow } from "./menu-diff.ts";
import type { DiningMenuItemRow } from "./disney-dining-detail.ts";

/** A menu row with sensible defaults; override just what a case cares about. */
function row(over: Partial<DiningMenuItemRow>): DiningMenuItemRow {
  return {
    facilityId: "1",
    mealPeriod: "Dinner",
    groupName: "Entrées",
    itemType: "Main",
    title: "Item",
    description: null,
    price: null,
    priceType: null,
    currency: "USD",
    prices: null,
    ...over,
  };
}

describe("diffMenu", () => {
  it("emits a price move when a single item's price changes", () => {
    const prev: Array<PrevMenuRow> = [row({ title: "Burger", price: 20 })];
    const next = [row({ title: "Burger", price: 22 })];
    const { priceRows, eventRows } = diffMenu("1", prev, next);
    expect(eventRows).toHaveLength(0);
    expect(priceRows).toHaveLength(1);
    expect(priceRows[0]).toMatchObject({ title: "Burger", oldPrice: 20, newPrice: 22 });
  });

  it("does NOT cross-match duplicate titles when only the descriptions differ", () => {
    // Two different items sharing a title, published in opposite order across
    // generations. Occurrence-index pairing would diff chicken↔beef and emit a
    // phantom $24→$26 / $26→$24 move; description-aware pairing emits nothing.
    const prev: Array<PrevMenuRow> = [
      row({ title: "Chicken Milanesa Sandwich", description: "Crispy chicken cutlet", price: 24 }),
      row({ title: "Chicken Milanesa Sandwich", description: "6oz beef patty", price: 26 }),
    ];
    const next = [
      row({ title: "Chicken Milanesa Sandwich", description: "6oz beef patty", price: 26 }),
      row({ title: "Chicken Milanesa Sandwich", description: "Crispy chicken cutlet", price: 24 }),
    ];
    const { priceRows, eventRows } = diffMenu("1", prev, next);
    expect(priceRows).toHaveLength(0);
    expect(eventRows).toHaveLength(0);
  });

  it("attributes a price move to the right item among duplicate titles", () => {
    const prev: Array<PrevMenuRow> = [
      row({ title: "Chicken Milanesa Sandwich", description: "Crispy chicken cutlet", price: 24 }),
      row({ title: "Chicken Milanesa Sandwich", description: "6oz beef patty", price: 26 }),
    ];
    const next = [
      row({ title: "Chicken Milanesa Sandwich", description: "Crispy chicken cutlet", price: 24 }),
      row({ title: "Chicken Milanesa Sandwich", description: "6oz beef patty", price: 28 }),
    ];
    const { priceRows } = diffMenu("1", prev, next);
    expect(priceRows).toHaveLength(1);
    expect(priceRows[0]).toMatchObject({ oldPrice: 26, newPrice: 28 });
  });

  it("records adds and removes by multiset title difference", () => {
    const prev: Array<PrevMenuRow> = [row({ title: "Old Dish" })];
    const next = [row({ title: "New Dish" })];
    const { eventRows } = diffMenu("1", prev, next);
    expect(eventRows).toHaveLength(2);
    expect(eventRows.map((e) => [e.changeType, e.title]).sort()).toEqual([
      ["added", "New Dish"],
      ["removed", "Old Dish"],
    ]);
  });
});
