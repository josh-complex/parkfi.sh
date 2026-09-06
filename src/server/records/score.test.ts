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
      kind: "lawsuit",
      externalId: "1",
      url: "u",
      title: "T",
      payload: {},
    };
    expect(scoreRecord(input, { operatorFiler: true, links: noLinks })).toBe(40);
    expect(scoreRecord(input, { operatorFiler: false, links: noLinks })).toBe(10);
  });
});

describe("scoreTrademark", () => {
  const tm = (payload: Record<string, unknown>): PublicRecordInput => ({
    kind: "trademark",
    externalId: "1",
    url: "u",
    title: "MARK",
    payload,
  });

  it("ranks an intent-to-use class 041/043 mark above merch-only classes", () => {
    const place = scoreRecord(
      tm({ markText: "MARK", classes: ["041", "043"], intentToUse: true }),
      {
        operatorFiler: true,
        links: noLinks,
      },
    );
    const merch = scoreRecord(
      tm({ markText: "MARK", classes: ["025", "028"], intentToUse: false }),
      {
        operatorFiler: true,
        links: noLinks,
      },
    );
    expect(place).toBeGreaterThan(merch * 2);
  });

  it("treats registration and abandonment as news", () => {
    const base = tm({ markText: "MARK", classes: ["041"] });
    const plain = scoreRecord(base, { operatorFiler: true, links: noLinks });
    const registered = scoreRecord(tm({ ...base.payload, registrationDate: "2026-09-01" }), {
      operatorFiler: true,
      links: noLinks,
      statusTransition: { from: "Published for opposition", to: "Registered" },
    });
    expect(registered).toBeGreaterThan(plain);
  });
});

describe("scorePatent", () => {
  const pat = (
    kind: "patent_app" | "patent_grant",
    payload: Record<string, unknown>,
    title = "SYSTEM",
  ): PublicRecordInput => ({
    kind,
    externalId: "1",
    url: "u",
    title,
    payload,
  });

  it("ranks operator ride-system patents above generic operator software patents", () => {
    const ride = scoreRecord(pat("patent_app", { cpc: ["A63G 31/16"] }, "AMUSEMENT RIDE VEHICLE"), {
      operatorFiler: true,
      links: noLinks,
    });
    const software = scoreRecord(pat("patent_app", { cpc: ["G06Q 50/14"] }, "DATA PROCESSING"), {
      operatorFiler: true,
      links: noLinks,
    });
    expect(ride).toBeGreaterThan(software + 25);
  });
});
