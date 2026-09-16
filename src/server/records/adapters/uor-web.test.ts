import { describe, expect, it } from "vite-plus/test";

import { scoreWebPage } from "../score.ts";

import {
  pageBody,
  parseCursor,
  normalizeSalesPath,
  parseSitemap,
  pathTitle,
  salesLinks,
  sitePath,
  trimSiteSuffix,
  tridionField,
  uorWebAdapter,
  type PageBody,
  type RemovedBody,
} from "./uor-web.ts";

import type { AdapterContext, PublicRecordInput, RawRecord } from "../types.ts";

/** One contentdata page document, trimmed to the shape the adapter reads. */
const CELESTIAL_PARK_DOC = {
  RevisionDate: "2025-05-09T18:36:37.033Z",
  LastPublishedDate: "0001-01-01T00:00:00",
  Filename: "index",
  Publication: { Id: "tcm:0-156-1", Title: "060 UO Meetings and Events (EN-US)" },
  Title: "100 GDS - UO Meetings and Events - Celestial Park",
  ComponentPresentations: [
    {
      Component: {
        Fields: {
          SEOTitle: {
            Name: "SEOTitle",
            Values: ["Meeting and Event Venues at Universal Epic Universe’s Celestial Park"],
          },
          SEODescription: {
            Name: "SEODescription",
            Values: [
              "Discover meeting and event venues at Celestial Park. Book your group meetings and events in the cosmic heart of Universal Epic Universe.",
            ],
          },
          SEOCanonicalURL: {
            Name: "SEOCanonicalURL",
            Values: [
              "https://www.uomeetingsandevents.com/en/us/events/universal-epic-universe/celestial-park",
            ],
          },
        },
      },
    },
  ],
};

function ctxWith(routes: Record<string, unknown>, log: string[] = []): AdapterContext {
  return {
    fetch: (async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const hit = Object.entries(routes).find(([pattern]) => url.includes(pattern));
      if (!hit) return new Response("nope", { status: 404 });
      const body = hit[1];
      if (typeof body === "string")
        return new Response(body, { status: 200, headers: { "content-type": "application/xml" } });
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch,
    log: (m) => log.push(m),
    signal: AbortSignal.timeout(10_000),
    parks: [],
    aliases: [],
    backfillFrom: "2019-01-01",
  };
}

const sitemap = (paths: string[]) =>
  `<?xml version="1.0"?><urlset>${paths
    .map((p) => `<url><loc>https://www.universalorlando.com/web/en/us${p}</loc></url>`)
    .join("")}</urlset>`;

const coveo = (paths: string[]) => ({
  totalCount: paths.length,
  results: paths.map((p) => ({
    clickUri: `https://www.uomeetingsandevents.com/uomeetingsandevents/en/us${p}`,
  })),
});

const PAGEINFO = {
  ResourceList: { coveoAccessToken: "xxtoken", coveoSearchHub: "UOR_MeetingAndEvents_Hub" },
};

function routes(consumer: string[], meetings: string[], doc: unknown = CELESTIAL_PARK_DOC) {
  return {
    "/web/en/us/sitemap.xml": sitemap(consumer),
    "/api/pageinfo.html": PAGEINFO,
    "platform.cloud.coveo.com": coveo(meetings),
    "/index.html": doc,
  };
}

describe("uor-web inventory parsing", () => {
  it("strips each publication's locale prefix", () => {
    expect(
      sitePath("https://www.universalorlando.com/web/en/us/things-to-do/x", ["/web/en/us"]),
    ).toBe("/things-to-do/x");
    expect(sitePath("https://x/uomeetingsandevents/en/us", ["/uomeetingsandevents/en/us"])).toBe(
      "/",
    );
    expect(sitePath("https://x/en/us/hotels/", ["/uomeetingsandevents/en/us", "/en/us"])).toBe(
      "/hotels",
    );
    expect(sitePath("https://x/elsewhere/page", ["/web/en/us"])).toBeNull();
  });

  it("reads a sitemap and drops boilerplate sections", () => {
    const xml = sitemap(["/things-to-do/events/universal-nights", "/faqs/tickets", "/legal/terms"]);
    expect(parseSitemap(xml, ["/web/en/us"])).toEqual(["/things-to-do/events/universal-nights"]);
  });
});

