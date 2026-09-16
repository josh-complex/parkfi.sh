import { describe, expect, it } from "vite-plus/test";

import {
  attribute,
  ocpaParcel,
  parseParcels,
  parseRange,
  ftDate,
  isAbort,
  isTransient,
  ocflFastTrackAdapter,
  parseCursor,
  parseFolderResponse,
  parseWindow,
  permitNumber,
  PortalPushback,
  type FastTrackBody,
  type FolderRow,
} from "./ocfl-fasttrack.ts";

import type { RawRecord } from "../types.ts";

/** The live response for B25906558, verbatim (2026-09-15). */
const LIVE_ROW: FolderRow = {
  FOLDERRSN: "3404667",
  REFERENCEFILE: "B25906558",
  STATUS: "Issued",
  "FOLDER TYPE": "Commercial Permit",
  PROPERTY_ADDRESS: "1001 Epic Blvd",
  PROPERTY_ADDRESS_FULL: "1001 Epic Blvd, Orlando, FL 32819",
  "APPLY DATE": "11/07/25",
  "PROJECT NAME": "HB423 Waiver ***SPECIAL PROJECTS*** Site Work Only",
  FOLDERTYPE: "COM",
  STATUSCODE: "20",
  PROPERTYRSN: "1424742",
  PROPERTYROLL: "31-23-29-8851-01-000",
  ISSUEDATE: "03/31/2026",
};

describe("ocfl-fasttrack wire format", () => {
  it("unwraps the page method's JSON-in-a-string envelope", () => {
    expect(parseFolderResponse({ d: JSON.stringify([LIVE_ROW]) })).toHaveLength(1);
    expect(parseFolderResponse({ d: [LIVE_ROW] })).toHaveLength(1);
    // "No such permit" is an empty array, which is how the sweep detects a gap.
    expect(parseFolderResponse({ d: "[]" })).toEqual([]);
    expect(parseFolderResponse({})).toEqual([]);
  });

  it("reads both date shapes the feed mixes", () => {
    expect(ftDate("11/07/25")).toBe("2025-11-07");
    expect(ftDate("03/31/2026")).toBe("2026-03-31");
    expect(ftDate("")).toBeNull();
    expect(ftDate("pending")).toBeNull();
  });

  it("builds the county's permit-number shape", () => {
    expect(permitNumber("B", "25", 906558)).toBe("B25906558");
    expect(permitNumber("Z", "26", 926)).toBe("Z26000926");
  });

  it("parses a backfill window and rejects junk", () => {
    expect(parseWindow("2026-02-01..2026-02-28")).toEqual({
      from: "2026-02-01",
      to: "2026-02-28",
    });
    expect(parseWindow("feb 2026")).toBeNull();
  });
});

describe("ocfl-fasttrack parcel owners", () => {
  it("maps a Fast Track parcel to the appraiser's id (first three parts reversed)", () => {
    // Verified live: this parcel is UNIVERSAL CITY DEVELOPMENT PARTNERS / EPIC UNIVERSE.
    expect(ocpaParcel("31-23-29-8851-01-000")).toBe("292331885101000");
    expect(ocpaParcel("31-23-29-0000-00-001")).toBe("292331000000001");
    expect(ocpaParcel("not-a-parcel")).toBeNull();
    expect(ocpaParcel("")).toBeNull();
  });

  it("reads the parcel layer's response and survives an error envelope", () => {
    expect(
      parseParcels({
        features: [
          {
            attributes: {
              PARCEL: "292331885101000",
              NAME1: "UNIVERSAL CITY DEVELOPMENT PARTNERS LTD",
              PROP_NAME: "EPIC UNIVERSE",
              SITUS: "4700 W SAND LAKE RD",
            },
          },
        ],
      }),
    ).toEqual([
      {
        parcel: "292331885101000",
        owner: "UNIVERSAL CITY DEVELOPMENT PARTNERS LTD",
        propName: "EPIC UNIVERSE",
        situs: "4700 W SAND LAKE RD",
      },
    ]);
    expect(parseParcels({ error: { code: 400 } })).toEqual([]);
  });

  it("parses explicit sequence bounds", () => {
    expect(parseRange("900001..904200")).toEqual({ lo: 900001, hi: 904200 });
    expect(parseRange("904200..900001")).toBeNull();
    expect(parseRange("jan..jun")).toBeNull();
  });
});

describe("ocfl-fasttrack attribution", () => {
  it("claims a permit on the Epic parcel", () => {
    expect(attribute(LIVE_ROW)).toMatchObject({
      operator: "universal",
      resortSlug: "universal-orlando",
    });
  });

  it("claims a permit by campus address when the parcel is unknown", () => {
    expect(
      attribute({
        REFERENCEFILE: "Z26005529",
        PROPERTY_ADDRESS_FULL: "4500 Epic Blvd, Orlando, FL 32819",
      }),
    ).toMatchObject({ operator: "universal" });
  });

  it("leaves everyone else alone", () => {
    expect(
      attribute({
        REFERENCEFILE: "Z26008276",
        PROPERTY_ADDRESS_FULL: "5621 Destination Parkway, Orlando, FL 32819",
      }),
    ).toBeNull();
    expect(attribute({ REFERENCEFILE: "Z26003000" })).toBeNull();
  });
});

