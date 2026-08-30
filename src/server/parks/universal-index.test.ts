import { describe, expect, it } from "vite-plus/test";

import {
  heightRequirementLabel,
  parseHeightRequirementInches,
  universalAccessibilityLabels,
  universalTypeLabels,
} from "./codes.ts";
import {
  parseFeatureHeightInches,
  rideFactsFromPage,
  type UniversalRideFacts,
  type UniversalTileInfo,
} from "./sources/universal-content.ts";
import {
  buildUniversalContentIndex,
  resolveUniversalRideAttrs,
  rideJoinKey,
  venueBoundary,
} from "./universal-index.ts";
import { UniversalPoiFeedSchema, UniversalRidePageSchema } from "./schemas.ts";

// Venue ids: USF publishes ride attributes, Epic Universe (24000) does not.
const USF = 10010;
const EPIC = 24000;

function feed(rides: Array<Record<string, unknown>>, shows: Array<Record<string, unknown>> = []) {
  return UniversalPoiFeedSchema.parse({ Rides: rides, Shows: shows });
}

function index(input: {
  rides?: Array<Record<string, unknown>>;
  shows?: Array<Record<string, unknown>>;
  facts?: Array<Partial<UniversalRideFacts> & { heading: string }>;
  tiles?: Array<Partial<UniversalTileInfo> & { heading: string }>;
}) {
  return buildUniversalContentIndex({
    pois: feed(input.rides ?? [], input.shows ?? []),
    tiles: (input.tiles ?? []).map((t) => ({
      locationKeys: [],
      description: null,
      imageAlt: null,
      imageTile: null,
      imageHero: null,
      interests: [],
      land: null,
      ...t,
    })),
    rideFacts: (input.facts ?? []).map((f) => ({
      slug: f.heading,
      minHeightIn: null,
      rideTypes: [],
      childSwap: false,
      expressPass: false,
      companionRequirement: null,
      singleRider: false,
      imageHero: null,
      imageAlt: null,
      ...f,
    })),
    lands: [{ id: 10143, name: "Minion Land" }],
  });
}

describe("heightRequirementLabel / parseHeightRequirementInches", () => {
  it("formats a minimum in the same shape the Disney finder publishes", () => {
    expect(heightRequirementLabel(40, null)).toBe('40" (102cm) or taller');
  });

  it("renders an explicit zero minimum as Disney's own 'Any Height'", () => {
    expect(heightRequirementLabel(0, null)).toBe("Any Height");
  });

  it("formats a maximum when that's all there is", () => {
    expect(heightRequirementLabel(null, 56)).toBe('56" (142cm) or shorter');
  });

  it("stays null when nothing is published", () => {
    expect(heightRequirementLabel(null, null)).toBeNull();
  });

  it("round-trips the Disney prose back to inches", () => {
    expect(parseHeightRequirementInches('40" (102cm) or taller')).toEqual({ min: 40, max: null });
    expect(parseHeightRequirementInches('48" (122cm) or shorter')).toEqual({ min: null, max: 48 });
    // "Any Height" is a real published value meaning no requirement — 0, not
    // null, so the no-height filter can tell it apart from an unenriched row.
    expect(parseHeightRequirementInches("Any Height")).toEqual({ min: 0, max: null });
    expect(parseHeightRequirementInches(null)).toEqual({ min: null, max: null });
  });
});

describe("parseFeatureHeightInches", () => {
  it("reads a stated minimum, straight or curly inch mark", () => {
    expect(parseFeatureHeightInches('Minimum Height 51" (130 cm)')).toBe(51);
    expect(parseFeatureHeightInches("Minimum Height 42” (107 cm)")).toBe(42);
  });

  it("reads both spellings of an explicit no-minimum", () => {
    expect(parseFeatureHeightInches("No Minimum Height")).toBe(0);
    expect(parseFeatureHeightInches("No Height Requirement")).toBe(0);
  });

  it("refuses the non-height rules Universal files under Height Requirement", () => {
    // Every Volcano Bay pool publishes this in the height slot; reading the
    // first number out of it would invent a 48" minimum for a wading pool.
    expect(parseFeatureHeightInches('Guest Under 48" (122 cm) - Life Jackets Required')).toBeNull();
    expect(
      parseFeatureHeightInches("Under 48” (122 cm) Requires Supervising Companion"),
    ).toBeNull();
  });
});

