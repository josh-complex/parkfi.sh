import { describe, expect, it } from "vite-plus/test";

import { scoreErp } from "../score.ts";
import {
  applicantClause,
  localDay,
  parkEnvelope,
  receivedDateFromAppNo,
  sfwmdErpAdapter,
  windowClause,
  type ErpRow,
} from "./sfwmd-erp.ts";

import type { ParkGeo } from "../types.ts";

// Attributes exactly as the layer returned them for Project K (2026-09-12).
const PROJECT_K: ErpRow = {
  attributes: {
    APP_NO: "250818-56114",
    PERMIT_NO: "48-114534-P",
    PROJECT_NAME: "Project K",
    AppType: "NEW",
    AppTypeDesc: "New",
    PermitFamily: "ERP",
    PermitSubFamilyDesc: "Individual",
    PermitType: "IND",
    ApplicantName: "Walt Disney Parks and Resorts U.S., Inc",
    FullNameOrCompany: "Jose Garrido",
    AppStatus: "Resolved-Completed",
    PermitStatus: "Approved",
    LandUse: "Commercial",
    ProjectAcres: 12.51,
    PermitAcres: null,
    AppReceivedDate: 1755576000000, // decodes to 2025-08-19 in New York — one day late
    AppFinalActionDate: 1763960400000, // 2025-11-24 EST
    IssueDate: 1763960400000,
    PermitExpirationDate: null,
    City: "Lake Buena Vista",
    State: "FL",
    IsTestData: null,
  },
  centroid: { x: -81.5734498, y: 28.402603 },
  nearest: { slug: "hollywood-studios", km: 2.1 },
};

const parks: ParkGeo[] = [
  {
    id: 4,
    slug: "hollywood-studios",
    name: "Disney's Hollywood Studios",
    resortSlug: "walt-disney-world",
    operator: "disney",
    latitude: 28.3568,
    longitude: -81.5605,
    boundary: null,
  },
  {
    id: 5,
    slug: "universal-studios-florida",
    name: "Universal Studios Florida",
    resortSlug: "universal-orlando",
    operator: "universal",
    latitude: 28.4777,
    longitude: -81.4684,
    boundary: null,
  },
];

describe("sfwmd-erp dates", () => {
  it("reads the received day from the application number, not the shifted epoch", () => {
    expect(receivedDateFromAppNo("250818-56114")?.toISOString()).toBe("2025-08-18T12:00:00.000Z");
    expect(receivedDateFromAppNo("48-114534-P")).toBeNull();
    expect(receivedDateFromAppNo(null)).toBeNull();
  });

  it("decodes final-action epochs as park-local calendar days", () => {
    expect(localDay(1763960400000)?.toISOString()).toBe("2025-11-24T12:00:00.000Z");
    expect(localDay(1769144400000)?.toISOString()).toBe("2026-01-23T12:00:00.000Z");
    expect(localDay(null)).toBeNull();
  });
});

describe("sfwmd-erp query building", () => {
  it("pushes plain prefix aliases down as contains-matches", () => {
    const clause = applicantClause([
      { pattern: "WALT DISNEY PARKS%", operator: "disney", resortSlug: null },
      { pattern: "UNIVERSAL CITY DEVELOPMENT%", operator: "universal", resortSlug: null },
      { pattern: "%MITIGATION BANK%", operator: "disney", resortSlug: null },
    ]);
    expect(clause).toBe(
      "UPPER(ApplicantName) LIKE '%WALT DISNEY PARKS%' OR UPPER(ApplicantName) LIKE '%UNIVERSAL CITY DEVELOPMENT%'",
    );
  });

  it("windows on received, final-action and issue dates", () => {
    expect(windowClause("2026-09-01")).toContain("AppReceivedDate >= DATE '2026-09-01'");
    expect(windowClause("2026-09-01")).toContain("IssueDate >= DATE '2026-09-01'");
  });

  it("builds one padded envelope around every park centre", () => {
    expect(parkEnvelope(parks)).toBe("-81.6405,28.2768,-81.3884,28.5577");
    expect(parkEnvelope([])).toBeNull();
  });
});

