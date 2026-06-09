import { describe, expect, it } from "vite-plus/test";

import {
  categoryFromUniversalPlace,
  normalizeUniversalName,
  parseUniversalId,
  universalDetailUrl,
  universalLandLabel,
  universalPlaceImages,
  universalPlaceTags,
} from "./codes.ts";

// The places `place_id` and the ThemeParks.wiki Universal child `externalId`
// share one namespace; these are real ids pulled live from both feeds.
describe("parseUniversalId — the Universal join key", () => {
  it("parses a park POI id into venue + leaf, dropping the resort prefix + type", () => {
    expect(parseUniversalId("uor.usf.rides.revenge_of_the_mummy")).toEqual({
      venue: "usf",
      leaf: "revenge_of_the_mummy",
    });
    expect(parseUniversalId("uor.ioa.dining.green_eggs_and_ham_cafe")).toEqual({
      venue: "ioa",
      leaf: "green_eggs_and_ham_cafe",
    });
    expect(parseUniversalId("uor.ueu.show.the_cosmos_fountain")).toEqual({
      venue: "ueu",
      leaf: "the_cosmos_fountain",
    });
  });

  it("normalizes the `uo.` vs `uor.` prefix so both feeds collide on one key", () => {
    expect(parseUniversalId("uo.usf.rides.revenge_of_the_mummy")).toEqual(
      parseUniversalId("uor.usf.rides.revenge_of_the_mummy"),
    );
  });

  it("tolerates a 2-segment id with no type segment", () => {
    expect(parseUniversalId("uor.usf.foo")).toEqual({ venue: "usf", leaf: "foo" });
  });

  it("returns null for ids that can't yield a venue + leaf", () => {
    expect(parseUniversalId("uor.citywalk")).toBeNull();
    expect(parseUniversalId(undefined)).toBeNull();
    expect(parseUniversalId("")).toBeNull();
  });
});

describe("normalizeUniversalName — cross-feed fallback match", () => {
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
