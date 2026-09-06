import { describe, expect, it } from "vite-plus/test";

import { prepareRecord } from "../ingest.ts";
import {
  applicantPhrases,
  applicantQuery,
  patentCenterUrl,
  usptoPatentAdapter,
} from "./uspto-patent.ts";

import type { EntityCatalog } from "../link.ts";
import type { FilerAlias } from "../types.ts";

const aliases: FilerAlias[] = [
  { pattern: "DISNEY ENTERPRISES%", operator: "disney", resortSlug: null },
  { pattern: "UNIVERSAL CITY STUDIOS%", operator: "universal", resortSlug: null },
  { pattern: "%ODD", operator: "seaworld", resortSlug: null },
];
const catalog: EntityCatalog = { parks: [], attractions: [] };

// Shape of one `patentFileWrapperDataBag[]` entry from the ODP search response.
const disneyApp = {
  applicationNumberText: "18999001",
  applicationMetaData: {
    inventionTitle:
      "PERSONALIZED NOTIFICATION OF ATTRACTIONS INCLUDING USER PREFERENCES OR AVERSIONS",
    filingDate: "2025-02-14",
    earliestPublicationNumber: "US20260261234A1",
    earliestPublicationDate: "2026-08-20",
    applicationStatusCode: 30,
    applicationStatusDescriptionText: "Docketed New Case - Ready for Examination",
    applicationStatusDate: "2025-04-01",
    applicationTypeLabelName: "Utility",
    firstApplicantName: "Disney Enterprises, Inc.",
    firstInventorName: "Jane Imagineer",
    groupArtUnitNumber: "3715",
    cpcClassificationBag: ["G06Q  50/14", "A63G  31/00"],
    applicantBag: [
      {
        applicantNameText: "Disney Enterprises, Inc.",
        correspondenceAddressBag: [{ cityName: "Burbank", nameLineOneText: "500 S Buena Vista" }],
      },
    ],
    inventorBag: [{ inventorNameText: "Jane Imagineer" }, { inventorNameText: "Sam Builder" }],
  },
};

const vendorGrant = {
  applicationMetaData: {
    applicationNumberText: "17555002",
    inventionTitle: "MOTION BASE FOR AN AMUSEMENT RIDE VEHICLE",
    filingDate: "2023-01-10",
    grantDate: "2026-09-01",
    patentNumber: "12400001",
    earliestPublicationDate: "2024-07-11",
    applicationStatusDescriptionText: "Patented Case",
    applicationStatusDate: "2026-08-12",
    firstApplicantName: "Oceaneering International, Inc.",
    cpcClassificationBag: ["A63G  31/16"],
    applicantBag: [{ applicantNameText: "Oceaneering International, Inc." }],
    inventorBag: [{ inventorNameText: "Pat Engineer" }],
  },
};

function raw(body: unknown, id: string) {
  return { externalId: id, url: patentCenterUrl(id), fetchedAt: new Date(), body };
}

describe("usptoPatentAdapter.normalize", () => {
  it("maps a published application", () => {
    const out = usptoPatentAdapter.normalize(raw(disneyApp, "18999001"));
    expect(out).not.toBeNull();
    expect(out!.kind).toBe("patent_app");
    expect(out!.externalId).toBe("18999001");
    expect(out!.filer).toBe("Disney Enterprises, Inc.");
    expect(out!.filedAt?.toISOString()).toBe("2025-02-14T12:00:00.000Z");
    expect(out!.status).toBe("Docketed New Case - Ready for Examination");
    expect(out!.description).toContain("Published 2026-08-20 as US20260261234A1");
    expect(out!.description).toContain("Inventors: Jane Imagineer, Sam Builder");
    expect(out!.payload.cpc).toEqual(["G06Q 50/14", "A63G 31/00"]);
    expect(out!.payload.rideSystemCpc).toBe(true);
    expect(JSON.stringify(out!.payload)).not.toContain("Buena Vista");
    expect(out!.url).toBe("https://patentcenter.uspto.gov/applications/18999001");
  });

  it("maps a grant, reading the application number from metadata when needed", () => {
    const out = usptoPatentAdapter.normalize(raw(vendorGrant, "17555002"));
    expect(out!.kind).toBe("patent_grant");
    expect(out!.externalId).toBe("17555002");
    expect(out!.description).toContain("Granted 2026-09-01 as US 12400001");
    expect(out!.alwaysKeep).toBe(true);
  });

  it("drops unpublished applications and throws on a bodiless entry", () => {
    const unpublished = {
      applicationNumberText: "1",
      applicationMetaData: { inventionTitle: "X", filingDate: "2026-01-01" },
    };
    expect(usptoPatentAdapter.normalize(raw(unpublished, "1"))).toBeNull();
    expect(() => usptoPatentAdapter.normalize(raw({}, "2"))).toThrow();
  });

  it("keeps a vendor ride-system grant without attribution, and ranks the operator's higher", () => {
    const vendor = prepareRecord(
      usptoPatentAdapter,
      usptoPatentAdapter.normalize(raw(vendorGrant, "17555002"))!,
      catalog,
      aliases,
    );
    expect(vendor).not.toBeNull();
    expect(vendor!.operator).toBeNull();
    const disney = prepareRecord(
      usptoPatentAdapter,
      usptoPatentAdapter.normalize(raw(disneyApp, "18999001"))!,
      catalog,
      aliases,
    );
    expect(disney!.operator).toBe("disney");
    expect(disney!.score).toBeGreaterThan(vendor!.score);
  });
});

describe("query building", () => {
  it("turns prefix aliases into quoted applicant phrases", () => {
    const phrases = applicantPhrases(aliases);
    expect(phrases).toEqual(["DISNEY ENTERPRISES", "UNIVERSAL CITY STUDIOS"]);
    expect(applicantQuery(phrases)).toBe(
      'applicationMetaData.firstApplicantName:("DISNEY ENTERPRISES" OR "UNIVERSAL CITY STUDIOS")',
    );
  });
});
