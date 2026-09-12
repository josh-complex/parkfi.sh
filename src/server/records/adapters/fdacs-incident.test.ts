import { describe, expect, it } from "vite-plus/test";

import {
  fdacsIncidentAdapter,
  findReportContentId,
  reportUrl,
  type IncidentRow,
} from "./fdacs-incident.ts";

import type { ParsedIncident } from "../fdacs/report.ts";

const incident = (overrides: Partial<ParsedIncident> = {}): ParsedIncident => ({
  id: "4336b170dfdc5e965a162a7a",
  quarter: "2026Q2",
  facility: "disney",
  facilityLabel: "Disney World",
  date: "2026-04-06",
  ride: "Snow Stormers",
  park: null,
  description: "guest struck her head while riding the attraction resulting in a laceration",
  demographicsParsed: true,
  ...overrides,
});

function raw(i: ParsedIncident) {
  return {
    externalId: i.id,
    url: reportUrl("81386"),
    fetchedAt: new Date(),
    body: { incident: i, reportUpdatedOn: "2026-07-15" } satisfies IncidentRow,
  };
}

describe("fdacs-incident discovery", () => {
  it("finds the report link on the listing page", () => {
    const html = `<a href="/content/download/81386/file/exempt-facilities-report.pdf" title="MOU Exempt Facilities Report | opens in a new tab">Exempt Facilities Report: July 2026</a>`;
    expect(findReportContentId(html)).toBe("81386");
    expect(
      findReportContentId(
        `<a href="https://www.fdacs.gov/content/download/99/file/x-exempt-y.pdf">`,
      ),
    ).toBe("99");
    expect(findReportContentId(`<a href="/content/download/12/file/other.pdf">`)).toBeNull();
  });

  it("builds the ccmedia URL", () => {
    expect(reportUrl("81386")).toBe(
      "https://ccmedia.fdacs.gov/content/download/81386/file/exempt-facilities-report.pdf",
    );
  });
});

describe("fdacs-incident normalize", () => {
  it("maps a Disney row to an attributed incident with nothing about the guest", () => {
    const rec = fdacsIncidentAdapter.normalize(raw(incident()))!;
    expect(rec.kind).toBe("incident");
    expect(rec.externalId).toBe("4336b170dfdc5e965a162a7a");
    expect(rec.title).toBe("Snow Stormers — reported incident");
    expect(rec.filer).toBe("Walt Disney World");
    expect(rec.operator).toBe("disney");
    expect(rec.resortSlug).toBe("walt-disney-world");
    expect(rec.filedAt?.toISOString()).toBe("2026-04-06T12:00:00.000Z");
    expect(rec.jobKey).toBe("disney:snow-stormers");
    expect(rec.linkText).toEqual(["Snow Stormers"]);
    expect(rec.entityNames).toEqual(["Snow Stormers"]);
    expect(fdacsIncidentAdapter.entityNamesOf!(rec.payload)).toEqual(["Snow Stormers"]);
    expect(Object.keys(rec.payload).sort()).toEqual(
      ["date", "facility", "park", "quarter", "reportUpdatedOn", "ride"].sort(),
    );
    expect(fdacsIncidentAdapter.linkTextOf!(rec.payload)).toEqual(rec.linkText);
  });

  it("attributes Universal, SeaWorld and Busch Gardens; drops LEGOLAND", () => {
    expect(fdacsIncidentAdapter.normalize(raw(incident({ facility: "universal" })))).toMatchObject({
      operator: "universal",
      resortSlug: "universal-orlando",
      filer: "Universal Orlando",
    });
    expect(fdacsIncidentAdapter.normalize(raw(incident({ facility: "seaworld" })))).toMatchObject({
      operator: "seaworld",
      resortSlug: null,
    });
    expect(fdacsIncidentAdapter.normalize(raw(incident({ facility: "busch" })))).toMatchObject({
      operator: "seaworld",
      filer: "Busch Gardens Tampa Bay",
    });
    expect(fdacsIncidentAdapter.normalize(raw(incident({ facility: "legoland" })))).toBeNull();
  });

  it("carries an inline park name into the link text", () => {
    const rec = fdacsIncidentAdapter.normalize(
      raw(
        incident({ park: "Epcot", ride: "Mission: Space", quarter: "2004Q2", date: "2004-03-24" }),
      ),
    )!;
    expect(rec.linkText).toEqual(["Mission: Space", "Epcot"]);
  });
});