describe("uor-web trade microsite crawl", () => {
  it("normalizes the /sales paths a page document links to", () => {
    expect(normalizeSalesPath("/web/en/us/sales/epic-universe/worlds/dark-universe/index")).toBe(
      "/sales/epic-universe/worlds/dark-universe",
    );
    expect(normalizeSalesPath("/sales/theme-parks/epic-universe/")).toBe(
      "/sales/theme-parks/epic-universe",
    );
    expect(normalizeSalesPath("/things-to-do/rides")).toBeNull();
  });

  it("pulls every sibling trade link out of one document, de-duplicated", () => {
    const doc = JSON.stringify({
      a: "https://www.universalorlando.com/web/en/us/sales/epic-universe/worlds/celestial-park",
      b: "/sales/epic-universe/worlds/dark-universe/index",
      c: "/sales/epic-universe/worlds/dark-universe",
      d: "/things-to-do/dining/atlantic",
    });
    expect(salesLinks(doc).sort()).toEqual([
      "/sales/epic-universe/worlds/celestial-park",
      "/sales/epic-universe/worlds/dark-universe",
    ]);
  });
});

describe("uor-web page bodies", () => {
  it("pulls SEO fields out of a Tridion document by field name", () => {
    expect(tridionField(CELESTIAL_PARK_DOC, "SEOTitle")).toBe(
      "Meeting and Event Venues at Universal Epic Universe’s Celestial Park",
    );
    expect(tridionField(CELESTIAL_PARK_DOC, "NoSuchField")).toBeNull();
  });

  it("keeps the revision date and drops Tridion's null-date sentinel", () => {
    const body = pageBody(
      "uomeetingsandevents",
      "/events/universal-epic-universe/celestial-park",
      "https://www.uomeetingsandevents.com/en/us/events/universal-epic-universe/celestial-park",
      CELESTIAL_PARK_DOC,
    )!;
    expect(body.revisionDate).toBe("2025-05-09T18:36:37.033Z");
    expect(body.cmsTitle).toBe("100 GDS - UO Meetings and Events - Celestial Park");
    expect(
      pageBody("uor", "/x", "https://x", {
        ...CELESTIAL_PARK_DOC,
        RevisionDate: "0001-01-01T00:00:00",
      })!.revisionDate,
    ).toBeNull();
  });

  it("titles a body-less page from its slug", () => {
    expect(pathTitle("/events/universal-epic-universe/the-epicenter")).toBe("The Epicenter");
    expect(trimSiteSuffix("Universal Nights | Universal Orlando Resort™")).toBe("Universal Nights");
  });
});