describe("sfwmd-erp normalize", () => {
  it("maps an approved individual application", () => {
    const rec = sfwmdErpAdapter.normalize({
      externalId: "250818-56114",
      url: "https://www.sfwmd.gov/regpermitting",
      fetchedAt: new Date(),
      body: PROJECT_K,
    });
    expect(rec).not.toBeNull();
    expect(rec!.kind).toBe("erp");
    expect(rec!.externalId).toBe("250818-56114");
    expect(rec!.title).toBe("Project K");
    expect(rec!.filer).toBe("Walt Disney Parks and Resorts U.S., Inc");
    expect(rec!.filedAt?.toISOString()).toBe("2025-08-18T12:00:00.000Z");
    expect(rec!.statusAt?.toISOString()).toBe("2025-11-24T12:00:00.000Z");
    // A resolved application reports the permit's fate.
    expect(rec!.status).toBe("Approved");
    expect(rec!.latitude).toBeCloseTo(28.4026, 3);
    expect(rec!.longitude).toBeCloseTo(-81.5734, 3);
    expect(rec!.jobKey).toBe("48-114534-p");
    expect(rec!.description).toContain("Individual, new");
    expect(rec!.description).toContain("12.51 acres");
    expect(rec!.payload.receivedDate).toBe("2025-08-18");
    expect(rec!.payload.applicantCity).toBe("Lake Buena Vista");
    expect(rec!.payload).not.toHaveProperty("FullAddress");
    expect(rec!.linkText).toEqual([
      "Project K",
      "Walt Disney Parks and Resorts U.S., Inc",
      "Jose Garrido",
    ]);
  });

  it("keeps a pending application's own status and strips 'Resolved-' elsewhere", () => {
    const pending = sfwmdErpAdapter.normalize({
      externalId: "x",
      url: "u",
      fetchedAt: new Date(),
      body: {
        ...PROJECT_K,
        attributes: {
          ...PROJECT_K.attributes,
          APP_NO: "260430-63838",
          AppStatus: "Pending-TechnicalReview",
          PermitStatus: null,
          AppFinalActionDate: null,
          IssueDate: null,
        },
      } satisfies ErpRow,
    });
    expect(pending!.status).toBe("Pending-TechnicalReview");
    expect(pending!.statusAt?.toISOString()).toBe("2026-04-30T12:00:00.000Z");
    const withdrawn = sfwmdErpAdapter.normalize({
      externalId: "x",
      url: "u",
      fetchedAt: new Date(),
      body: {
        ...PROJECT_K,
        attributes: {
          ...PROJECT_K.attributes,
          AppStatus: "Resolved-Withdrawn",
          PermitStatus: null,
        },
      } satisfies ErpRow,
    });
    expect(withdrawn!.status).toBe("Withdrawn");
  });

  it("falls back to the contact as filer for legacy Reedy Creek rows", () => {
    const rec = sfwmdErpAdapter.normalize({
      externalId: "x",
      url: "u",
      fetchedAt: new Date(),
      body: {
        ...PROJECT_K,
        attributes: {
          ...PROJECT_K.attributes,
          ApplicantName: null,
          FullNameOrCompany: "Disneys Animal Kingdom",
        },
      } satisfies ErpRow,
    });
    expect(rec!.filer).toBe("Disneys Animal Kingdom");
  });

  it("rebuilds link text from the stored payload", () => {
    const rec = sfwmdErpAdapter.normalize({
      externalId: "250818-56114",
      url: "u",
      fetchedAt: new Date(),
      body: PROJECT_K,
    })!;
    expect(sfwmdErpAdapter.linkTextOf!(rec.payload)).toEqual(rec.linkText);
  });
});

describe("scoreErp", () => {
  const base = { parkId: null, polygonParkId: null, operator: null, resortSlug: null, links: [] };
  const rec = sfwmdErpAdapter.normalize({
    externalId: "250818-56114",
    url: "u",
    fetchedAt: new Date(),
    body: PROJECT_K,
  })!;

  it("ranks a conceptual approval with hundreds of acres above a small exemption", () => {
    const ca = scoreErp(
      { ...rec, payload: { ...rec.payload, permitType: "CA", projectAcres: 694 } },
      { operatorFiler: true, links: base },
    );
    const exem = scoreErp(
      { ...rec, payload: { ...rec.payload, permitType: "EXEM", projectAcres: null } },
      { operatorFiler: true, links: base },
    );
    const ind = scoreErp(rec, { operatorFiler: true, links: base });
    expect(ca).toBeGreaterThan(ind);
    expect(ind).toBeGreaterThan(exem);
    expect(exem).toBeGreaterThan(0);
  });

  it("rewards an approval transition", () => {
    const flat = scoreErp(rec, { operatorFiler: true, links: base });
    const approved = scoreErp(rec, {
      operatorFiler: true,
      links: base,
      statusTransition: { from: "Pending-TechnicalReview", to: "Approved" },
    });
    expect(approved).toBe(flat + 10);
  });
});
