import { describe, expect, it } from "vite-plus/test";

import { scoreLicense } from "../score.ts";

import {
  dbprDate,
  dbprFoodAdapter,
  dbprRows,
  isPlanReview,
  normalizeRow,
  type DbprRow,
} from "./dbpr-food.ts";

import type { FilerAlias, PublicRecordInput, RawRecord } from "../types.ts";

const ALIASES: FilerAlias[] = [
  {
    pattern: "UNIVERSAL CITY DEVELOPMENT%",
    operator: "universal",
    resortSlug: "universal-orlando",
  },
  { pattern: "WALT DISNEY PARKS%", operator: "disney", resortSlug: null },
];

/** The extract's real shape: 38 header columns, 36 columns of data. */
const HEADER = [
  "Application Number",
  "Application Type",
  "Application Approval Date ",
  "Board Code",
  "License Type Code",
  "Licensee Name",
  "Rank Code",
  "Modifier Code",
  "Mailing Name",
  "Mailing Street Address",
  "Mailing Address Line 2",
  "Mailing Address Line 3",
  "Mailing City",
  "Mailing State Code",
  "Mailing Zip Code",
  "Primary Phone Number",
  "Mailing County Code",
  "Business Name",
  "Filler",
  "Location Street Address",
  "Location Address Line 2",
  "Location Address Line 3",
  "Location City",
  "Location State Code",
  "Location Zip Code",
  "Location County Code",
  "Location County",
  "Secondary Phone Number",
  "District",
  "Region",
  "License Number",
  "Primary Status Code",
  "Secondary Status Code",
  "License Expiry Date",
  "Last Inspection Date",
  "Number of Seats",
  "Base Risk Level",
  "Secondary Risk Level",
];

function row(overrides: Record<string, string> = {}): Record<string, string> {
  const base: Record<string, string> = {
    "Application Number": "1858469",
    "Application Type": "Plan Review and Initial (COMBO SEAT)",
    "Application Approval Date ": "09/02/2026",
    "Licensee Name": "UNIVERSAL CITY DEVELOPMENT PARTNERS LTD",
    "Business Name": "THE EPICENTER",
    "Location Street Address": "4700 W SAND LAKE RD",
    "Location City": "ORLANDO",
    "Location County": "ORANGE",
    "License Number": "SEA5816999",
    "Primary Status Code": "20",
    "Number of Seats": "1400",
  };
  return { ...base, ...overrides };
}

describe("dbpr-food parsing", () => {
  it("reads rows that carry fewer columns than the header declares", () => {
    // 38 header names, 36 values — the agency's own files do exactly this, and
    // a strict parser drops every row.
    const values = HEADER.slice(0, 36).map((_, i) => `v${i}`);
    const csv = `${HEADER.map((h) => `"${h}"`).join(",")}\n${values.map((v) => `"${v}"`).join(",")}\n\n`;
    const rows = dbprRows(csv);
    expect(rows).toHaveLength(1);
    expect(rows[0]!["Application Number"]).toBe("v0");
    expect(rows[0]!["Number of Seats"]).toBe("v35");
    expect(rows[0]!["Base Risk Level"]).toBeUndefined();
  });

  it("normalizes both date shapes", () => {
    expect(dbprDate("09/02/2026")).toBe("2026-09-02");
    expect(dbprDate("2026-09-02T00:00:00")).toBe("2026-09-02");
    expect(dbprDate("")).toBeNull();
  });

  it("knows a plan review from an issued licence", () => {
    expect(isPlanReview("Plan Review and Initial (COMBO SEAT)")).toBe(true);
    expect(isPlanReview("Issue Initial License")).toBe(false);
  });
});

describe("dbpr-food attribution", () => {
  it("takes the operator from the licensee name", () => {
    const r = normalizeRow(row(), "new", ALIASES)!;
    expect(r.operator).toBe("universal");
    expect(r.resortSlug).toBe("universal-orlando");
    expect(r.businessName).toBe("THE EPICENTER");
    expect(r.approvedOn).toBe("2026-09-02");
    expect(r.seats).toBe(1400);
  });

  it("keeps a partner's licence at an on-property address", () => {
    // Helios Grand's licensee is a hotel venture, not an alias match.
    const r = normalizeRow(
      row({ "Licensee Name": "UCF HOTEL VENTURE VI", "Location Street Address": "5500 EPIC BLVD" }),
      "new",
      ALIASES,
    )!;
    expect(r.operator).toBe("universal");
    expect(r.place).toBe("Epic Universe campus");
  });

  it("drops the same street name in another city", () => {
    // "37 EPIC BLVD" is a McDonald's in Saint Augustine.
    expect(
      normalizeRow(
        row({
          "Licensee Name": "CORAL RIDGE FOODS INC",
          "Location Street Address": "37 EPIC BLVD",
          "Location City": "SAINT AUGUSTINE",
        }),
        "new",
        ALIASES,
      ),
    ).toBeNull();
  });

  it("drops a stranger at a stranger's address", () => {
    expect(
      normalizeRow(
        row({ "Licensee Name": "HUB 925 LLC", "Location Street Address": "7594 W SAND LAKE RD" }),
        "new",
        ALIASES,
      ),
    ).toBeNull();
  });
});

describe("dbpr-food normalize", () => {
  const raw = (over: Partial<DbprRow> & { previousName?: string | null } = {}): RawRecord => ({
    externalId: "new:SEA5816999",
    url: "https://www2.myfloridalicense.com/hotels-restaurants/public-records/",
    fetchedAt: new Date("2026-09-20T10:00:00Z"),
    body: { ...normalizeRow(row(), "new", ALIASES)!, ...over },
  });

  it("files a pre-opening plan review under the venue's own trade name", () => {
    const rec = dbprFoodAdapter.normalize(raw())!;
    expect(rec.kind).toBe("license");
    expect(rec.title).toBe("THE EPICENTER — plan review — pre-opening");
    expect(rec.operator).toBe("universal");
    expect(rec.filedAt?.toISOString()).toBe("2026-09-02T12:00:00.000Z");
    expect(rec.payload.planReview).toBe(true);
    expect(rec.entityNames).toEqual(["THE EPICENTER"]);
    expect(dbprFoodAdapter.linkTextOf!(rec.payload)).toEqual(rec.linkText);
  });

  it("says what a renamed licence used to be called", () => {
    const rec = dbprFoodAdapter.normalize(raw({ event: "renamed", previousName: "SOUND STAGE" }))!;
    expect(rec.title).toBe("THE EPICENTER — licence renamed from SOUND STAGE");
    expect(rec.payload.previousName).toBe("SOUND STAGE");
  });
});

describe("dbpr-food scoring", () => {
  const input = (payload: Record<string, unknown>) =>
    ({ kind: "license", payload }) as unknown as PublicRecordInput;
  const ctx = (kinds: string[] = []) =>
    ({
      operatorFiler: true,
      links: {
        parkId: 7,
        links: kinds.map((entityKind) => ({ entityKind, entityId: "1" })),
      },
    }) as never;

  it("ranks a rename over a plan review over a cart over a known venue", () => {
    const renamed = scoreLicense(input({ event: "renamed", seats: 1400 }), ctx());
    const planReview = scoreLicense(input({ event: "new", planReview: true, seats: 1400 }), ctx());
    const cart = scoreLicense(input({ event: "new", seats: 0 }), ctx());
    const known = scoreLicense(input({ event: "new", seats: 120 }), ctx(["facility"]));
    expect(renamed).toBeGreaterThan(planReview);
    expect(planReview).toBeGreaterThan(cart);
    expect(cart).toBeGreaterThan(known);
  });
});
