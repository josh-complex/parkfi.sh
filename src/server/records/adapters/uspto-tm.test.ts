import { describe, expect, it } from "vite-plus/test";

import { prepareRecord } from "../ingest.ts";
import { iterateCaseFiles } from "../uspto/tdxf.ts";
import { SAMPLE_XML } from "../uspto/tdxf.test.ts";
import { tsdrUrl, usptoTmAdapter } from "./uspto-tm.ts";

import type { EntityCatalog } from "../link.ts";
import type { FilerAlias } from "../types.ts";

const aliases: FilerAlias[] = [
  { pattern: "DISNEY ENTERPRISES%", operator: "disney", resortSlug: null },
  { pattern: "UNIVERSAL CITY STUDIOS%", operator: "universal", resortSlug: null },
];
const catalog: EntityCatalog = { parks: [], attractions: [] };

describe("usptoTmAdapter.normalize", () => {
  const [disney, acme] = [...iterateCaseFiles(SAMPLE_XML)];

  it("maps a case file to a trademark record with classes, G&S and a TSDR link", () => {
    const out = usptoTmAdapter.normalize({
      externalId: disney!.serial,
      url: tsdrUrl(disney!.serial),
      fetchedAt: new Date(),
      body: disney,
    });
    expect(out).not.toBeNull();
    expect(out!.kind).toBe("trademark");
    expect(out!.externalId).toBe("99123456");
    expect(out!.title).toBe("DISNEY'S LAKESHORE LODGE");
    expect(out!.filer).toBe("Disney Enterprises, Inc.");
    expect(out!.status).toBe("New application");
    expect(out!.filedAt?.toISOString()).toBe("2026-08-11T12:00:00.000Z");
    expect(out!.statusAt?.toISOString()).toBe("2026-08-12T12:00:00.000Z");
    expect(out!.description).toContain("Class 041 (entertainment & amusement park services)");
    expect(out!.description).toContain("Hotel & resort lodging services");
    expect(out!.payload.classes).toEqual(["041", "043"]);
    expect(out!.payload.intentToUse).toBe(true);
    expect(out!.url).toContain("tsdr.uspto.gov/#caseNumber=99123456");
    // Street address must not be carried.
    expect(JSON.stringify(out!.payload)).not.toContain("Buena Vista");
  });

  it("titles a design-only mark by serial", () => {
    const out = usptoTmAdapter.normalize({
      externalId: acme!.serial,
      url: tsdrUrl(acme!.serial),
      fetchedAt: new Date(),
      body: acme,
    });
    expect(out!.title).toBe("Design mark (serial 99999999)");
    expect(out!.status).toBe("Registered");
  });

  it("attributes by owner alias through the shared pipeline and scores 041 + ITU high", () => {
    const input = usptoTmAdapter.normalize({
      externalId: disney!.serial,
      url: tsdrUrl(disney!.serial),
      fetchedAt: new Date(),
      body: disney,
    })!;
    const p = prepareRecord(usptoTmAdapter, input, catalog, aliases);
    expect(p).not.toBeNull();
    expect(p!.operator).toBe("disney");
    expect(p!.resortSlug).toBeNull();
    expect(p!.score).toBeGreaterThanOrEqual(100);

    const other = usptoTmAdapter.normalize({
      externalId: acme!.serial,
      url: tsdrUrl(acme!.serial),
      fetchedAt: new Date(),
      body: acme,
    })!;
    expect(prepareRecord(usptoTmAdapter, other, catalog, aliases)).toBeNull();
  });

  it("throws on a body that is not a case file", () => {
    expect(() =>
      usptoTmAdapter.normalize({ externalId: "x", url: "u", fetchedAt: new Date(), body: null }),
    ).toThrow();
  });
});
