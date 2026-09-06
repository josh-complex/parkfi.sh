import { describe, expect, it } from "vite-plus/test";

import { decodeXml, iterateCaseFiles, tagText, tdxfDate, tdxfStatusLabel } from "./tdxf.ts";

// Hand-built to the TDXF applications DTD shape (see tdxf.ts header).
export const SAMPLE_XML = `<?xml version="1.0" encoding="UTF-8"?>
<trademark-applications-daily>
<application-information>
<file-segments><file-segment>TRMK</file-segment>
<action-keys>
<action-key>NEW</action-key>
<case-file>
<serial-number>99123456</serial-number>
<registration-number>0000000</registration-number>
<transaction-date>20260811</transaction-date>
<case-file-header>
<filing-date>20260811</filing-date>
<status-code>630</status-code>
<status-date>20260812</status-date>
<mark-identification>DISNEY&apos;S LAKESHORE LODGE</mark-identification>
<mark-drawing-code>4000</mark-drawing-code>
<intent-to-use-currently-in>T</intent-to-use-currently-in>
<use-application-currently-in>F</use-application-currently-in>
</case-file-header>
<case-file-statements>
<case-file-statement><type-code>GS0431</type-code><text>Hotel &amp; resort lodging services</text></case-file-statement>
<case-file-statement><type-code>GS0411</type-code><text>Entertainment services, namely amusement park services</text></case-file-statement>
<case-file-statement><type-code>D10000</type-code><text>Disclaimer text</text></case-file-statement>
</case-file-statements>
<classifications>
<classification><international-code-total-no>2</international-code-total-no><international-code>043</international-code><international-code>041</international-code><us-code>100</us-code></classification>
</classifications>
<case-file-owners>
<case-file-owner><entry-number>1</entry-number><party-type>10</party-type><party-name>Disney Enterprises, Inc.</party-name><address-1>500 S Buena Vista St</address-1><city>Burbank</city><state>CA</state><country>US</country></case-file-owner>
</case-file-owners>
</case-file>
<case-file>
<serial-number>99999999</serial-number>
<case-file-header>
<filing-date>20260811</filing-date>
<status-code>700</status-code>
<registration-date>20260901</registration-date>
</case-file-header>
<case-file-owners>
<case-file-owner><party-name>Acme Widgets LLC</party-name><city>Austin</city><state>TX</state><country>US</country></case-file-owner>
</case-file-owners>
</case-file>
</action-keys>
</application-information>
</trademark-applications-daily>`;

describe("iterateCaseFiles", () => {
  it("extracts serial, header dates, mark, flags, classes, G&S and owners", () => {
    const files = [...iterateCaseFiles(SAMPLE_XML)];
    expect(files).toHaveLength(2);
    const cf = files[0]!;
    expect(cf.serial).toBe("99123456");
    expect(cf.transactionDate).toBe("20260811");
    expect(cf.filingDate).toBe("20260811");
    expect(cf.statusCode).toBe("630");
    expect(cf.statusDate).toBe("20260812");
    expect(cf.markText).toBe("DISNEY'S LAKESHORE LODGE");
    expect(cf.markDrawingCode).toBe("4000");
    expect(cf.intentToUse).toBe(true);
    expect(cf.useBased).toBe(false);
    expect(cf.classes).toEqual(["041", "043"]);
    expect(cf.goodsServices).toEqual([
      { class: "043", text: "Hotel & resort lodging services" },
      { class: "041", text: "Entertainment services, namely amusement park services" },
    ]);
    expect(cf.owners).toEqual([
      {
        name: "Disney Enterprises, Inc.",
        partyType: "10",
        city: "Burbank",
        state: "CA",
        country: "US",
      },
    ]);
  });

  it("tolerates missing optional elements", () => {
    const cf = [...iterateCaseFiles(SAMPLE_XML)][1]!;
    expect(cf.markText).toBeNull();
    expect(cf.intentToUse).toBeNull();
    expect(cf.classes).toEqual([]);
    expect(cf.goodsServices).toEqual([]);
    expect(cf.registrationDate).toBe("20260901");
    expect(cf.owners[0]?.name).toBe("Acme Widgets LLC");
  });
});

describe("helpers", () => {
  it("decodes entities and trims", () => {
    expect(decodeXml("A &amp; B &#x27;C&#39;")).toBe("A & B 'C'");
    expect(tagText("<a>  x   y </a>", "a")).toBe("x y");
    expect(tagText("<a></a>", "a")).toBeNull();
  });

  it("converts compact dates and labels status codes", () => {
    expect(tdxfDate("20260811")).toBe("2026-08-11");
    expect(tdxfDate("nope")).toBeNull();
    expect(tdxfStatusLabel("686")).toBe("Published for opposition");
    expect(tdxfStatusLabel("700")).toBe("Registered");
    expect(tdxfStatusLabel("612")).toBe("Abandoned");
    expect(tdxfStatusLabel(null)).toBeNull();
  });
});
