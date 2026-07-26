import { describe, expect, it } from "vite-plus/test";

import {
  disneyAccessibilityLabels,
  disneyFacetLabels,
  disneyFacetTags,
  disneyHeightsFromFacets,
  disneyPoiType,
  humanizeDisneyFacetSlug,
  osmPoiName,
  osmPoiType,
} from "./codes.ts";
import {
  buildDisneyEntityIndex,
  disneyEntityAttrs,
  disneyEntityPoiId,
  disneyEntityPoint,
  disneyEntityShowtimes,
  disneyJoinKey,
  resolveDisneyEntity,
} from "./disney-index.ts";
import { pointInGeometry } from "./sources/osm-amenities.ts";
import { DisneyAttractionListSchema } from "./schemas.ts";

// Slugs, labels and names below are verbatim from the live
// `list-ancestor-entities/.../attractions` payload, 2026-07-25.
const LABELS = disneyFacetLabels([
  { urlFriendlyId: "wheelchair-access", value: "May Remain in Wheelchair/ECV" },
  {
    urlFriendlyId: "transfer-to-wheelchair-then-vehicle",
    value: "Must Transfer to Wheelchair, Then to Ride Vehicle",
  },
  { urlFriendlyId: "handheld-captioning", value: "Handheld Captioning" },
  { urlFriendlyId: "not-permitted-service-animals", value: "Service Animals Not Permitted" },
  { urlFriendlyId: "thrill-rides", value: "Thrill Rides" },
  { urlFriendlyId: "big-drops", value: "Big Drops" },
]);

describe("disneyHeightsFromFacets", () => {
  it("reads a minimum straight off the slug", () => {
    expect(disneyHeightsFromFacets(["44-inches-112-cm-or-taller"])).toEqual({ min: 44, max: null });
  });

  it("treats any-height as an explicit zero, not as unknown", () => {
    // The whole point of the numeric column: `height_requirement = 'Any Height'`
    // is non-null yet means no requirement, so the chip tests min_height_in.
    expect(disneyHeightsFromFacets(["any-height"])).toEqual({ min: 0, max: null });
  });

  it("reads the -or-shorter maxima the prose has no form for", () => {
    expect(disneyHeightsFromFacets(["48-inches-122-cm-or-shorter"])).toEqual({
      min: null,
      max: 48,
    });
  });

  it("keeps the lowest floor and highest ceiling when a ride carries both", () => {
    expect(
      disneyHeightsFromFacets([
        "32-inches-81-cm-or-taller",
        "38-inches-97-cm-or-taller",
        "48-inches-122-cm-or-shorter",
      ]),
    ).toEqual({ min: 32, max: 48 });
  });

  it("is empty for an entity with no height facet", () => {
    expect(disneyHeightsFromFacets(undefined)).toEqual({ min: null, max: null });
    expect(disneyHeightsFromFacets(["something-unexpected"])).toEqual({ min: null, max: null });
  });
});

describe("humanizeDisneyFacetSlug", () => {
  it("drops the entity-type qualifier Disney scopes interests with", () => {
    expect(humanizeDisneyFacetSlug("animal-encounters-attractions")).toBe("Animal Encounters");
    expect(humanizeDisneyFacetSlug("pixar-pals-entertainments")).toBe("Pixar Pals");
  });

  it("drops the recommendation-bucket marker", () => {
    expect(humanizeDisneyFacetSlug("most-popular-rec")).toBe("Most Popular");
  });
});

describe("disneyAccessibilityLabels", () => {
  it("flattens all four groups in operator order, preferring published labels", () => {
    expect(
      disneyAccessibilityLabels(
        {
          mobilityDisabilities: ["transfer-to-wheelchair-then-vehicle"],
          hearingandVisualDisability: ["handheld-captioning"],
          serviceAnimals: ["not-permitted-service-animals"],
          physicalConsiderations: ["expectant-mothers"],
        },
        LABELS,
      ),
    ).toEqual([
      "Must Transfer to Wheelchair, Then to Ride Vehicle",
      "Handheld Captioning",
      "Service Animals Not Permitted",
      // Not in the 60-entry dictionary — humanized from the slug.
      "Expectant Mothers",
    ]);
  });

  it("is empty rather than noisy when nothing is published", () => {
    expect(disneyAccessibilityLabels({ height: ["any-height"] }, LABELS)).toEqual([]);
  });
});