describe("rideFactsFromPage", () => {
  const field = (value: string, keyword?: string) => ({
    Values: [value],
    KeywordValues: keyword ? [{ Key: keyword }] : [],
  });
  const page = (features: Array<{ icon: string; heading: string; description?: string }>) =>
    UniversalRidePageSchema.parse({
      ComponentPresentations: [
        {
          Component: {
            Schema: { Id: "tcm:58-75946-8", Title: "GDS - Utility Section" },
            Fields: {
              heading: field("Stardust Racers"),
              featureList: {
                LinkedComponentValues: [
                  {
                    Fields: {
                      feature: {
                        LinkedComponentValues: features.map((f) => ({
                          Fields: {
                            icon: field(f.icon, f.icon),
                            heading: field(f.heading),
                            ...(f.description ? { description: field(f.description) } : {}),
                          },
                        })),
                      },
                    },
                  },
                ],
              },
            },
          },
        },
      ],
    });

  it("pulls height, ride type, child swap and Express off the feature strip", () => {
    const facts = rideFactsFromPage(
      "stardust-racers",
      page([
        {
          icon: "height-limit",
          heading: "Height Requirement",
          description: 'Minimum Height 48" (122 cm)',
        },
        { icon: "ride", heading: "Ride Type", description: "Thrill, Water Ride" },
        { icon: "child-swap", heading: "Child Swap Available" },
        { icon: "express-pass", heading: "Express Pass", description: "Universal Express Pass" },
      ]),
    );
    expect(facts.heading).toBe("Stardust Racers");
    expect(facts.minHeightIn).toBe(48);
    expect(facts.rideTypes).toEqual(["Thrill", "Water Ride"]);
    expect(facts.childSwap).toBe(true);
    expect(facts.expressPass).toBe(true);
  });

  it("reads the GDS - Hero masthead image and its alt text", () => {
    const parsed = UniversalRidePageSchema.parse({
      ComponentPresentations: [
        {
          Component: {
            Schema: { Title: "GDS - Hero" },
            Fields: {
              image: {
                EmbeddedValues: [
                  {
                    desktop: {
                      LinkedComponentValues: [
                        {
                          Multimedia: {
                            Url: "/uor/en/us/files/Images/gds/ueu-stardust-racers-a.jpg",
                          },
                        },
                      ],
                    },
                    mobile: {
                      LinkedComponentValues: [
                        {
                          Multimedia: {
                            Url: "/uor/en/us/files/Images/gds/ueu-stardust-racers-b.jpg",
                          },
                        },
                      ],
                    },
                    alt: { Values: ["Riders fly through the air on Stardust Racers."] },
                  },
                ],
              },
            },
          },
        },
        {
          Component: {
            Schema: { Title: "GDS - Utility Section" },
            Fields: { heading: field("Stardust Racers") },
          },
        },
      ],
    });
    const facts = rideFactsFromPage("stardust-racers", parsed);
    expect(facts.heading).toBe("Stardust Racers");
    // Desktop rendition preferred, made absolute against the web origin.
    expect(facts.imageHero).toBe(
      "https://www.universalorlando.com/uor/en/us/files/Images/gds/ueu-stardust-racers-a.jpg",
    );
    expect(facts.imageAlt).toBe("Riders fly through the air on Stardust Racers.");
  });

  it("keeps a supervising-companion rule out of the height field", () => {
    // Its icon slug starts with `height-`, so only the heading check saves it.
    const facts = rideFactsFromPage(
      "caro-seuss-el",
      page([
        {
          icon: "height-limit-compaider",
          heading: "Supervising Companion Required",
          description: "Under 48” (122 cm) Requires Supervising Companion",
        },
        {
          icon: "height-requirement",
          heading: "Height Requirement",
          description: "No Minimum Height",
        },
      ]),
    );
    expect(facts.minHeightIn).toBe(0);
    expect(facts.companionRequirement).toContain("Supervising Companion");
  });
});

