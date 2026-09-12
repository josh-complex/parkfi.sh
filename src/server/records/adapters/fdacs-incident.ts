/**
 * FDACS "MOU Exempt Facilities Report" — ride incidents at Florida's exempt
 * parks (plan §5.14, B4). Under a 2001 memorandum of understanding, parks
 * with >1,000 employees and full-time inspectors (Disney, Universal,
 * SeaWorld, Busch Gardens, LEGOLAND) report every incident that needed an
 * overnight hospital stay; the Department publishes them quarterly.
 *
 * One cumulative PDF, one stable content id (81386 since 2019 — the file is
 * overwritten in place ~the 15th of the month after quarter end), text
 * extractable, back to Q4 2001. So a sweep is: read the listing page for the
 * current link (fall back to the known id), HEAD the file, and only when its
 * Last-Modified/Content-Length pair moved, download it, parse every row and
 * upsert (identity is a content hash, so re-parses are idempotent and the
 * agency's silent edits to old quarters become revisions).
 *
 * Both hosts' robots.txt disallow generic agents; a listing GET and a HEAD
 * of one public record per week under our honest user agent is not a crawl,
 * and nothing else is fetched. Cadence is weekly, which lands within six
 * days of a quarterly update.
 *
 * Privacy (plan §9): the parser never returns the guest's age or sex, the
 * payload carries none, and the public surfaces aggregate incidents per
 * attraction instead of listing them (router + UI enforce that).
 */
import { extractText, getDocumentProxy } from "unpdf";

import { cleanText } from "../normalize.ts";
import { parseExemptReport, type FacilityKey, type ParsedIncident } from "../fdacs/report.ts";

import type {
  Adapter,
  AdapterContext,
  FetchResult,
  Operator,
  PublicRecordInput,
  RawRecord,
} from "../types.ts";

export const FDACS_INCIDENT_SOURCE = "fdacs_incident";

const LISTING_URL =
  process.env.RECORDS_FDACS_LISTING_URL ??
  "https://www.fdacs.gov/Business-Services/Fairs/Fair-Rides-Inspection";
/** Ibexa content id the report has lived at since 2019; used when the listing page fails. */
const FALLBACK_CONTENT_ID = process.env.RECORDS_FDACS_CONTENT_ID ?? "81386";

export function reportUrl(contentId: string): string {
  return `https://ccmedia.fdacs.gov/content/download/${contentId}/file/exempt-facilities-report.pdf`;
}

/** The report link on the listing page: `/content/download/<id>/file/…exempt….pdf`. */
export function findReportContentId(html: string): string | null {
  const m =
    /href="(?:https?:\/\/[^/"]+)?\/content\/download\/(\d+)\/file\/[^"]*exempt[^"]*\.pdf"/i.exec(
      html,
    );
  return m?.[1] ?? null;
}

/** Facility label → operator / resort. LEGOLAND is nobody we track (§10 Q4). */
const FACILITY_OPERATOR: Record<
  FacilityKey,
  { operator: Operator; resortSlug: string | null; filer: string } | null
> = {
  disney: { operator: "disney", resortSlug: "walt-disney-world", filer: "Walt Disney World" },
  universal: { operator: "universal", resortSlug: "universal-orlando", filer: "Universal Orlando" },
  seaworld: { operator: "seaworld", resortSlug: null, filer: "SeaWorld Orlando" },
  busch: { operator: "seaworld", resortSlug: null, filer: "Busch Gardens Tampa Bay" },
  legoland: null,
};

/** Body stored on the raw record. */
export interface IncidentRow {
  incident: ParsedIncident;
  /** The report's "Updated:" date the row was read from. */
  reportUpdatedOn: string | null;
}

async function pdfText(buf: ArrayBuffer): Promise<string> {
  const pdf = await getDocumentProxy(new Uint8Array(buf));
  const { text } = await extractText(pdf, { mergePages: false });
  return (text as string[]).join("\n");
}