describe("disneyFacetTags", () => {
  it("types the ride off thrillFactor and interests, and folds PhotoPass in", () => {
    expect(
      disneyFacetTags(
        {
          thrillFactor: ["thrill-rides", "big-drops"],
          interests: ["indoor-attractions"],
          photoPassAvailable: ["photopass-available"],
        },
        LABELS,
      ),
    ).toEqual(["Thrill Rides", "Big Drops", "Indoor", "PhotoPass"]);
  });

  it("never reads Lightning Lane or single rider — those come from queue capability", () => {
    const tags = disneyFacetTags(
      { eA: ["flex-rec"], interests: ["single-rider-line-wdw"] },
      LABELS,
    );
    expect(tags.join(" ")).not.toMatch(/lightning|flex/i);
    // The single-rider interest still reads as an interest chip, but nothing
    // downstream treats it as the single_rider signal.
    expect(tags).toEqual(["Single Rider Line"]);
  });
});

describe("disneyJoinKey", () => {
  it("survives the decorations Disney puts on live names", () => {
    // Each of these cost a real join in the measured run.
    expect(disneyJoinKey("Rock ’n’ Roller Coaster Starring The Muppets — New!")).toBe(
      disneyJoinKey("Rock ’n’ Roller Coaster Starring The Muppets"),
    );
    expect(disneyJoinKey("Zootopia: Better Zoogether! - NEW!")).toBe(
      disneyJoinKey("Zootopia: Better Zoogether!"),
    );
    expect(disneyJoinKey("Test Track Presented by Chevrolet")).toBe(disneyJoinKey("Test Track"));
    expect(disneyJoinKey("Indiana Jones™ Epic Stunt Spectacular!")).toBe(
      disneyJoinKey("Indiana Jones Epic Stunt Spectacular!"),
    );
  });

  it("keeps genuinely different seasonal names apart", () => {
    // A re-skin has different attributes, so matching them would be wrong.
    expect(disneyJoinKey("Jingle Cruise")).not.toBe(disneyJoinKey("Jungle Cruise"));
    expect(disneyJoinKey("Soarin' Across America")).not.toBe(
      disneyJoinKey("Soarin' Around the World"),
    );
  });
});

const FEED = DisneyAttractionListSchema.parse({
  results: [
    {
      facilityId: "80010190",
      id: "80010190;entityType=Attraction",
      entityType: "Attraction",
      name: "Space Mountain",
      facets: {
        height: ["44-inches-112-cm-or-taller"],
        mobilityDisabilities: ["transfer-to-wheelchair-then-vehicle"],
        thrillFactor: ["thrill-rides"],
        eA: ["flex-rec"],
      },
      media: { finderStandardThumb: { url: "https://cdn/x.jpg", alt: "Space Mountain" } },
      marker: {
        lat: 28.4188341691,
        lng: -81.5781962872,
        id: "16943183;entityType=point-of-interest",
      },
    },
    {
      facilityId: "268746",
      entityType: "Entertainment",
      name: "Meet Snow White in Germany",
      facets: { age: ["kids"] },
      schedule: {
        schedules: [
          {
            type: "Performance Time",
            date: "2026-07-25",
            startTime: "10:45:00",
            endTime: "10:45:00",
          },
          { type: "Performance Time", date: "2026-07-25", startTime: "11:55:00" },
          { type: "Performance Time", date: "2026-07-25", isClosed: true },
        ],
      },
      marker: { lat: 28.368451, lng: -81.546664, id: "16887958;entityType=point-of-interest" },
    },
  ],
  filters: {
    flatFacets: [{ urlFriendlyId: "thrill-rides", value: "Thrill Rides", group: "thrillFactor" }],
  },
});

describe("buildDisneyEntityIndex / resolveDisneyEntity", () => {
  const index = buildDisneyEntityIndex(FEED);

  it("prefers the facility id over the display name", () => {
    // Name says one ride, id says the other — the durable key wins.
    expect(resolveDisneyEntity(index, "268746", "Space Mountain")?.name).toBe(
      "Meet Snow White in Germany",
    );
  });

  it("falls back to the normalized name when no id is persisted yet", () => {
    expect(resolveDisneyEntity(index, null, "Space Mountain™")?.facilityId).toBe("80010190");
  });

  it("returns null rather than guessing", () => {
    expect(resolveDisneyEntity(index, "nope", "Nothing Like This")).toBeNull();
  });

  it("carries the feed's own label dictionary", () => {
    expect(index.labels.get("thrill-rides")).toBe("Thrill Rides");
  });
});

describe("disneyEntityAttrs", () => {
  const index = buildDisneyEntityIndex(FEED);
  const attrs = disneyEntityAttrs(FEED.results[0], index.labels);

  it("fills the columns the feed owns", () => {
    expect(attrs.minHeightIn).toBe(44);
    expect(attrs.tags).toEqual(["Thrill Rides"]);
    expect(attrs.imageAlt).toBe("Space Mountain");
  });

  it("humanizes a slug this payload's dictionary doesn't define", () => {
    // The live feed defines all nine accessibility groups; a trimmed payload
    // (or a slug Disney adds between publishes) must still read sensibly.
    expect(attrs.accessibility).toEqual(["Transfer to Wheelchair Then Vehicle"]);
  });

  it("regenerates prose only as a fallback label", () => {
    expect(attrs.heightRequirement).toBe('44" (112cm) or taller');
  });

  it("exposes the marker point and its point-of-interest id", () => {
    expect(disneyEntityPoint(FEED.results[0])).toEqual({
      lat: 28.4188341691,
      lng: -81.5781962872,
    });
    expect(disneyEntityPoiId(FEED.results[0])).toBe("16943183");
  });
});