describe("ocfl-fasttrack cursor", () => {
  it("round-trips series watermarks and the backfill window", () => {
    const c = parseCursor({
      series: {
        "Z26:1": { next: 8277, seen: true, misses: 0, window: { lo: 926, hi: 1841, at: 1200 } },
        "E26:1": { next: 1, seen: false, misses: 40, done: true },
        junk: 5,
      },
      known: ["Z26005529", 7],
      recheckAt: 3,
    });
    expect(c.series["Z26:1"]).toEqual({
      next: 8277,
      seen: true,
      misses: 0,
      done: false,
      window: { lo: 926, hi: 1841, at: 1200, done: false },
    });
    expect(c.series["E26:1"]?.done).toBe(true);
    expect(c.series.junk).toBeUndefined();
    expect(c.known).toEqual(["Z26005529"]);
    expect(c.recheckAt).toBe(3);
  });

  it("defaults an empty cursor", () => {
    expect(parseCursor(null)).toEqual({
      blockedUntil: null,
      series: {},
      known: [],
      recheckAt: 0,
    });
  });

  it("carries the stand-down stamp", () => {
    expect(parseCursor({ blockedUntil: "2026-09-16T12:00:00.000Z" }).blockedUntil).toBe(
      "2026-09-16T12:00:00.000Z",
    );
    expect(parseCursor({ blockedUntil: 42 }).blockedUntil).toBeNull();
  });
});

describe("ocfl-fasttrack backoff", () => {
  it("treats the portal's 403/429/503 as a stop, not a failure", () => {
    expect(new PortalPushback(429).message).toContain("429");
  });

  it("knows a transient socket drop from a real bug", () => {
    // The live failure that lost a 4,000-request pass before this existed.
    expect(isTransient({ code: "ECONNRESET" })).toBe(true);
    expect(isTransient({ message: "The socket connection was closed unexpectedly" })).toBe(true);
    expect(isTransient({ message: "fetch failed" })).toBe(true);
    expect(isTransient(new TypeError("row.map is not a function"))).toBe(false);
  });

  it("recognises an aborted step however the runtime spells it", () => {
    expect(isAbort({ name: "TimeoutError" })).toBe(true);
    expect(isAbort({ name: "AbortError" })).toBe(true);
    expect(isAbort(new Error("boom"))).toBe(false);
  });
});

describe("ocfl-fasttrack normalize", () => {
  const raw = (row: FolderRow = LIVE_ROW): RawRecord => ({
    externalId: row.REFERENCEFILE!,
    url: `https://fasttrack.ocfl.net/OnlineServices/QuickSearch.aspx?Mode=F&Value=${row.REFERENCEFILE}`,
    fetchedAt: new Date("2026-09-15T10:00:00Z"),
    body: {
      row,
      operator: "universal",
      resortSlug: "universal-orlando",
      place: "Universal Epic Universe",
      pass: "watchlist",
    } satisfies FastTrackBody,
  });

  it("files the permit under its PROJECT NAME — the field that changes", () => {
    const rec = ocflFastTrackAdapter.normalize(raw())!;
    expect(rec.kind).toBe("permit");
    expect(rec.externalId).toBe("B25906558");
    expect(rec.title).toBe("HB423 Waiver ***SPECIAL PROJECTS*** Site Work Only");
    expect(rec.operator).toBe("universal");
    expect(rec.parcelId).toBe("31-23-29-8851-01-000");
    expect(rec.filedAt?.toISOString()).toBe("2025-11-07T12:00:00.000Z");
    expect(rec.statusAt?.toISOString()).toBe("2026-03-31T12:00:00.000Z");
    expect(rec.status).toBe("Issued");
    expect(rec.payload.projectName).toBe("HB423 Waiver ***SPECIAL PROJECTS*** Site Work Only");
    expect(ocflFastTrackAdapter.entityNamesOf!(rec.payload)).toEqual([
      "HB423 Waiver ***SPECIAL PROJECTS*** Site Work Only",
    ]);
  });

  it("groups the trade permits of one project by its name", () => {
    const a = ocflFastTrackAdapter.normalize(
      raw({ ...LIVE_ROW, REFERENCEFILE: "B26000001", "PROJECT NAME": "Sound Stage" }),
    )!;
    const b = ocflFastTrackAdapter.normalize(
      raw({ ...LIVE_ROW, REFERENCEFILE: "E26000002", "PROJECT NAME": "Sound Stage" }),
    )!;
    expect(a.jobKey).toBe(b.jobKey);
    expect(a.jobTitle).toBe("Sound Stage");
  });

  it("falls back to the folder type when a permit has no project name", () => {
    const rec = ocflFastTrackAdapter.normalize(
      raw({ ...LIVE_ROW, "PROJECT NAME": "", REFERENCEFILE: "B26000003" }),
    )!;
    expect(rec.title).toBe("Commercial Permit");
    expect(rec.jobKey).toBeNull();
  });
});
