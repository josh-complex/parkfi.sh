/**
 * USPTO patents — Open Data Portal Patent File Wrapper search
 * (`POST /api/v1/patent/applications/search`; plan §5.10, C3). Three
 * searches per run, each windowed on the cursor date:
 *
 *   1. operator applicants × `earliestPublicationDate`  (Thursday publications)
 *   2. operator applicants × `grantDate`                (Tuesday grants)
 *   3. CPC A63G / A63J (amusement rides, stage & illusion effects) × publication
 *      date, any applicant — the ride-system vendors (Oceaneering, Dynamic
 *      Attractions, Intamin, …). These are kept without operator attribution
 *      (`alwaysKeep`), so they show in the all-resorts feed only.
 *
 * Needs `USPTO_ODP_API_KEY`. Weekly cadence; the cursor overlaps three days
 * so late indexing can't lose a record (upserts are idempotent).
 */
import { isoDaysAgo, ODP_API_KEY_ENV, odpJson } from "../uspto/odp.ts";

import type {
  Adapter,
  AdapterContext,
  FetchResult,
  FilerAlias,
  PublicRecordInput,
  RawRecord,
} from "../types.ts";

export const USPTO_PATENT_SOURCE = "uspto_patent";
const BACKFILL_DAYS = Number(process.env.RECORDS_PATENT_BACKFILL_DAYS ?? 90);
const PAGE = 100;
const MAX_PAGES = 10;
const OVERLAP_DAYS = 3;
/** CPC groups whose publications we keep regardless of applicant. */
const RIDE_CPC = /^A63[GJ]\b/;

interface PfwEntry {
  applicationNumberText?: string;
  applicationMetaData?: {
    applicationNumberText?: string;
    inventionTitle?: string;
    filingDate?: string;
    grantDate?: string;
    patentNumber?: string;
    earliestPublicationNumber?: string;
    earliestPublicationDate?: string;
    publicationDateBag?: string[];
    applicationStatusCode?: number;
    applicationStatusDescriptionText?: string;
    applicationStatusDate?: string;
    applicationTypeLabelName?: string;
    firstApplicantName?: string;
    firstInventorName?: string;
    groupArtUnitNumber?: string;
    docketNumber?: string;
    cpcClassificationBag?: string[];
    applicantBag?: Array<{ applicantNameText?: string }>;
    inventorBag?: Array<{ inventorNameText?: string }>;
  };
}

interface PfwResponse {
  count?: number;
  patentFileWrapperDataBag?: PfwEntry[];
}

/** Alias patterns → applicant phrases the search can match (`PREFIX%` only). */
export function applicantPhrases(aliases: FilerAlias[]): string[] {
  return aliases
    .map((a) => a.pattern)
    .filter((p) => /^[A-Z0-9 ]+%$/.test(p))
    .map((p) => p.slice(0, -1).trim());
}

export function applicantQuery(phrases: string[]): string {
  return `applicationMetaData.firstApplicantName:(${phrases.map((p) => `"${p}"`).join(" OR ")})`;
}

export function patentCenterUrl(applicationNumber: string): string {
  return `https://patentcenter.uspto.gov/applications/${encodeURIComponent(applicationNumber)}`;
}

async function search(
  ctx: AdapterContext,
  q: string,
  rangeField: string,
  from: string,
  to: string,
): Promise<PfwEntry[]> {
  const out: PfwEntry[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    if (ctx.signal.aborted) break;
    const body = await odpJson<PfwResponse>(ctx.fetch, "/patent/applications/search", {
      method: "POST",
      signal: ctx.signal,
      body: {
        q,
        rangeFilters: [{ field: rangeField, valueFrom: from, valueTo: to }],
        sort: [{ field: rangeField, order: "Desc" }],
        pagination: { offset: page * PAGE, limit: PAGE },
      },
    });
    const bag = body.patentFileWrapperDataBag ?? [];
    out.push(...bag);
    if (bag.length < PAGE) break;
  }
  return out;
}