describe("uor-web diffing", () => {
  it("seeds every inventory on the first run and files nothing", async () => {
    const log: string[] = [];
    const ctx = ctxWith(routes(["/things-to-do/a", "/things-to-do/b"], ["/hotels"]), log);
    const res = await uorWebAdapter.fetchSince(null, ctx);
    expect(res.records).toEqual([]);
    const pages = parseCursor(res.cursor).pages;
    expect(pages.uor).toEqual(["/things-to-do/a", "/things-to-do/b"]);
    expect(pages.uomeetingsandevents).toEqual(["/hotels"]);
    // The trade microsite is crawled from its seeds, so it seeds too.
    expect(pages.uor_sales?.every((p) => p.startsWith("/sales"))).toBe(true);
    expect(log.join(" ")).toContain("seeded");
  });

  it("files only paths the inventory has never listed", async () => {
    const ctx = ctxWith(
      routes(["/things-to-do/a"], ["/hotels", "/events/universal-epic-universe/the-epicenter"]),
    );
    const res = await uorWebAdapter.fetchSince(
      { pages: { uor: ["/things-to-do/a"], uomeetingsandevents: ["/hotels"] } },
      ctx,
    );
    expect(res.records.map((r) => r.externalId)).toEqual([
      "uomeetingsandevents:/events/universal-epic-universe/the-epicenter",
    ]);
    expect(parseCursor(res.cursor).pages.uomeetingsandevents).toContain(
      "/events/universal-epic-universe/the-epicenter",
    );
  });

  it("treats a wholesale inventory change as a URL rewrite, not 200 stories", async () => {
    const many = Array.from({ length: 80 }, (_, i) => `/es/things-to-do/${i}`);
    const log: string[] = [];
    const ctx = ctxWith(routes(many, ["/hotels"]), log);
    const res = await uorWebAdapter.fetchSince(
      { pages: { uor: ["/things-to-do/a"], uomeetingsandevents: ["/hotels"] } },
      ctx,
    );
    expect(res.records).toEqual([]);
    expect(log.join(" ")).toContain("re-seeded");
  });

  it("gives a vanished page a grace run before filing it as removed", async () => {
    const log: string[] = [];
    const prior = {
      pages: { uor: ["/things-to-do/a", "/things-to-do/gone"], uomeetingsandevents: ["/hotels"] },
    };
    // Run 1: the path is missing, but one miss is not enough.
    const first = await uorWebAdapter.fetchSince(
      prior,
      ctxWith(routes(["/things-to-do/a"], ["/hotels"]), log),
    );
    expect(first.records).toEqual([]);
    const afterFirst = parseCursor(first.cursor);
    expect(afterFirst.pages.uor).toContain("/things-to-do/gone");
    expect(afterFirst.missing.uor).toEqual({ "/things-to-do/gone": 1 });
    expect(log.join(" ")).toContain("grace window");

    // Run 2: still missing → filed, and dropped from the inventory.
    const second = await uorWebAdapter.fetchSince(
      first.cursor,
      ctxWith(routes(["/things-to-do/a"], ["/hotels"])),
    );
    expect(second.records.map((r) => r.externalId)).toEqual(["uor:/things-to-do/gone#removed"]);
    const afterSecond = parseCursor(second.cursor);
    expect(afterSecond.pages.uor).not.toContain("/things-to-do/gone");
    expect(afterSecond.missing.uor).toEqual({});
  });

  it("forgets the miss when a page comes back inside the grace window", async () => {
    const prior = {
      pages: { uor: ["/things-to-do/a", "/things-to-do/flaky"], uomeetingsandevents: ["/hotels"] },
      missing: { uor: { "/things-to-do/flaky": 1 } },
    };
    const res = await uorWebAdapter.fetchSince(
      prior,
      ctxWith(routes(["/things-to-do/a", "/things-to-do/flaky"], ["/hotels"])),
    );
    expect(res.records).toEqual([]);
    expect(parseCursor(res.cursor).missing.uor).toEqual({});
  });

  it("does not file removals when the whole inventory vanishes", async () => {
    const known = Array.from({ length: 80 }, (_, i) => `/things-to-do/${i}`);
    const log: string[] = [];
    const ctx = ctxWith(routes(["/things-to-do/1"], ["/hotels"]), log);
    const res = await uorWebAdapter.fetchSince(
      { pages: { uor: known, uomeetingsandevents: ["/hotels"] } },
      ctx,
    );
    expect(res.records).toEqual([]);
    expect(log.join(" ")).toContain("re-seeded");
  });

  it("holds a publication's inventory when its listing breaks", async () => {
    const log: string[] = [];
    // No sitemap route → the consumer listing 404s; the B2B side still runs.
    const ctx = ctxWith(
      { "/api/pageinfo.html": PAGEINFO, "platform.cloud.coveo.com": coveo(["/hotels"]) },
      log,
    );
    const prior = { pages: { uor: ["/things-to-do/a"], uomeetingsandevents: ["/hotels"] } };
    const res = await uorWebAdapter.fetchSince(prior, ctx);
    expect(res.records).toEqual([]);
    expect(parseCursor(res.cursor).pages.uor).toEqual(["/things-to-do/a"]);
    expect(log.join(" ")).toContain("listing failed");
  });
});

