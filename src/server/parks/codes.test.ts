import { describe, expect, it } from "vite-plus/test";

import {
  categoryFromUniversalPlace,
  disneyDiningBookable,
  disneyDiningCuisine,
  disneyDiningEntityType,
  disneyDiningPriceRange,
  normalizeUniversalName,
  parseDisneyWaterParkTickets,
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

describe("Disney finder dining catalog mappers", () => {
  it("normalizes the entity type", () => {
    expect(disneyDiningEntityType("restaurant")).toBe("restaurant");
    expect(disneyDiningEntityType("Dinner-Show")).toBe("dinner-show");
    expect(disneyDiningEntityType("Dining-Event")).toBe("dining-event");
    expect(disneyDiningEntityType("Event")).toBe("dining-event");
  });

  it("flags bookable from checkAvailability or tableService facets", () => {
    expect(disneyDiningBookable({ checkAvailability: ["checkavailmodulewdw"] })).toBe(true);
    expect(disneyDiningBookable({ tableService: ["reservations-accepted", "a-la-carte"] })).toBe(
      true,
    );
    expect(disneyDiningBookable({ tableService: ["a-la-carte"] })).toBe(false);
    expect(disneyDiningBookable({})).toBe(false);
  });

  it("humanizes cuisine facets", () => {
    expect(disneyDiningCuisine(["american-cuisine", "steakhouse-cuisine"])).toBe(
      "American, Steakhouse",
    );
    expect(disneyDiningCuisine([])).toBeNull();
  });

  it("extracts the price descriptor from facetsLabel, else the bare symbol", () => {
    expect(disneyDiningPriceRange("$$$ ($35 to $59.99 per adult), American, Steakhouse")).toBe(
      "$$$ ($35 to $59.99 per adult)",
    );
    expect(disneyDiningPriceRange("Mexican", ["$$"])).toBe("$$");
    expect(disneyDiningPriceRange("Mexican", null)).toBeNull();
  });
});

// The water-park ticket page is a static HTML page (no productInstanceId feed):
// two flat-priced tiers plus the summer blockout ranges, all scraped from markup.
describe("parseDisneyWaterParkTickets — the scraped flat-price tiers", () => {
  // Trimmed to the price blocks + blockout copy from the real page structure.
  const html = `
    <label id="waterParks-waterpark-label" class="waterParks-water-park waterParksRadioLabel">
      <input id="waterParks-waterpark" value="water-park" name="waterParks" />
    </label>
    <div id="waterParks-water-park" class="waterParksLabel">
      <div class="waterParksPriceBlock">
        <div class="adultPrice singlePrice"><span class="waterParkPrice">$74.00</span></div>
        <div class="childPrice singlePrice"><span class="waterParkPrice">$68.00</span></div>
      </div>
    </div>
    <div id="waterParks-water-park-blockout" class="waterParksLabel">
      <div class="waterParksPriceBlock">
        <div class="adultPrice singlePrice"><span class="waterParkPrice">$64.00</span></div>
        <div class="childPrice singlePrice"><span class="waterParkPrice">$58.00</span></div>
      </div>
    </div>
    <p>This ticket is not valid for admission from May 23 to September 26, 2026 and
       May 23 to September 26, 2027.</p>`;

  it("extracts adult + child cents for both tiers", () => {
    const t = parseDisneyWaterParkTickets(html);
    expect(t.regular).toEqual({ adultCents: 7400, childCents: 6800 });
    expect(t.blockout).toEqual({ adultCents: 6400, childCents: 5800 });
  });

  it("parses + dedupes the blockout ranges into ISO dates", () => {
    const t = parseDisneyWaterParkTickets(html);
    expect(t.blockoutRanges).toEqual([
      { start: "2026-05-23", end: "2026-09-26" },
      { start: "2027-05-23", end: "2027-09-26" },
    ]);
  });

  it("does not confuse the regular tier's prices with the blockout tier's", () => {
    // The regular block id is a prefix of the blockout id — the exact-id anchor
    // plus the bounded slice must keep them apart.
    const t = parseDisneyWaterParkTickets(html);
    expect(t.regular?.adultCents).toBe(7400);
  });

  it("degrades to nulls / empty on unrecognized markup", () => {
    const t = parseDisneyWaterParkTickets("<div>no prices here</div>");
    expect(t.regular).toBeNull();
    expect(t.blockout).toBeNull();
    expect(t.blockoutRanges).toEqual([]);
  });
});
