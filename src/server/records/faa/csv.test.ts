import { describe, expect, it } from "vite-plus/test";

import { parseCsv, parseCsvObjects } from "./csv.ts";

describe("parseCsv", () => {
  it("handles quotes, doubled quotes, embedded newlines and CRLF", () => {
    const text = 'a,b,c\r\n1,"x, y","say ""hi"""\r\n2,"multi\nline",\n';
    expect(parseCsv(text)).toEqual([
      ["a", "b", "c"],
      ["1", "x, y", 'say "hi"'],
      ["2", "multi\nline", ""],
    ]);
  });

  it("keys rows by trimmed header and ignores blank trailing lines", () => {
    const text = "STUDY (ASN),SPONSOR NAME ,LATITUDE\n2026-ASO-1-OE,Acme,28.5\n\n";
    expect(parseCsvObjects(text)).toEqual([
      { "STUDY (ASN)": "2026-ASO-1-OE", "SPONSOR NAME": "Acme", LATITUDE: "28.5" },
    ]);
  });
});

import { parseCsvRecords } from "./csv.ts";

describe("parseCsvRecords (lenient, record-chunked)", () => {
  const header = "ASN,TEXT,JSON\n";
  it("keeps an unescaped inner quote literal and folds trailing overflow into the last column", () => {
    const text =
      header +
      '2026-ASO-1-OE,"a 20" beam",x\n' +
      '2026-ASO-2-OE,plain,"{\\"a\\":[\\"x\\",\\"y\\"]}"\n' +
      "2026-ASO-3-OE,short\n";
    const { rows, dropped } = parseCsvRecords(text, /^\d{4}-[A-Z]{3}-\d+-[A-Z]+,/m);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({ ASN: "2026-ASO-1-OE", TEXT: 'a 20" beam', JSON: "x" });
    expect(rows[1]!.ASN).toBe("2026-ASO-2-OE");
    expect(rows[1]!.TEXT).toBe("plain");
    // The broken final column is folded back together (lossily) rather than
    // spilling into extra columns.
    expect(Object.keys(rows[1]!)).toHaveLength(3);
    expect(rows[1]!.JSON.startsWith('{\\"a\\"')).toBe(true);
    expect(rows[1]!.JSON).toContain('\\"y\\"');
    expect(dropped).toBe(1);
  });

  it("contains a runaway quote to its own record", () => {
    const text = header + '2026-ASO-1-OE,"never closed,x\n2026-ASO-2-OE,fine,y\n';
    const { rows, dropped } = parseCsvRecords(text, /^\d{4}-[A-Z]{3}-\d+-[A-Z]+,/m);
    expect(rows.map((r) => r.ASN)).toEqual(["2026-ASO-2-OE"]);
    expect(dropped).toBe(1);
  });
});