export const usptoPatentAdapter: Adapter = {
  source: USPTO_PATENT_SOURCE,
  agency: "USPTO",
  cadence: "weekly",
  requiredEnv: [ODP_API_KEY_ENV],

  async fetchSince(cursor, ctx): Promise<FetchResult> {
    const since = typeof cursor?.since === "string" ? cursor.since : null;
    const today = new Date().toISOString().slice(0, 10);
    const from = since ?? isoDaysAgo(BACKFILL_DAYS);
    const phrases = applicantPhrases(ctx.aliases);
    const queries: Array<[label: string, q: string, field: string]> = [
      [
        "applicant publications",
        applicantQuery(phrases),
        "applicationMetaData.earliestPublicationDate",
      ],
      ["applicant grants", applicantQuery(phrases), "applicationMetaData.grantDate"],
      [
        "ride-system CPC publications",
        "applicationMetaData.cpcClassificationBag:(A63G* OR A63J*)",
        "applicationMetaData.earliestPublicationDate",
      ],
    ];
    ctx.log(`window ${from} → ${today}`);

    const byApp = new Map<string, PfwEntry>();
    for (const [label, q, field] of queries) {
      try {
        const entries = await search(ctx, q, field, from, today);
        ctx.log(`${label}: ${entries.length}`);
        for (const e of entries) {
          const id = e.applicationNumberText ?? e.applicationMetaData?.applicationNumberText;
          if (id) byApp.set(id, e);
        }
      } catch (err) {
        // One malformed query (e.g. the CPC wildcard) must not lose the others.
        ctx.log(`${label} failed: ${err instanceof Error ? err.message : err}`);
      }
    }
    const fetchedAt = new Date();
    const records: RawRecord[] = [...byApp.entries()].map(([id, body]) => ({
      externalId: id,
      url: patentCenterUrl(id),
      fetchedAt,
      body,
    }));
    return { records, cursor: { since: isoDaysAgo(OVERLAP_DAYS) } };
  },

  normalize(raw: RawRecord): PublicRecordInput | null {
    const entry = raw.body as PfwEntry;
    const m = entry?.applicationMetaData;
    if (!m || typeof m !== "object") throw new Error("uspto_patent: missing applicationMetaData");
    const appNo = entry.applicationNumberText ?? m.applicationNumberText;
    if (!appNo || !m.inventionTitle) return null;
    const granted = !!m.grantDate;
    const publicationDate = m.earliestPublicationDate ?? m.publicationDateBag?.[0] ?? null;
    if (!granted && !publicationDate) return null; // unpublished — nothing public yet
    const cpc = (m.cpcClassificationBag ?? []).map((c) => c.replace(/\s+/g, " ").trim());
    const rideSystem = cpc.some((c) => RIDE_CPC.test(c));
    const applicants = (m.applicantBag ?? [])
      .map((a) => a.applicantNameText)
      .filter((s): s is string => !!s);
    const inventors = (m.inventorBag ?? [])
      .map((i) => i.inventorNameText)
      .filter((s): s is string => !!s);
    const title = m.inventionTitle.trim();
    const description = [
      granted
        ? `Granted ${m.grantDate} as US ${m.patentNumber ?? ""}`.trim()
        : publicationDate
          ? `Published ${publicationDate} as ${m.earliestPublicationNumber ?? "an application"}`
          : null,
      inventors.length ? `Inventors: ${inventors.slice(0, 6).join(", ")}` : null,
      cpc.length ? `CPC ${cpc.slice(0, 6).join("; ")}` : null,
    ]
      .filter(Boolean)
      .join(". ");

    return {
      kind: granted ? "patent_grant" : "patent_app",
      externalId: appNo,
      url: raw.url,
      title,
      description,
      filer: m.firstApplicantName ?? applicants[0] ?? null,
      filedAt: m.filingDate ? new Date(`${m.filingDate}T12:00:00Z`) : null,
      status: m.applicationStatusDescriptionText ?? null,
      statusAt: m.applicationStatusDate
        ? new Date(`${m.applicationStatusDate}T12:00:00Z`)
        : granted
          ? new Date(`${m.grantDate}T12:00:00Z`)
          : publicationDate
            ? new Date(`${publicationDate}T12:00:00Z`)
            : null,
      payload: {
        applicationNumber: appNo,
        patentNumber: m.patentNumber ?? null,
        publicationNumber: m.earliestPublicationNumber ?? null,
        publicationDate,
        grantDate: m.grantDate ?? null,
        filingDate: m.filingDate ?? null,
        statusCode: m.applicationStatusCode ?? null,
        applicationType: m.applicationTypeLabelName ?? null,
        applicants,
        inventors,
        cpc,
        rideSystemCpc: rideSystem,
        artUnit: m.groupArtUnitNumber ?? null,
        docketNumber: m.docketNumber ?? null,
      },
      linkText: [title, ...applicants],
      alwaysKeep: rideSystem,
    };
  },

  resortFor() {
    return null;
  },
};
