import { describe, expect, it } from "vite-plus/test";

import { computeLinks, type EntityCatalog } from "./link.ts";

// Two square parks in [lng,lat]: USF at (0..1, 0..1), IOA at (2..3, 0..1).
const catalog: EntityCatalog = {
  parks: [
    {
      id: 5,
      slug: "universal-studios-florida",
      name: "Universal Studios Florida",
      resortSlug: "universal-orlando",
      operator: "universal",
      latitude: 0.5,
      longitude: 0.5,
      boundary: {
        type: "Polygon",
        coordinates: [
          [
            [0, 0],
            [1, 0],
            [1, 1],
            [0, 1],
            [0, 0],
          ],
        ],
      },
    },
    {
      id: 6,
      slug: "islands-of-adventure",
      name: "Islands of Adventure",
      resortSlug: "universal-orlando",
      operator: "universal",
      latitude: 0.5,
      longitude: 2.5,
      boundary: {
        type: "Polygon",
        coordinates: [
          [
            [2, 0],
            [3, 0],
            [3, 1],
            [2, 1],
            [2, 0],
          ],
        ],
      },
    },
    {
      id: 1,
      slug: "magic-kingdom",
      name: "Magic Kingdom",
      resortSlug: "walt-disney-world",
      operator: "disney",
      latitude: 10,
      longitude: 10,
      boundary: null,
    },
  ],
  attractions: [
    { id: 101, parkId: 5, name: "Hollywood Rip Ride Rockit", slug: "hollywood-rip-ride-rockit" },
    { id: 102, parkId: 5, name: "Revenge of the Mummy", slug: "revenge-of-the-mummy" },
    { id: 201, parkId: 6, name: "Jurassic World VelociCoaster", slug: "velocicoaster" },
    { id: 202, parkId: 6, name: "Express", slug: "express" },
    { id: 301, parkId: 1, name: "Seven Dwarfs Mine Train", slug: "seven-dwarfs-mine-train" },
  ],
};

describe("computeLinks", () => {
  it("links the park by polygon and inherits its operator/resort", () => {
    const r = computeLinks({ title: "Fence", latitude: 0.5, longitude: 0.5 }, catalog);
    expect(r.parkId).toBe(5);
    expect(r.polygonParkId).toBe(5);
    expect(r.operator).toBe("universal");
    expect(r.resortSlug).toBe("universal-orlando");
    expect(r.links).toContainEqual({
      entityKind: "park",
      entityId: "5",
      method: "polygon",
      confidence: 0.95,
    });
    expect(r.links).toContainEqual({
      entityKind: "resort",
      entityId: "universal-orlando",
      method: "filer",
      confidence: 0.8,
    });
  });

  it("a point outside every polygon is not a park hit", () => {
    const r = computeLinks({ title: "x", latitude: 5, longitude: 5 }, catalog);
    expect(r.polygonParkId).toBeNull();
    expect(r.parkId).toBeNull();
    expect(r.operator).toBeNull();
  });

  it("matches attraction names inside the polygon-linked park only", () => {
    const r = computeLinks(
      { title: "REVENGE OF THE MUMMY SHOW BUILDING REROOF", latitude: 0.2, longitude: 0.2 },
      catalog,
    );
    expect(r.links).toContainEqual({
      entityKind: "attraction",
      entityId: "102",
      method: "name",
      confidence: 0.9,
    });
    expect(r.links.some((l) => l.entityId === "201")).toBe(false);
  });

  it("resolves abbreviations and lets a name hit pin the park", () => {
    const r = computeLinks(
      { title: "HRRR LAUNCH TRACK MODS", operator: "universal", resortSlug: "universal-orlando" },
      catalog,
    );
    expect(r.links).toContainEqual({
      entityKind: "attraction",
      entityId: "101",
      method: "name",
      confidence: 0.6,
    });
    expect(r.parkId).toBe(5);
  });

  it("never matches short generic names", () => {
    const r = computeLinks(
      { title: "EXPRESS LANE CANOPY", operator: "universal", resortSlug: "universal-orlando" },
      catalog,
    );
    expect(r.links.some((l) => l.entityKind === "attraction")).toBe(false);
  });

  it("uses the lexicon for a park when there is no point", () => {
    const r = computeLinks(
      { title: "ANNUAL FACILITY PERMIT ISLANDS OF ADVENTURE", operator: "universal" },
      catalog,
    );
    expect(r.parkId).toBe(6);
    expect(r.polygonParkId).toBeNull();
    expect(r.resortSlug).toBe("universal-orlando");
    expect(r.links).toContainEqual({
      entityKind: "park",
      entityId: "6",
      method: "lexicon",
      confidence: 0.4,
    });
  });

  it("lexicon resort-only keywords set the resort without a park", () => {
    const r = computeLinks({ title: "CITYWALK KIOSK", operator: "universal" }, catalog);
    expect(r.parkId).toBeNull();
    expect(r.resortSlug).toBe("universal-orlando");
  });

  it("scopes name matches to the resort when only the resort is known", () => {
    const r = computeLinks(
      { title: "SEVEN DWARFS MINE TRAIN QUEUE", resortSlug: "universal-orlando" },
      catalog,
    );
    expect(r.links.some((l) => l.entityId === "301")).toBe(false);
  });
});