describe("resolveUniversalRideAttrs", () => {
  it("leaves an attraction no feed knows completely untouched", () => {
    const attrs = resolveUniversalRideAttrs(index({}), USF, "Meet SpongeBob");
    expect(attrs.matched).toBe(false);
    expect(attrs.minHeightIn).toBeNull();
    expect(attrs.heightRequirement).toBeNull();
  });

  it("takes the numeric minimum straight off the POI record", () => {
    const attrs = resolveUniversalRideAttrs(
      index({
        rides: [{ MblDisplayName: "Revenge of the Mummy™", VenueId: USF, MinHeightInInches: 48 }],
      }),
      USF,
      "Revenge of the Mummy™",
    );
    expect(attrs.minHeightIn).toBe(48);
    expect(attrs.heightRequirement).toBe('48" (122cm) or taller');
  });

  it("prefers the ride page where the two disagree", () => {
    // Punga Racers: the POI feed omits the field, the page states 42".
    const attrs = resolveUniversalRideAttrs(
      index({
        rides: [{ MblDisplayName: "Punga Racers™", VenueId: USF }],
        facts: [{ heading: "Punga Racers", minHeightIn: 42 }],
      }),
      USF,
      "Punga Racers™",
    );
    expect(attrs.minHeightIn).toBe(42);
  });

  it("reads a silent-but-present ride at an attribute-publishing venue as no minimum", () => {
    const attrs = resolveUniversalRideAttrs(
      index({ rides: [{ MblDisplayName: "Caro-Seuss-el™", VenueId: USF }] }),
      USF,
      "Caro-Seuss-el™",
    );
    expect(attrs.minHeightIn).toBe(0);
    expect(attrs.heightRequirement).toBe("Any Height");
  });

  it("does NOT read silence at Epic Universe as no minimum", () => {
    // EU records carry no height field at all, so absence proves nothing.
    const attrs = resolveUniversalRideAttrs(
      index({ rides: [{ MblDisplayName: "Bowser Jr. Challenge", VenueId: EPIC }] }),
      EPIC,
      "Bowser Jr. Challenge",
    );
    expect(attrs.matched).toBe(true);
    expect(attrs.minHeightIn).toBeNull();
  });

  it("distrusts Epic Universe's all-false attribute flags but believes its page", () => {
    const attrs = resolveUniversalRideAttrs(
      index({
        rides: [
          {
            MblDisplayName: "Stardust Racers",
            VenueId: EPIC,
            ExpressPassAccepted: false,
            HasChildSwap: false,
          },
        ],
        facts: [
          { heading: "Stardust Racers", minHeightIn: 48, childSwap: true, expressPass: true },
        ],
      }),
      EPIC,
      "Stardust Racers",
    );
    expect(attrs.expressPass).toBe(true);
    expect(attrs.childSwap).toBe(true);
    expect(attrs.minHeightIn).toBe(48);
  });

  it("believes a published false at a venue that populates attributes", () => {
    const attrs = resolveUniversalRideAttrs(
      index({
        rides: [
          {
            MblDisplayName: "Caro-Seuss-el™",
            VenueId: USF,
            ExpressPassAccepted: false,
            HasSingleRiderLine: false,
          },
        ],
      }),
      USF,
      "Caro-Seuss-el™",
    );
    expect(attrs.expressPass).toBe(false);
    expect(attrs.singleRider).toBe(false);
  });

  it("resolves a synthetic '<Ride> Single Rider' row to its base ride, flagged", () => {
    const attrs = resolveUniversalRideAttrs(
      index({
        rides: [
          {
            MblDisplayName: "The Incredible Hulk Coaster®",
            VenueId: USF,
            MinHeightInInches: 54,
            HasSingleRiderLine: false,
          },
        ],
      }),
      USF,
      "The Incredible Hulk Coaster® Single Rider",
    );
    expect(attrs.minHeightIn).toBe(54);
    expect(attrs.singleRider).toBe(true);
  });

  it("treats a show as height-free even at Epic Universe", () => {
    const attrs = resolveUniversalRideAttrs(
      index({
        shows: [{ MblDisplayName: "The Untrainable Dragon", VenueId: EPIC, Category: "Shows" }],
      }),
      EPIC,
      "The Untrainable Dragon",
    );
    expect(attrs.minHeightIn).toBe(0);
  });

  it("never reads a height off a tile-only match", () => {
    // A shop tile sharing a name must not become "no height requirement".
    const attrs = resolveUniversalRideAttrs(
      index({ tiles: [{ heading: "Ollivanders™ Wand Shop", imageAlt: "A wand shop" }] }),
      USF,
      "Ollivanders™ Wand Shop",
    );
    expect(attrs.matched).toBe(true);
    expect(attrs.minHeightIn).toBeNull();
    expect(attrs.imageAlt).toBe("A wand shop");
  });

  it("falls back to the page hero for artwork when no tile exists", () => {
    // The Epic Universe case: `filtersdata` dropped every EU tile (Aug 2026),
    // so the ride page's masthead is the only artwork left.
    const attrs = resolveUniversalRideAttrs(
      index({
        rides: [{ MblDisplayName: "Stardust Racers", VenueId: EPIC }],
        facts: [
          {
            heading: "Stardust Racers",
            imageHero: "https://www.universalorlando.com/uor/en/us/files/Images/gds/sr-a.jpg",
            imageAlt: "Riders on Stardust Racers.",
          },
        ],
      }),
      EPIC,
      "Stardust Racers",
    );
    expect(attrs.imageHeroUrl).toBe(
      "https://www.universalorlando.com/uor/en/us/files/Images/gds/sr-a.jpg",
    );
    // The hero also backs up the thumb slot when no list crop exists anywhere.
    expect(attrs.imageThumbUrl).toBe(
      "https://www.universalorlando.com/uor/en/us/files/Images/gds/sr-a.jpg",
    );
    expect(attrs.imageAlt).toBe("Riders on Stardust Racers.");
  });

  it("ignores POI-feed artwork at a venue whose records aren't trusted", () => {
    // EU show records ship a shared curious-george placeholder image; the same
    // trust gate that discards EU's all-false flags discards its artwork.
    const junk = "https://services.universalorlando.com:443/api/Images/curious-george.jpg";
    const untrusted = resolveUniversalRideAttrs(
      index({
        shows: [
          {
            MblDisplayName: "The Untrainable Dragon",
            VenueId: EPIC,
            Category: "Shows",
            ListImage: junk,
            DetailImages: [junk],
          },
        ],
      }),
      EPIC,
      "The Untrainable Dragon",
    );
    expect(untrusted.imageThumbUrl).toBeNull();
    expect(untrusted.imageHeroUrl).toBeNull();

    const trusted = resolveUniversalRideAttrs(
      index({
        rides: [
          {
            MblDisplayName: "Revenge of the Mummy™",
            VenueId: USF,
            ListImage: "https://services.universalorlando.com:443/api/Images/mummy-list.jpg",
            DetailImages: ["https://services.universalorlando.com:443/api/Images/mummy-a.jpg"],
          },
        ],
      }),
      USF,
      "Revenge of the Mummy™",
    );
    expect(trusted.imageThumbUrl).toContain("mummy-list.jpg");
    expect(trusted.imageHeroUrl).toContain("mummy-a.jpg");
  });

  it("merges ride types, page types and tile interests into one tag list", () => {
    const attrs = resolveUniversalRideAttrs(
      index({
        rides: [
          { MblDisplayName: "Trolls Trollercoaster", VenueId: USF, RideTypes: ["KidFriendly"] },
        ],
        facts: [{ heading: "Trolls Trollercoaster", rideTypes: ["Kid Friendly"] }],
        tiles: [{ heading: "Trolls Trollercoaster", interests: ["Fun For Little Ones"] }],
      }),
      USF,
      "Trolls Trollercoaster",
    );
    expect(attrs.tags).toEqual(["Kid Friendly", "Fun For Little Ones"]);
  });
});

