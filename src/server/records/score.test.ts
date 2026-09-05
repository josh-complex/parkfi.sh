import { describe, expect, it } from "vite-plus/test";

import { scorePermit, scoreRecord } from "./score.ts";

import type { LinkResult } from "./link.ts";
import type { PublicRecordInput } from "./types.ts";

const noLinks: LinkResult = {
  parkId: null,
  polygonParkId: null,
  operator: null,
  resortSlug: null,
  links: [],
};
const inPark: LinkResult = {
  ...noLinks,
  parkId: 5,
  polygonParkId: 5,
  operator: "universal",
  resortSlug: "universal-orlando",
  links: [{ entityKind: "park", entityId: "5", method: "polygon", confidence: 0.95 }],
};

function permit(payload: Record<string, unknown>, title = "Permit"): PublicRecordInput {
  return { kind: "permit", externalId: "x", url: "u", title, payload };
}

describe("scorePermit", () => {
  it("ranks a costed operator building permit in a park above a fence permit", () => {
    const building = scorePermit(
      permit({
        applicationType: "Building Permit",
        worktype: "New",
        estimatedCost: 5_000_000,
        projectName: "Show Building",
      }),
      { operatorFiler: true, links: inPark },
    );
    const fence = scorePermit(
      permit({ applicationType: "Building Permit", worktype: "Fence", estimatedCost: 0 }),
      { operatorFiler: true, links: inPark },
    );
    expect(building).toBeGreaterThan(fence * 2);
  });

  it("floors annual blanket permits", () => {
    const annual = scorePermit(
      permit(
        { applicationType: "Electrical", worktype: "Repair" },
        "ANNUAL FACILITY PERMIT UNIVERSAL VOLCANO BAY",
      ),
      { operatorFiler: true, links: inPark },
    );
    const oneOff = scorePermit(
      permit({ applicationType: "Electrical", worktype: "New" }, "SHOW LIGHTING"),
      { operatorFiler: true, links: inPark },
    );
    expect(annual).toBeLessThan(oneOff / 2);
  });

  it("rewards a certificate of occupancy and an attraction link", () => {
    const base = permit({ applicationType: "Building Permit", worktype: "New" });
    const plain = scorePermit(base, { operatorFiler: true, links: inPark });
    const withCo = scorePermit(
      permit({ applicationType: "Building Permit", worktype: "New", cooDate: "2026-05-01" }),
      { operatorFiler: true, links: inPark },
    );
    const withRide = scorePermit(base, {
      operatorFiler: true,
      links: {
        ...inPark,
        links: [
          ...inPark.links,
          { entityKind: "attraction", entityId: "1", method: "name", confidence: 0.9 },
        ],
      },
    });
    expect(withCo).toBeGreaterThan(plain);
    expect(withRide).toBeGreaterThan(plain);
  });

  it("scores a status transition to Issued higher than a plain re-observation", () => {
    const base = permit({ applicationType: "Building Permit", worktype: "New" });
    const plain = scorePermit(base, { operatorFiler: true, links: inPark });
    const issued = scorePermit(base, {
      operatorFiler: true,
      links: inPark,
      statusTransition: { from: "Open", to: "Issued" },
    });
    expect(issued).toBeGreaterThan(plain);
  });

  it("tenant permits with no park evidence sit near the floor", () => {
    const s = scorePermit(permit({ applicationType: "Electrical", worktype: "Repair" }), {
      operatorFiler: false,
      links: noLinks,
    });
    expect(s).toBeLessThan(10);
  });
});

describe("scoreRecord", () => {
  it("falls back to a flat baseline for kinds without a formula", () => {
    const input: PublicRecordInput = {
      kind: "trademark",
      externalId: "1",
      url: "u",
      title: "T",
      payload: {},
    };
    expect(scoreRecord(input, { operatorFiler: true, links: noLinks })).toBe(40);
    expect(scoreRecord(input, { operatorFiler: false, links: noLinks })).toBe(10);
  });
});
