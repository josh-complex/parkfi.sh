import { describe, expect, it } from "vite-plus/test";

import { prepareRecord } from "../ingest.ts";
import { parseCsvObjects } from "../faa/csv.ts";
import {
  FAA_SEARCH_URL,
  faaOeaaaAdapter,
  nearestPark,
  structureLabel,
  yearsToRead,
} from "./faa-oeaaa.ts";

import type { EntityCatalog } from "../link.ts";
import type { FilerAlias, ParkGeo } from "../types.ts";

const parks: ParkGeo[] = [
  {
    id: 7,
    slug: "epic-universe",
    name: "Epic Universe",
    resortSlug: "universal-orlando",
    operator: "universal",
    latitude: 28.4404,
    longitude: -81.4479,
    boundary: null,
  },
  {
    id: 1,
    slug: "magic-kingdom",
    name: "Magic Kingdom",
    resortSlug: "walt-disney-world",
    operator: "disney",
    latitude: 28.419,
    longitude: -81.5812,
    boundary: null,
  },
];
const aliases: FilerAlias[] = [
  {
    pattern: "UNIVERSAL CITY DEVELOPMENT%",
    operator: "universal",
    resortSlug: "universal-orlando",
  },
];
const catalog: EntityCatalog = { parks, attractions: [] };

// Header + one row in the archive's exact column set (trailing-space headers included).
const CSV =
  'STUDY (ASN),PRIOR ASN,STATUS,DETERMINATION,ENTERED DATE,RECEIVED DATE,COMPLETION DATE,EXPIRATION DATE,LATITUDE,LONGITUDE,SURVEY_ACCURACY,MARKING LIGHTING TYPE,MARKING LIGHTING TYPE OTHER,STRUCTURE NAME,STRUCTURE CITY,STRUCTURE COUNTY NAME,STRUCTURE COUNTY ID,STRUCTURE STATE,NEAREST AIRPORT,DISTANCE FROM AIRPORT,DIRECTION FROM AIRPORT,ON AIRPORT,PROPOSAL DESCRIPTION,LOCATION DESCRIPTION,NOTICE OF,DURATION,DURATION DAYS,DURATION MONTHS,WORK SCHEDULE BEGINNING DATE,WORK SCHEDULE ENDING DATE,DATE BUILT,FCC NUMBER,STRUCTURE TYPE,AGL HEIGHT DET,AGL HEIGHT DNE,AGL HEIGHT PROPOSED,ELEVATION,AMSL HEIGHT DET,AMSL HEIGHT DNE,AMSL HEIGHT PROPOSED,"REPRESENTATIVE NAME ","SPONSOR NAME ","SIGNATURE CONTROL NUMBER ","FREQUENCY_JSON "\n' +
  '2024-ASO-12952-OE,,Determined - No Hazard,No Hazard,2024-06-27,2024-06-27,2024-07-30,2026-01-30,28.4459,-81.4525,4D,,,Maxim Crane,Orlando,Orange,95,FL,ORLANDO INTL,52000,270,,Crawler crane for construction of new hotel,"Universal Blvd, Orlando FL",New Construction,Temporary,300,10,2024-07-15,2025-05-15,,,CRANE$MOBILE,250,,250,95,345,,345,Pat Person,Universal Forming Inc.,123-456,\n';

describe("faaOeaaaAdapter", () => {
  const row = parseCsvObjects(CSV)[0]!;

  it("computes the nearest park within the radius", () => {
    expect(nearestPark(28.4459, -81.4525, parks)).toEqual({ slug: "epic-universe", km: 0.76 });
    expect(nearestPark(28.9, -81.0, parks)).toBeNull();
  });

  it("normalizes a crane study with heights, dates and a PII-free payload", () => {
    const nearest = nearestPark(28.4459, -81.4525, parks);
    const out = faaOeaaaAdapter.normalize({
      externalId: row["STUDY (ASN)"]!,
      url: FAA_SEARCH_URL,
      fetchedAt: new Date(),
      body: { row, nearest },
    });
    expect(out).not.toBeNull();
    expect(out!.kind).toBe("airspace");
    expect(out!.externalId).toBe("2024-ASO-12952-OE");
    expect(out!.title).toBe("Mobile crane 250 ft — Maxim Crane");
    expect(out!.filer).toBe("Universal Forming Inc.");
    expect(out!.status).toBe("Determined - No Hazard");
    expect(out!.filedAt?.toISOString()).toBe("2024-06-27T12:00:00.000Z");
    expect(out!.statusAt?.toISOString()).toBe("2024-07-30T12:00:00.000Z");
    expect(out!.latitude).toBeCloseTo(28.4459, 4);
    expect(out!.payload.aglProposed).toBe(250);
    expect(out!.payload.nearestPark).toEqual({ slug: "epic-universe", km: 0.76 });
    expect(out!.alwaysKeep).toBe(true);
    expect(JSON.stringify(out!.payload)).not.toContain("Pat Person");
    expect(JSON.stringify(out!.payload)).not.toContain("123-456");
  });

  it("keeps a near-park crane through the pipeline without an operator, scored above a cell tower", () => {
    const nearest = nearestPark(28.4459, -81.4525, parks);
    const crane = prepareRecord(
      faaOeaaaAdapter,
      faaOeaaaAdapter.normalize({
        externalId: "x",
        url: FAA_SEARCH_URL,
        fetchedAt: new Date(),
        body: { row, nearest },
      })!,
      catalog,
      aliases,
    );
    expect(crane).not.toBeNull();
    expect(crane!.operator).toBeNull();
    const towerRow = {
      ...row,
      "STRUCTURE TYPE": "TOWER$ANTENNA",
      "AGL HEIGHT PROPOSED": "150",
      "AGL HEIGHT DET": "150",
      DURATION: "Permanent",
    };
    const tower = prepareRecord(
      faaOeaaaAdapter,
      faaOeaaaAdapter.normalize({
        externalId: "y",
        url: FAA_SEARCH_URL,
        fetchedAt: new Date(),
        body: { row: towerRow, nearest },
      })!,
      catalog,
      aliases,
    );
    expect(crane!.score).toBeGreaterThan(tower!.score);
  });

  it("labels structure codes and picks the years to read", () => {
    expect(structureLabel("CRANE$TOWER")).toBe("Tower crane");
    expect(structureLabel("AMUSEMENT_PARK_STRUCTURE")).toBe("Amusement park structure");
    expect(structureLabel("WEIRD$THING")).toBe("Weird");
    expect(yearsToRead(new Date("2026-09-06T12:00:00Z"), false)).toEqual([2026]);
    expect(yearsToRead(new Date("2026-01-15T12:00:00Z"), false)).toEqual([2025, 2026]);
    expect(yearsToRead(new Date("2026-09-06T12:00:00Z"), true)).toEqual([2024, 2025, 2026]);
  });
});