describe("disneyEntityShowtimes", () => {
  it("keeps published performances and drops closed/timeless entries", () => {
    expect(disneyEntityShowtimes(FEED.results[1])).toEqual([
      { type: "Performance Time", date: "2026-07-25", start: "10:45:00", end: "10:45:00" },
      { type: "Performance Time", date: "2026-07-25", start: "11:55:00", end: null },
    ]);
  });

  it("returns null (not []) when nothing is published, so the upsert coalesces", () => {
    expect(disneyEntityShowtimes(FEED.results[0])).toBeNull();
  });
});

describe("disneyPoiType — the shared services vocabulary", () => {
  it("maps Disney's generic service names onto the Universal/OSM kinds", () => {
    // Generic `card.name` first, location-specific marker name as fallback.
    expect(disneyPoiType("Restrooms", "Bayou Restrooms")).toBe("restroom");
    expect(disneyPoiType(null, "City Hall ATM")).toBe("atm");
    expect(disneyPoiType("First Aid")).toBe("first-aid");
    expect(disneyPoiType("Locker Rentals")).toBe("locker");
    expect(disneyPoiType("Designated Smoking Areas")).toBe("smoking-area");
    expect(disneyPoiType("Water Bottle Refill Stations")).toBe("water-refill");
    expect(disneyPoiType("AED/Automated External Defibrillators")).toBe("aed");
    expect(disneyPoiType("Walt Disney World Bus Service")).toBe("transportation");
  });

  it("prefers the more specific pattern where two could match", () => {
    // "Locker Rentals" is a locker, not a generic rental.
    expect(disneyPoiType("Locker Rentals")).not.toBe("rental");
    expect(disneyPoiType("Stroller Rentals")).toBe("rental");
  });

  it("falls back to general rather than inventing a kind", () => {
    expect(disneyPoiType("Magical Extras")).toBe("general");
  });
});

describe("osmPoiType / osmPoiName", () => {
  it("maps the unambiguous amenity tags into the same vocabulary", () => {
    expect(osmPoiType({ amenity: "toilets" })).toBe("restroom");
    expect(osmPoiType({ amenity: "drinking_water" })).toBe("water-refill");
    expect(osmPoiType({ healthcare: "first_aid" })).toBe("first-aid");
  });

  it("ignores tags whose park meaning is ambiguous", () => {
    // Queue and bus shelters would bury the pins that matter.
    expect(osmPoiType({ amenity: "shelter" })).toBeNull();
    expect(osmPoiType(null)).toBeNull();
  });

  it("names anonymous nodes by kind, but keeps a mapped name", () => {
    expect(osmPoiName("restroom", { amenity: "toilets" })).toBe("Restrooms");
    expect(osmPoiName("restroom", { amenity: "toilets", name: "Bayou Restrooms" })).toBe(
      "Bayou Restrooms",
    );
  });
});

describe("pointInGeometry", () => {
  // A square around Magic Kingdom, with a hole punched out of the middle.
  const square = {
    type: "Polygon" as const,
    coordinates: [
      [
        [-81.59, 28.41],
        [-81.57, 28.41],
        [-81.57, 28.43],
        [-81.59, 28.43],
        [-81.59, 28.41],
      ] as Array<[number, number]>,
      [
        [-81.582, 28.419],
        [-81.578, 28.419],
        [-81.578, 28.421],
        [-81.582, 28.421],
        [-81.582, 28.419],
      ] as Array<[number, number]>,
    ],
  };

  it("accepts a point inside the outline", () => {
    expect(pointInGeometry({ lat: 28.4155, lng: -81.585 }, square)).toBe(true);
  });

  it("rejects a point outside it — the reason we don't assign by bbox", () => {
    // SeaWorld sits inside a carelessly drawn Epic Universe bbox.
    expect(pointInGeometry({ lat: 28.411, lng: -81.461 }, square)).toBe(false);
  });

  it("treats a hole as outside", () => {
    expect(pointInGeometry({ lat: 28.42, lng: -81.58 }, square)).toBe(false);
  });

  it("handles MultiPolygon outlines", () => {
    expect(
      pointInGeometry(
        { lat: 28.4155, lng: -81.585 },
        { type: "MultiPolygon", coordinates: [square.coordinates] },
      ),
    ).toBe(true);
  });
});