describe("buildUniversalContentIndex", () => {
  it("keeps expired concert listings out of the tours layer", () => {
    const built = buildUniversalContentIndex({
      pois: UniversalPoiFeedSchema.parse({
        Events: [
          {
            MblDisplayName: "Walker Hayes",
            VenueId: USF,
            Id: 1,
            Dates: [{ StartDate: "2024-02-03T20:30:00-05:00" }],
          },
          { MblDisplayName: "Weather Shelter at Comic Strip Café", VenueId: USF, Id: 2 },
        ],
      }),
      tiles: [],
      rideFacts: [],
      lands: [],
    });
    const types = (built.poisByVenue.get(USF) ?? []).map((p) => p.poiType);
    expect(types).toEqual(["weather-shelter"]);
  });

  it("types the amenity buckets instead of flattening them to 'amenity'", () => {
    const built = buildUniversalContentIndex({
      pois: UniversalPoiFeedSchema.parse({
        Restrooms: [{ MblDisplayName: "Public Conveniences", VenueId: USF, Id: 3 }],
        Lockers: [{ MblDisplayName: "Mummy Lockers", VenueId: USF, Id: 4 }],
        Atms: [{ MblDisplayName: "ATM - Front Gate", VenueId: USF, Id: 5 }],
      }),
      tiles: [],
      rideFacts: [],
      lands: [],
    });
    expect((built.poisByVenue.get(USF) ?? []).map((p) => p.poiType).sort()).toEqual([
      "atm",
      "locker",
      "restroom",
    ]);
  });
});

