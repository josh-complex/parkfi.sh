import { describe, expect, it } from "vite-plus/test";

import { parseExemptReport, splitIncidentText } from "./report.ts";

// Lines exactly as `unpdf` extracts them from the 2026-07 report, trimmed to
// two current quarters plus the malformed 2019 header and 2003–04 forms.
const SAMPLE = `The following report is a compilation of data collected from the exempt facilities and reflects only the information reported at the time
of the incident. Due to privacy-related concerns, the Department does not receive updates to initial assessments of a patron’s
condition.
MOU Exempt Facilities Report
Updated: July 15, 2026
2nd Quarter 2026 (April - July 2026)
Sea World: None Reported
Busch Gardens: None Reported
Disney World: 4/6/26 Snow Stormers, 41 yof, guest struck her head while riding the attraction
resulting in a laceration
4/24/26 It’s A Small World, 54 yom, guest with pre-existing condition
experienced a cardiac emergency on the attraction, was transported to the
hospital and later passed away
Universal: 5/3/26 Jurassic World VelociCoaster, 17 yof, loss of consciousness
5/25/26 Jurassic World VelociCoaster, 53 yom, weakness and shortness of breath
(pre-existing condition)
Legoland None Reported
1st Quarter 2026 (January – March 2026)
Sea World: 1/20/26 Manta, 42 yof, reported nausea and vomiting after riding
Busch Gardens: None Reported
Disney World: 2/2/26 Prince Charming Regal Carrousel, 65 yof, Guest fell while exiting the
attraction and injured her pelvis
Universal: 1/23/26 Hogwarts Express, 34 yom, seizure
<<<PAGE>>>
The following report is a compilation of data collected from the exempt facilities and reflects only the information reported at the time
of the incident. Due to privacy-related concerns, the Department does not receive updates to initial assessments of a patron’s
condition.
2/4/26 Jimmy Fallon’s Race Through New York, 58 yof, stroke symptoms (pre-
existing condition)
Legoland: 2/10/26 Dragon Coaster, 9 yom, bumped head
4th Quarter (October – December 2019)
Sea World: 12/28/18 Sea Carousel, 68, yof, right hip pain
Disney: 11/2/19 Slinky Dog Dash, 40’s yom, felt unwell
Universal: 10/6/19 Roa’s Rapids Speed River, female, age unknown, found unconscious
2nd Quarter 2004 (April – June, 2004)
Disney World: 07/22/04 MGM, Great Movie Ride, 64 yof, chest pains
03/24/04 Epcot, Chest Pains, 59 year old female, Mission: Space
02/16/04 Disney’s Blizzard Beach, 41 year old female, injured ankle getting into
raft
Sea World None reported
`;

describe("parseExemptReport", () => {
  const r = parseExemptReport(SAMPLE);

  it("reads the update date, every quarter header, and the none-reported lines", () => {
    expect(r.updatedOn).toBe("2026-07-15");
    expect(r.quarters).toEqual(["2026Q2", "2026Q1", "2019Q4", "2004Q2"]);
    expect(r.noneReported).toBe(5);
    expect(r.malformed).toBe(0);
  });

  it("folds wrapped lines into the row and drops page boilerplate", () => {
    const small = r.incidents.find((i) => i.ride === "It’s A Small World")!;
    expect(small.description).toBe(
      "guest with pre-existing condition experienced a cardiac emergency on the attraction, was transported to the hospital and later passed away",
    );
    const fallon = r.incidents.find((i) => i.ride.startsWith("Jimmy Fallon"))!;
    expect(fallon.facility).toBe("universal");
    expect(fallon.quarter).toBe("2026Q1");
    expect(fallon.description).toBe("stroke symptoms (pre- existing condition)");
  });

  it("never carries the guest's age or sex", () => {
    for (const i of r.incidents) {
      expect(JSON.stringify(i)).not.toMatch(/\b(yof|yom|year old|female|male)\b/);
      expect(i.demographicsParsed).toBe(true);
    }
  });

  it("tolerates the year-less 2019 header, comma'd and decade ages, and 'age unknown'", () => {
    const q = r.incidents.filter((i) => i.quarter === "2019Q4");
    expect(q.map((i) => [i.facility, i.ride, i.date])).toEqual([
      ["seaworld", "Sea Carousel", "2018-12-28"],
      ["disney", "Slinky Dog Dash", "2019-11-02"],
      ["universal", "Roa’s Rapids Speed River", "2019-10-06"],
    ]);
  });

  it("splits the 2003–04 park-first rows", () => {
    const old = r.incidents.filter((i) => i.quarter === "2004Q2");
    expect(old.map((i) => [i.park, i.ride, i.description])).toEqual([
      ["MGM", "Great Movie Ride", "chest pains"],
      ["Epcot", "Mission: Space", "Chest Pains"],
      ["Disney’s Blizzard Beach", "Disney’s Blizzard Beach", "injured ankle getting into raft"],
    ]);
  });

  it("keeps LEGOLAND rows (the adapter drops them) and gives stable unique ids", () => {
    expect(r.incidents.some((i) => i.facility === "legoland")).toBe(true);
    const ids = r.incidents.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(parseExemptReport(SAMPLE).incidents.map((i) => i.id)).toEqual(ids);
    expect(ids[0]).toMatch(/^[0-9a-f]{24}$/);
  });
});

describe("splitIncidentText", () => {
  it("strips the demographics token wherever it sits", () => {
    expect(splitIncidentText("Manta, 42 yof, reported nausea")).toEqual({
      ride: "Manta",
      park: null,
      description: "reported nausea",
      age: "42",
      sex: "f",
    });
    expect(splitIncidentText("Sea Carousel, 68, yof, right hip pain")?.description).toBe(
      "right hip pain",
    );
    expect(splitIncidentText("Dumbo, 40’s yom, Came off ride not feeling well.")).toMatchObject({
      ride: "Dumbo",
      age: "40",
      sex: "m",
    });
  });

  it("rejects a row with no ride", () => {
    expect(splitIncidentText("41 yof")).toBeNull();
  });
});
