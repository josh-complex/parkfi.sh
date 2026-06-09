import { describe, expect, it } from "vite-plus/test";

import {
  categoryFromUniversalPlace,
  normalizeUniversalName,
  universalDetailUrl,
  universalDiningBookable,
  universalDiningExperience,
  universalLandLabel,
  universalMealPeriod,
  universalPlaceImages,
  universalPlaceTags,
} from "./codes.ts";

// The Universal places feed is joined to our attractions on venue_id -> park +
// normalized name (ids don't line up across the feeds). These are real names.
describe("normalizeUniversalName — the Universal join key", () => {
  it("strips trademark glyphs, lowercases, and collapses punctuation", () => {
    expect(normalizeUniversalName("Hagrid's Magical Creatures Motorbike Adventure™")).toBe(
      "hagrids magical creatures motorbike adventure",
    );
    expect(normalizeUniversalName("Caro-Seuss-el™")).toBe("caro seuss el");
  });

  it("matches a name across the `&` vs `and` spelling", () => {
    expect(normalizeUniversalName("Fast & Furious")).toBe(
      normalizeUniversalName("Fast and Furious"),
    );
  });
});

describe("categoryFromUniversalPlace — pin class", () => {
  it("maps dining places to dine", () => {
    expect(categoryFromUniversalPlace("Dining", ["quick-service", "snacks-beverages"])).toBe(
      "dine",
    );
  });

  it("maps amenities (photo ops etc.) to info", () => {
    expect(categoryFromUniversalPlace("Amenity", ["photo_opportunity"])).toBe("info");
  });

  it("prefers thrill/water over the generic ride classification", () => {
    expect(categoryFromUniversalPlace("Attraction", ["thrill-rides"])).toBe("thrill");
    expect(categoryFromUniversalPlace("Attraction", ["water-rides"])).toBe("water");
    expect(categoryFromUniversalPlace("Attraction", ["family-rides"])).toBe("attraction");
  });

  it("returns null when there's nothing to classify", () => {
    expect(categoryFromUniversalPlace(null, [])).toBeNull();
  });
});

describe("universalPlaceImages", () => {
  const images = [
    { desktop: "logo.png", image_kind: "avatarImage" },
    { desktop: "hero.jpg", mobile: "hero-m.jpg", image_kind: "heroImage" },
    { desktop: "tile.jpg", image_kind: "filterListImage,iconImage,tileImage" },
  ];

  it("picks hero + thumb by image_kind, with name as alt", () => {
    expect(universalPlaceImages(images, "Sal's Market Deli")).toEqual({
      hero: "hero.jpg",
      thumb: "tile.jpg",
      alt: "Sal's Market Deli",
    });
  });

  it("falls back to the first usable image when kinds are missing", () => {
    expect(universalPlaceImages([{ desktop: "only.jpg" }], "X")).toEqual({
      hero: "only.jpg",
      thumb: "only.jpg",
      alt: "X",
    });
    expect(universalPlaceImages([], null)).toEqual({ hero: null, thumb: null, alt: null });
  });
});

describe("universalPlaceTags + universalLandLabel + universalDetailUrl", () => {
  it("humanizes category slugs into display tags", () => {
    expect(universalPlaceTags(["quick-service", "snacks-beverages"])).toEqual([
      "Quick Service",
      "Snacks Beverages",
    ]);
  });

  it("derives a readable land name, keeping small joiner words lowercase", () => {
    expect(universalLandLabel("uor.ioa.wizarding_world_of_harry_potter_hogsmeade")).toBe(
      "Wizarding World of Harry Potter Hogsmeade",
    );
    expect(universalLandLabel(null)).toBeNull();
  });

  it("extracts the official detail-page URL", () => {
    const urls = [
      { url: "https://x/menu", url_type: "DINING_MENU" },
      { url: "https://x/details", url_type: "PLACE_POI_DETAILS" },
    ];
    expect(universalDetailUrl(urls)).toBe("https://x/details");
    expect(universalDetailUrl([])).toBeNull();
  });
});

describe("Universal dining classification", () => {
  it("flags only table-service categories as bookable", () => {
    expect(universalDiningBookable(["casual-dining"])).toBe(true);
    expect(universalDiningBookable(["fine-dining", "full-service"])).toBe(true);
    expect(universalDiningBookable(["quick-service", "mobile-food-ordering"])).toBe(false);
    expect(universalDiningBookable(["snacks-beverages"])).toBe(false);
    expect(universalDiningBookable([])).toBe(false);
  });

  it("labels the most specific dining experience", () => {
    expect(universalDiningExperience(["casual-dining", "full-service"])).toBe("Full Service");
    expect(universalDiningExperience(["fine-dining"])).toBe("Fine Dining");
    expect(universalDiningExperience(["casual-dining"])).toBe("Casual Dining");
    expect(universalDiningExperience(["quick-service"])).toBeNull();
  });

  it("derives a coarse meal period from a slot time", () => {
    expect(universalMealPeriod("09:30")).toBe("Breakfast");
    expect(universalMealPeriod("13:00")).toBe("Lunch");
    expect(universalMealPeriod("21:45")).toBe("Dinner");
    expect(universalMealPeriod("")).toBe("Dining");
  });
});