export const fdacsIncidentAdapter: Adapter = {
  source: FDACS_INCIDENT_SOURCE,
  agency: "FDACS",
  cadence: "weekly",

  async fetchSince(cursor, ctx): Promise<FetchResult> {
    let contentId = FALLBACK_CONTENT_ID;
    try {
      const page = await ctx.fetch(LISTING_URL, {
        headers: { accept: "text/html" },
        signal: ctx.signal,
      });
      const found = page.ok ? findReportContentId(await page.text()) : null;
      if (found) contentId = found;
      else
        ctx.log(
          `listing page ${page.status}: report link not found, using content id ${contentId}`,
        );
    } catch (err) {
      ctx.log(
        `listing page failed (${err instanceof Error ? err.message : err}); using content id ${contentId}`,
      );
    }

    const url = reportUrl(contentId);
    const head = await ctx.fetch(url, { method: "HEAD", signal: ctx.signal });
    if (!head.ok) throw new Error(`FDACS report HEAD HTTP ${head.status}`);
    const lastModified = head.headers.get("last-modified");
    const contentLength = head.headers.get("content-length");
    const unchanged =
      cursor != null &&
      cursor.contentId === contentId &&
      cursor.lastModified === lastModified &&
      cursor.contentLength === contentLength;
    if (unchanged) {
      ctx.log(`report unchanged (Last-Modified ${lastModified}); nothing to read`);
      return { records: [], cursor };
    }

    const res = await ctx.fetch(url, { signal: ctx.signal });
    if (!res.ok) throw new Error(`FDACS report GET HTTP ${res.status}`);
    const parsed = parseExemptReport(await pdfText(await res.arrayBuffer()));
    ctx.log(
      `report updated ${parsed.updatedOn ?? "?"}: ${parsed.quarters.length} quarters, ${parsed.incidents.length} incidents, ${parsed.noneReported} "none reported", ${parsed.malformed} malformed`,
    );
    // A parse that lost most of the file is a layout change, not news:
    // hold the cursor so the next run retries and nothing is upserted.
    const prevRows = typeof cursor?.rows === "number" ? cursor.rows : 0;
    if (prevRows > 0 && parsed.incidents.length < prevRows * 0.8) {
      throw new Error(
        `FDACS parse regression: ${parsed.incidents.length} rows vs ${prevRows} last time — layout changed?`,
      );
    }

    const fetchedAt = new Date();
    const records: RawRecord[] = parsed.incidents.map((incident) => ({
      externalId: incident.id,
      url,
      fetchedAt,
      body: { incident, reportUpdatedOn: parsed.updatedOn } satisfies IncidentRow,
    }));
    return {
      records,
      cursor: {
        contentId,
        lastModified,
        contentLength,
        updatedOn: parsed.updatedOn,
        rows: parsed.incidents.length,
      },
    };
  },

  normalize(raw: RawRecord): PublicRecordInput | null {
    const body = raw.body as IncidentRow;
    const i = body?.incident;
    if (!i || typeof i !== "object") throw new Error("fdacs_incident: body has no incident");
    const who = FACILITY_OPERATOR[i.facility];
    if (!who) return null;
    const day = new Date(`${i.date}T12:00:00Z`);
    if (Number.isNaN(day.getTime())) return null;
    const ride = cleanText(i.ride) ?? "Unnamed ride";
    return {
      kind: "incident",
      externalId: i.id,
      url: raw.url,
      title: `${ride} — reported incident`,
      // The state's own words, verbatim; never our characterisation (§9).
      description: i.description || null,
      filer: who.filer,
      filedAt: day,
      status: null,
      statusAt: day,
      // One ride's incidents fold into one job for the admin view; the public
      // feed never lists incidents individually.
      jobKey: `${i.facility}:${ride.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
      jobTitle: ride,
      payload: {
        quarter: i.quarter,
        facility: i.facilityLabel,
        date: i.date,
        ride,
        park: i.park,
        reportUpdatedOn: body.reportUpdatedOn,
        // Explicitly nothing about the guest.
      },
      linkText: [ride, i.park].filter((s): s is string => s != null),
      // The ride field is a precise name; let a longer catalog name claim it.
      entityNames: [ride],
      operator: who.operator,
      resortSlug: who.resortSlug,
    };
  },

  linkTextOf(payload) {
    return [payload.ride, payload.park].filter(
      (s): s is string => typeof s === "string" && s.length > 0,
    );
  },

  entityNamesOf(payload) {
    return typeof payload.ride === "string" ? [payload.ride] : [];
  },

  resortFor(operator: Operator): string | null {
    if (operator === "disney") return "walt-disney-world";
    if (operator === "universal") return "universal-orlando";
    return null;
  },
};

/** Exported for tests: what a facility label maps to. */
export function facilityAttribution(key: FacilityKey) {
  return FACILITY_OPERATOR[key];
}

export type { AdapterContext };