describe("uor-web normalize", () => {
  const raw = (body: Partial<PageBody> = {}): RawRecord => ({
    externalId: "uomeetingsandevents:/events/universal-epic-universe/the-epicenter",
    url: "https://www.uomeetingsandevents.com/en/us/events/universal-epic-universe/the-epicenter",
    fetchedAt: new Date("2027-01-04T10:00:00Z"),
    body: {
      publication: "uomeetingsandevents",
      path: "/events/universal-epic-universe/the-epicenter",
      url: "https://www.uomeetingsandevents.com/en/us/events/universal-epic-universe/the-epicenter",
      seoTitle: "The Epicenter Event Venue at Universal Epic Universe | Universal Orlando Resort™",
      seoDescription: "Host your event at The Epicenter, the new event venue in Celestial Park.",
      canonicalUrl: null,
      revisionDate: "2027-01-03T18:36:37.033Z",
      cmsTitle: "100 GDS - UO Meetings and Events - The Epicenter",
      ...body,
    } satisfies PageBody,
  });

  it("files the page as an operator-attributed record dated by its CMS revision", () => {
    const rec = uorWebAdapter.normalize(raw())!;
    expect(rec.kind).toBe("web_page");
    expect(rec.title).toBe("The Epicenter Event Venue at Universal Epic Universe");
    expect(rec.operator).toBe("universal");
    expect(rec.resortSlug).toBe("universal-orlando");
    expect(rec.filedAt?.toISOString()).toBe("2027-01-03T18:36:37.033Z");
    expect(rec.jobKey).toBeUndefined();
    expect(rec.payload.publication).toBe("uomeetingsandevents");
    expect(uorWebAdapter.entityNamesOf!(rec.payload)).toEqual([
      "The Epicenter Event Venue at Universal Epic Universe",
    ]);
    expect(uorWebAdapter.linkTextOf!(rec.payload)).toEqual(rec.linkText);
  });

  it("falls back to the slug and the fetch time when the body never loaded", () => {
    const rec = uorWebAdapter.normalize(
      raw({ seoTitle: null, seoDescription: null, revisionDate: null, cmsTitle: null }),
    )!;
    expect(rec.title).toBe("The Epicenter");
    expect(rec.filedAt?.toISOString()).toBe("2027-01-04T10:00:00.000Z");
  });
});

describe("uor-web nav fallback", () => {
  const NAV = [
    {
      megaMenuItems: [
        {
          link: "https://www.uomeetingsandevents.com/events/universal-epic-universe/the-epicenter",
        },
        { link: "https://www.uomeetingsandevents.com/hotels" },
      ],
    },
  ];

  it("files a new page from the mega-nav when the Coveo token is gone, and files no removals", async () => {
    const log: string[] = [];
    // pageinfo without a token → the adapter falls back to the nav component.
    const ctx = ctxWith(
      {
        "/web/en/us/sitemap.xml": sitemap(["/things-to-do/a"]),
        "/api/pageinfo.html": { ResourceList: {} },
        "/api/getcontent/": NAV,
        "/index.html": CELESTIAL_PARK_DOC,
      },
      log,
    );
    const res = await uorWebAdapter.fetchSince(
      {
        pages: {
          uor: ["/things-to-do/a"],
          // Known pages the nav does not link — a partial listing must not
          // read them as removed.
          uomeetingsandevents: [
            "/hotels",
            "/hotels/hotel-policies",
            "/events/universal-volcano-bay",
          ],
        },
      },
      ctx,
    );
    expect(res.records.map((r) => r.externalId)).toEqual([
      "uomeetingsandevents:/events/universal-epic-universe/the-epicenter",
    ]);
    const after = parseCursor(res.cursor);
    expect(after.pages.uomeetingsandevents).toContain("/hotels/hotel-policies");
    expect(after.missing.uomeetingsandevents ?? {}).toEqual({});
    expect(log.join(" ")).toContain("nav fallback");
  });
});

