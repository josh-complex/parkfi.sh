import { describe, expect, it } from "vite-plus/test";

import { buildSodaFilter, orlandoSodaAdapter, permitUrl } from "./orlando-soda.ts";

import type { FilerAlias, ParkGeo, RawRecord } from "../types.ts";

// Verbatim row shape from the 2026-09-04 probe (plan Appendix A).
const row = {
  permit_number: "ELE2026-11872",
  application_type: "Electrical",
  worktype: "Repair",
  project_name: "ANNUAL FACILITY PERMIT UNIVERSAL VOLCANO BAY",
  permit_address: "6801 TURKEY LAKE RD",
  parcel_number: "282324750000010",
  property_owner_name: "UNIVERSAL CITY DEVELOPMENT PARTNERS",
  parcel_owner_name: "UNIVERSAL CITY DEVELOPMENT PAR",
  contractor_name: "ALL WIRED UP INC",
  contractor_address: "123 SHOULD NOT PERSIST",
  contractor_phone_number: "407-555-0100",
  estimated_cost: "2000",
  square_footage: "0",
  application_status: "Finaled",
  processed_date: "2026-04-09T00:00:00.000",
  issue_permit_date: "2026-04-20T00:00:00.000",
  final_date: "2026-04-27T00:00:00.000",
  geocoded_column: { type: "Point", coordinates: [-81.464578035, 28.476888988] },
  neighborhood: "Florida Center",
  ":updated_at": "2026-06-02T20:28:40.347Z",
  ":id": "row-5yrx-8gxc.2jbw",
};

const raw: RawRecord = {
  externalId: row.permit_number,
  url: permitUrl(row.permit_number),
  fetchedAt: new Date("2026-09-04T09:00:00Z"),
  body: row,
};

describe("orlandoSodaAdapter.normalize", () => {
  it("maps the row to a permit with dates, point, status and a PII-free payload", () => {
    const out = orlandoSodaAdapter.normalize(raw);
    expect(out).not.toBeNull();
    expect(out!.kind).toBe("permit");
    expect(out!.externalId).toBe("ELE2026-11872");
    expect(out!.title).toBe("ANNUAL FACILITY PERMIT UNIVERSAL VOLCANO BAY");
    expect(out!.filer).toBe("UNIVERSAL CITY DEVELOPMENT PARTNERS");
    expect(out!.status).toBe("Finaled");
    expect(out!.filedAt?.toISOString()).toBe("2026-04-09T12:00:00.000Z");
    // Status date = latest of the lifecycle dates (final_date here).
    expect(out!.statusAt?.toISOString()).toBe("2026-04-27T12:00:00.000Z");
    expect(out!.latitude).toBeCloseTo(28.4769, 3);
    expect(out!.longitude).toBeCloseTo(-81.4646, 3);
    expect(out!.address).toBe("6801 TURKEY LAKE RD");
    expect(out!.parcelId).toBe("282324750000010");
    expect(out!.payload.estimatedCost).toBe(2000);
    expect(out!.payload.squareFootage).toBe(0);
    expect(out!.payload.contractor).toBe("ALL WIRED UP INC");
    expect(JSON.stringify(out!.payload)).not.toContain("SHOULD NOT PERSIST");
    expect(JSON.stringify(out!.payload)).not.toContain("407-555");
    expect(out!.linkText).toContain("UNIVERSAL CITY DEVELOPMENT PAR");
  });

  it("builds a title from type + address when there is no project name", () => {
    const out = orlandoSodaAdapter.normalize({
      ...raw,
      body: {
        ...row,
        project_name: undefined,
        application_type: "Building Permit",
        worktype: "Fence",
      },
    });
    expect(out!.title).toBe("Building Permit · Fence — 6801 TURKEY LAKE RD");
  });

  it("returns null for a row without a permit number", () => {
    expect(
      orlandoSodaAdapter.normalize({ ...raw, body: { ...row, permit_number: "" } }),
    ).toBeNull();
  });

  it("throws on a non-object body (schema drift is loud, not silent)", () => {
    expect(() => orlandoSodaAdapter.normalize({ ...raw, body: null })).toThrow();
  });
});

describe("buildSodaFilter", () => {
  const aliases: FilerAlias[] = [
    {
      pattern: "UNIVERSAL CITY DEVELOPMENT%",
      operator: "universal",
      resortSlug: "universal-orlando",
    },
    { pattern: "%WEIRD_PATTERN", operator: "disney", resortSlug: null },
  ];
  const parks: ParkGeo[] = [
    {
      id: 5,
      slug: "universal-studios-florida",
      name: "USF",
      resortSlug: "universal-orlando",
      operator: "universal",
      latitude: 28.4777,
      longitude: -81.4684,
      boundary: null,
    },
    {
      id: 9,
      slug: "no-geo",
      name: "No geo",
      resortSlug: null,
      operator: null,
      latitude: null,
      longitude: null,
      boundary: null,
    },
  ];

  it("pushes prefix aliases down on all three name columns and a radius per park", () => {
    const where = buildSodaFilter({ aliases, parks });
    expect(where).toContain("upper(parcel_owner_name) like 'UNIVERSAL CITY DEVELOPMENT%'");
    expect(where).toContain("upper(property_owner_name) like 'UNIVERSAL CITY DEVELOPMENT%'");
    expect(where).toContain("upper(contractor_name) like 'UNIVERSAL CITY DEVELOPMENT%'");
    expect(where).toContain("within_circle(geocoded_column, 28.47770, -81.46840, 1200)");
    expect(where).not.toContain("WEIRD_PATTERN");
    expect(where).not.toContain("no-geo");
  });
});

describe("permitUrl", () => {
  it("points at the dataset explorer filtered to the permit", () => {
    const url = permitUrl("BLD2026-17549");
    expect(
      url.startsWith(
        "https://data.cityoforlando.net/Permitting/Permit-Applications/ryhf-m453/explore/query/",
      ),
    ).toBe(true);
    expect(decodeURIComponent(url)).toContain("permit_number = 'BLD2026-17549'");
  });
});
