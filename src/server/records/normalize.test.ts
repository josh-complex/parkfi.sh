import { describe, expect, it } from "vite-plus/test";

import {
  contentHash,
  diffPayload,
  latestDate,
  likeToRegExp,
  matchAlias,
  normalizeFiler,
  parseFloatingDate,
  toNumber,
} from "./normalize.ts";

import type { FilerAlias, PublicRecordInput } from "./types.ts";

describe("normalizeFiler", () => {
  it("uppercases, strips punctuation and trailing legal suffixes", () => {
    expect(normalizeFiler("Disney Enterprises, Inc.")).toBe("DISNEY ENTERPRISES");
    expect(normalizeFiler("Universal City Studios LLC")).toBe("UNIVERSAL CITY STUDIOS");
    expect(normalizeFiler("Walt Disney Parks and Resorts U.S., Inc.")).toBe(
      "WALT DISNEY PARKS AND RESORTS U S",
    );
  });

  it("keeps PARTNERS and the Socrata-truncated form intact", () => {
    expect(normalizeFiler("UNIVERSAL CITY DEVELOPMENT PARTNERS")).toBe(
      "UNIVERSAL CITY DEVELOPMENT PARTNERS",
    );
    expect(normalizeFiler("UNIVERSAL CITY DEVELOPMENT PAR")).toBe("UNIVERSAL CITY DEVELOPMENT PAR");
  });

  it("strips stacked suffixes but never the whole name", () => {
    expect(normalizeFiler("Acme Co Inc")).toBe("ACME");
    expect(normalizeFiler("Inc")).toBe("INC");
    expect(normalizeFiler("")).toBeNull();
    expect(normalizeFiler(null)).toBeNull();
  });
});

describe("matchAlias", () => {
  const aliases: FilerAlias[] = [
    {
      pattern: "UNIVERSAL CITY DEVELOPMENT%",
      operator: "universal",
      resortSlug: "universal-orlando",
    },
    { pattern: "DISNEY ENTERPRISES%", operator: "disney", resortSlug: null },
  ];

  it("matches prefixes, including truncated owner names", () => {
    expect(matchAlias("UNIVERSAL CITY DEVELOPMENT PAR", aliases)?.operator).toBe("universal");
    expect(matchAlias("UNIVERSAL CITY DEVELOPMENT PARTNERS", aliases)?.resortSlug).toBe(
      "universal-orlando",
    );
  });

  it("does not match tenants or substrings mid-name", () => {
    expect(matchAlias("DEZER ORLANDO CENTER", aliases)).toBeNull();
    expect(matchAlias("FRIENDS OF UNIVERSAL CITY DEVELOPMENT", aliases)).toBeNull();
    expect(matchAlias(null, aliases)).toBeNull();
  });

  it("treats LIKE metacharacters as LIKE, regex ones as literals", () => {
    expect(likeToRegExp("A_C%").test("ABC DEF")).toBe(true);
    expect(likeToRegExp("A.C%").test("ABC")).toBe(false);
    expect(likeToRegExp("A.C%").test("A.C")).toBe(true);
  });
});

describe("contentHash + diffPayload", () => {
  const base: PublicRecordInput = {
    kind: "permit",
    externalId: "BLD2026-1",
    url: "https://example.test/1",
    title: "Test",
    status: "Open",
    payload: { a: 1, b: "x" },
  };

  it("is stable across key order and ignores undefined", () => {
    const reordered = { ...base, payload: { b: "x", a: 1, c: undefined } };
    expect(contentHash(reordered)).toBe(contentHash(base));
  });

  it("changes when status or payload change", () => {
    expect(contentHash({ ...base, status: "Issued" })).not.toBe(contentHash(base));
    expect(contentHash({ ...base, payload: { a: 2, b: "x" } })).not.toBe(contentHash(base));
  });

  it("diffs only the changed keys, treating missing as null", () => {
    expect(diffPayload({ a: 1, b: "x" }, { a: 1, b: "y", c: 3 })).toEqual({
      b: ["x", "y"],
      c: [null, 3],
    });
    expect(diffPayload({ a: 1 }, { a: 1 })).toEqual({});
  });
});

describe("date + number helpers", () => {
  it("parses floating timestamps at UTC noon of the calendar day", () => {
    expect(parseFloatingDate("2018-01-12T00:00:00.000")?.toISOString()).toBe(
      "2018-01-12T12:00:00.000Z",
    );
    expect(parseFloatingDate("2026-09-04")?.toISOString()).toBe("2026-09-04T12:00:00.000Z");
    expect(parseFloatingDate("nope")).toBeNull();
    expect(parseFloatingDate(undefined)).toBeNull();
  });

  it("picks the latest of optional dates", () => {
    const a = new Date("2026-01-01T12:00:00Z");
    const b = new Date("2026-03-01T12:00:00Z");
    expect(latestDate(null, a, undefined, b)).toBe(b);
    expect(latestDate(null, undefined)).toBeNull();
  });

  it("coerces Socrata numeric strings", () => {
    expect(toNumber("2000")).toBe(2000);
    expect(toNumber("$1,250")).toBe(1250);
    expect(toNumber("")).toBeNull();
    expect(toNumber("n/a")).toBeNull();
  });
});