describe("label helpers", () => {
  it("humanizes the PascalCase ride/show type vocabulary", () => {
    expect(universalTypeLabels(["KidFriendly", "Video3D4D", "WaterThrill"])).toEqual([
      "Kid Friendly",
      "3D/4D",
      "Water Thrill",
    ]);
  });

  it("humanizes accessibility options and drops the meaningless marker", () => {
    expect(
      universalAccessibilityLabels(["ClosedCaption", "ExtraInfo", "InAppDescriptiveAudio"]),
    ).toEqual(["Closed captioning", "Descriptive audio (app)"]);
  });

  it("joins on the name with the synthetic single-rider suffix removed", () => {
    expect(rideJoinKey("Hagrid's Magical Creatures Motorbike Adventure™ Single Rider")).toBe(
      rideJoinKey("Hagrid’s Magical Creatures Motorbike Adventure"),
    );
  });
});

describe("venue geometry", () => {
  const usf = {
    GpsBoundary: [
      { Latitude: 28.4739, Longitude: -81.4666 },
      { Latitude: 28.4792, Longitude: -81.464 },
      { Latitude: 28.4795, Longitude: -81.4712 },
    ],
  } as never;

  it("converts the lat/lng ring to a closed [lng, lat] GeoJSON polygon", () => {
    const poly = venueBoundary(usf);
    expect(poly?.type).toBe("Polygon");
    expect(poly?.coordinates[0][0]).toEqual([-81.4666, 28.4739]);
    // Ring closed: last point repeats the first.
    expect(poly?.coordinates[0].at(-1)).toEqual(poly?.coordinates[0][0]);
    expect(poly?.coordinates[0]).toHaveLength(4);
  });

  it("returns null rather than a degenerate polygon", () => {
    expect(venueBoundary({ GpsBoundary: [{ Latitude: 1, Longitude: 2 }] } as never)).toBeNull();
    expect(venueBoundary({} as never)).toBeNull();
  });
});
