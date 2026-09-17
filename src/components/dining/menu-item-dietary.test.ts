import { describe, expect, it } from "vite-plus/test";

import { splitDietary } from "./menu-item-detail.tsx";

/**
 * The menus hand us dietary flags as a trailing parenthetical on the
 * description, and they also hand us a much longer parenthetical that is *not*
 * a flag — Disney's allergy disclaimer, which is the single most common tail in
 * `dining_menu_item` (~1,500 rows on the most common wording alone, in at least
 * six variants). Turning that into chips would put a claim on the stub that the
 * feed never made, so the negative cases below matter more than the positive
 * ones.
 */
describe("splitDietary", () => {
  it("lifts a single dietary flag off the description", () => {
    expect(splitDietary("herbed butter, peach jam (Vegetarian)")).toEqual({
      text: "herbed butter, peach jam",
      flags: ["Vegetarian"],
    });
  });

  it("lifts several comma-separated flags", () => {
    expect(splitDietary("chickpea stew (Vegan, Gluten Sensitive)")).toEqual({
      text: "chickpea stew",
      flags: ["Vegan", "Gluten Sensitive"],
    });
  });

  it("normalises the three casings the feeds use for the same flag", () => {
    for (const written of ["Plant-based", "Plant-Based", "plant-based"]) {
      expect(splitDietary(`corn ribs (${written})`).flags).toEqual(["Plant-Based"]);
    }
  });

  it("leaves Disney's allergy disclaimer in the prose", () => {
    const d =
      "Grilled Chicken (For Gluten/Wheat, Egg, Fish/Shellfish, Milk, Peanut/Tree Nut, Sesame, and Soy Allergies)";
    expect(splitDietary(d)).toEqual({ text: d, flags: [] });
  });

  it("leaves a non-dietary parenthetical alone", () => {
    for (const d of ["Cheese board (serves 2)", "Frozen lemonade (seasonal)"]) {
      expect(splitDietary(d)).toEqual({ text: d, flags: [] });
    }
  });

  it("does not lift a flag from the middle of a description", () => {
    const d = "Impossible burger (Plant-based) with fries";
    expect(splitDietary(d)).toEqual({ text: d, flags: [] });
  });

  it("drops a description that was nothing but its flag", () => {
    expect(splitDietary("(Vegetarian)")).toEqual({ text: null, flags: ["Vegetarian"] });
  });

  it("passes a description with no parenthetical through untouched", () => {
    expect(splitDietary("smoked brisket")).toEqual({ text: "smoked brisket", flags: [] });
    expect(splitDietary(null)).toEqual({ text: null, flags: [] });
  });
});
