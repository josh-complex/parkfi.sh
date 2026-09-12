import { describe, expect, it } from "vite-plus/test";

import {
  effectiveChannel,
  matchesWatch,
  watchLabel,
  type FilingCandidate,
  type FilingWatchRow,
} from "./filingAlerts.ts";
import { filingPushBody, filingSubject, kindLabel } from "./filingFormat.ts";

function watch(overrides: Partial<FilingWatchRow> = {}): FilingWatchRow {
  return {
    id: 1,
    userId: "u1",
    resortSlug: null,
    parkId: null,
    entityKind: null,
    entityId: null,
    kinds: [],
    keywords: [],
    channel: "push",
    emailOptOut: false,
    ...overrides,
  };
}

function record(overrides: Partial<FilingCandidate> = {}): FilingCandidate {
  return {
    id: 10,
    source: "orlando_soda",
    kind: "permit",
    resortSlug: "universal-orlando",
    parkId: 5,
    parkName: "Universal Studios Florida",
    filer: "UNIVERSAL CITY DEVELOPMENT PAR",
    title: "SPC: USF SHOW BUILDING RENOVATION",
    description: null,
    status: "Open",
    url: "https://data.cityoforlando.net/permit/1",
    filedOn: "2026-09-01",
    score: 90,
    links: ["resort:universal-orlando", "park:5"],
    ...overrides,
  };
}

describe("matchesWatch — scope", () => {
  it("an unscoped watch matches anything", () => {
    expect(matchesWatch(watch(), record())).toBe(true);
  });

  it("resort scope excludes the other resort", () => {
    expect(matchesWatch(watch({ resortSlug: "walt-disney-world" }), record())).toBe(false);
    expect(matchesWatch(watch({ resortSlug: "universal-orlando" }), record())).toBe(true);
  });

  it("park scope accepts the record's own park_id", () => {
    expect(matchesWatch(watch({ parkId: 5 }), record({ links: [] }))).toBe(true);
    expect(matchesWatch(watch({ parkId: 6 }), record({ links: [] }))).toBe(false);
  });

  it("park scope also accepts a park entity link when park_id is null", () => {
    const r = record({ parkId: null, links: ["park:5"] });
    expect(matchesWatch(watch({ parkId: 5 }), r)).toBe(true);
  });

  it("entity scope requires the exact link", () => {
    const w = watch({ entityKind: "attraction", entityId: "1234" });
    expect(matchesWatch(w, record())).toBe(false);
    expect(matchesWatch(w, record({ links: ["attraction:1234"] }))).toBe(true);
  });

  it("scopes narrow cumulatively", () => {
    const w = watch({ resortSlug: "universal-orlando", parkId: 6 });
    expect(matchesWatch(w, record())).toBe(false);
  });
});

describe("matchesWatch — kinds and keywords", () => {
  it("empty kinds mean any kind", () => {
    expect(matchesWatch(watch(), record({ kind: "trademark" }))).toBe(true);
  });

  it("a kind list excludes other kinds", () => {
    const w = watch({ kinds: ["trademark", "patent_app"] });
    expect(matchesWatch(w, record())).toBe(false);
    expect(matchesWatch(w, record({ kind: "trademark" }))).toBe(true);
  });

  it("keywords match the title case-insensitively", () => {
    expect(matchesWatch(watch({ keywords: ["show building"] }), record())).toBe(true);
    expect(matchesWatch(watch({ keywords: ["villains"] }), record())).toBe(false);
  });

  it("keywords also match the description and the filer", () => {
    const r = record({ title: "SPC: B-6", description: "Interior fit-out for VILLAINS land" });
    expect(matchesWatch(watch({ keywords: ["villains"] }), r)).toBe(true);
    expect(matchesWatch(watch({ keywords: ["universal city"] }), record())).toBe(true);
  });

  it("any keyword matching is enough, and blank keywords never match", () => {
    expect(matchesWatch(watch({ keywords: ["nope", "show building"] }), record())).toBe(true);
    expect(matchesWatch(watch({ keywords: ["   "] }), record())).toBe(false);
  });
});

describe("effectiveChannel", () => {
  it("drops email when the user opted out of filing mail", () => {
    expect(effectiveChannel(watch({ channel: "both", emailOptOut: true }))).toBe("push");
    expect(effectiveChannel(watch({ channel: "email", emailOptOut: true }))).toBe(null);
  });

  it("passes through otherwise", () => {
    expect(effectiveChannel(watch({ channel: "both" }))).toBe("both");
    expect(effectiveChannel(watch({ channel: "email" }))).toBe("email");
    expect(effectiveChannel(watch({ channel: "push" }))).toBe("push");
  });
});

describe("watchLabel", () => {
  it("prefers the keyword, then the park, then the resort", () => {
    expect(watchLabel(watch({ keywords: ["villains"] }), record())).toBe("“villains” filings");
    expect(watchLabel(watch({ parkId: 5 }), record())).toBe("Universal Studios Florida");
    expect(watchLabel(watch({ resortSlug: "walt-disney-world" }), record())).toBe(
      "Walt Disney World",
    );
    expect(watchLabel(watch(), record())).toBe("your filing watch");
  });
});

describe("filing copy", () => {
  const rec = {
    id: 10,
    source: "orlando_soda",
    kind: "permit",
    title: "SPC: USF SHOW BUILDING RENOVATION",
    filer: "UNIVERSAL CITY DEVELOPMENT PAR",
    status: "Open",
    url: "https://example.gov/1",
    park: "Universal Studios Florida",
    filedOn: "2026-09-01",
  };

  it("names the record when one filing matched", () => {
    const subject = filingSubject({
      watchLabel: "Universal Orlando",
      count: 1,
      records: [rec],
      moreCount: 0,
    });
    expect(subject).toBe("Permit filed: SPC: USF SHOW BUILDING RENOVATION");
  });

  it("summarizes when several matched", () => {
    const subject = filingSubject({
      watchLabel: "Universal Orlando",
      count: 4,
      records: [rec],
      moreCount: 0,
    });
    expect(subject).toBe("4 new filings — Universal Orlando");
  });

  it("push body lists up to three titles and counts the rest", () => {
    const body = filingPushBody({
      watchLabel: "Universal Orlando",
      subject: "x",
      count: 5,
      records: [rec, { ...rec, id: 11 }, { ...rec, id: 12 }, { ...rec, id: 13 }],
      moreCount: 0,
    });
    expect(body.endsWith("+2 more")).toBe(true);
  });

  it("labels unknown kinds generically", () => {
    expect(kindLabel("trademark")).toBe("Trademark");
    expect(kindLabel("something_new")).toBe("Filing");
  });
});