describe("uor-web dead links", () => {
  it("files nothing for a path whose document 301s, and remembers it", async () => {
    // No "/index.html" route → every body read is a 404 in the stub; use a
    // redirect-shaped stub instead so the adapter sees Universal's "gone".
    const ctx: AdapterContext = {
      ...ctxWith({}),
      fetch: (async (input: RequestInfo | URL) => {
        const url =
          typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        if (url.includes("/web/en/us/sitemap.xml"))
          return new Response(sitemap(["/things-to-do/a", "/things-to-do/dead"]), { status: 200 });
        if (url.includes("/api/pageinfo.html"))
          return new Response(JSON.stringify(PAGEINFO), { status: 200 });
        if (url.includes("platform.cloud.coveo.com"))
          return new Response(JSON.stringify(coveo(["/hotels"])), { status: 200 });
        // Every page document is "no such page".
        return new Response(null, { status: 301, headers: { location: "/oops-sorry" } });
      }) as typeof fetch,
    };
    const res = await uorWebAdapter.fetchSince(
      { pages: { uor: ["/things-to-do/a"], uomeetingsandevents: ["/hotels"], uor_sales: [] } },
      ctx,
    );
    expect(res.records).toEqual([]);
    expect(parseCursor(res.cursor).dead.uor).toEqual({ "/things-to-do/dead": 0 });
    // It stays in the inventory, so tomorrow's run does not re-read it.
    expect(parseCursor(res.cursor).pages.uor).toContain("/things-to-do/dead");
  });
});

describe("uor-web removals", () => {
  it("files a gone page as its own record, titled so it can't read as a launch", () => {
    const rec = uorWebAdapter.normalize({
      externalId: "uomeetingsandevents:/events/universal-epic-universe/the-epicenter#removed",
      url: "https://www.uomeetingsandevents.com/en/us/events/universal-epic-universe/the-epicenter",
      fetchedAt: new Date("2027-06-01T10:00:00Z"),
      body: {
        publication: "uomeetingsandevents",
        path: "/events/universal-epic-universe/the-epicenter",
        url: "https://www.uomeetingsandevents.com/en/us/events/universal-epic-universe/the-epicenter",
        removed: true,
        missedRuns: 2,
      } satisfies RemovedBody,
    })!;
    expect(rec.title).toBe("The Epicenter — page removed");
    expect(rec.status).toBe("removed");
    expect(rec.payload.removed).toBe(true);
    expect(rec.filedAt?.toISOString()).toBe("2027-06-01T10:00:00.000Z");
  });

  it("scores a removal below the same page's publication", () => {
    const payload = {
      publication: "uomeetingsandevents",
      path: "/events/universal-epic-universe/the-epicenter",
      section: "events",
    };
    const published = scoreWebPage(
      { kind: "web_page", description: "x".repeat(60), payload } as unknown as PublicRecordInput,
      { operatorFiler: true, links: { links: [] } as never },
    );
    const removed = scoreWebPage(
      {
        kind: "web_page",
        description: "x".repeat(60),
        payload: { ...payload, removed: true },
      } as unknown as PublicRecordInput,
      { operatorFiler: true, links: { links: [] } as never },
    );
    expect(removed).toBeLessThan(published);
    expect(removed).toBeGreaterThan(0);
  });
});

describe("uor-web scoring", () => {
  const input = (payload: Record<string, unknown>, description = "x".repeat(60)) =>
    ({ kind: "web_page", description, payload }) as unknown as PublicRecordInput;
  const links = (kinds: string[]) => ({
    operator: "universal" as const,
    resortSlug: "universal-orlando",
    parkId: null,
    polygonParkId: null,
    links: kinds.map((entityKind) => ({
      entityKind,
      entityId: "1",
      method: "name",
      confidence: 1,
    })),
  });
  const ctx = (kinds: string[] = []) => ({
    operatorFiler: true,
    links: links(kinds) as never,
  });

  it("puts an unrecognised B2B venue page above a guest-site refresh", () => {
    const venue = scoreWebPage(
      input({
        publication: "uomeetingsandevents",
        path: "/events/universal-epic-universe/the-epicenter",
        section: "events",
      }),
      ctx(),
    );
    const knownRide = scoreWebPage(
      input({
        publication: "uor",
        path: "/things-to-do/rides-attractions/stardust-racers",
        section: "things-to-do",
      }),
      ctx(["attraction"]),
    );
    const boilerplate = scoreWebPage(
      input({ publication: "uor", path: "/plan-your-visit/parking", section: "plan-your-visit" }),
      ctx(),
    );
    expect(venue).toBeGreaterThan(knownRide);
    expect(knownRide).toBeGreaterThan(boilerplate);
  });
});
