/**
 * South Florida Water Management District — Environmental Resource Permit
 * (ERP) applications (plan §5.6, A6). The Pega "RegPermitting" portal is
 * login-walled, but the District mirrors its whole ERP application ledger
 * nightly into an anonymous ArcGIS FeatureServer (spike 2026-09-12): every
 * application back to the 1990s with project name, applicant, permit type,
 * acreage, status, received / final-action / issue dates and the project
 * boundary polygon. It is the feed the fan press reads — Project K, the
 * Hartzog housing ERP and Universal's 694-acre "North Campus" conceptual
 * approval are all in it on the dates the outlets reported.
 *
 * Selection, like the FAA adapter, is two-pronged per sweep: one query by
 * applicant (every operator alias pushed down as a `LIKE`), one by geography
 * (an envelope around the parks, then `RADIUS_KM` of a park centre so the
 * shared linker's polygon test can attribute a contractor's in-park filing).
 * Everything else — FDOT road work, subdivisions next door — is dropped
 * before the ledger, per the §4.2 attribution rule.
 *
 * Dates: the feed's `AppReceivedDate` decodes one day late (stored as UTC
 * midnight, reported in America/New_York), so the received date is read
 * from the `APP_NO` prefix (`YYMMDD-NNNNN`), which the District's own
 * notices agree with; final-action / issue dates decode correctly as
 * park-local calendar days.
 *
 * There is no anonymous per-record deep link (the feed's `Link` column is a
 * constant), so records point at the RegPermitting entry page and the UI
 * shows the application number to paste into "Search Records".
 */
import { distanceMeters } from "#/server/achievements/geo.ts";

import { cleanText, jobSlug, toNumber } from "../normalize.ts";

import type {
  Adapter,
  AdapterContext,
  FetchResult,
  Operator,
  ParkGeo,
  PublicRecordInput,
  RawRecord,
} from "../types.ts";

export const SFWMD_ERP_SOURCE = "sfwmd_erp";

/** Layer 16 = "All Environmental Resource Applications" (pending + resolved). */
const LAYER_URL =
  process.env.RECORDS_SFWMD_LAYER_URL ??
  "https://geoweb.sfwmd.gov/agsext1/rest/services/Regulation_ApplicationPermits/EnvironmentalResourceApplications_RegPermitting/FeatureServer/16/query";
/** The public entry page; no per-record URL exists. */
export const SFWMD_PORTAL_URL = "https://www.sfwmd.gov/regpermitting";
/** Keep geography-selected rows within this distance of a park centre. */
const RADIUS_KM = Number(process.env.RECORDS_ERP_RADIUS_KM ?? 3);
/** Envelope padding around the parks' centres, in degrees (~9 km). */
const ENVELOPE_PAD_DEG = 0.08;
/** Re-read this many days behind the cursor so a late status change is seen. */
const OVERLAP_DAYS = 3;
const PAGE_SIZE = 2000;
const PARK_TZ = "America/New_York";

const OUT_FIELDS = [
  "APP_NO",
  "PERMIT_NO",
  "PROJECT_NAME",
  "AppType",
  "AppTypeDesc",
  "PermitFamily",
  "PermitSubFamilyDesc",
  "PermitType",
  "ApplicantName",
  "FullNameOrCompany",
  "AppStatus",
  "PermitStatus",
  "LandUse",
  "ProjectAcres",
  "PermitAcres",
  "AppReceivedDate",
  "AppFinalActionDate",
  "IssueDate",
  "PermitExpirationDate",
  "City",
  "State",
  "IsTestData",
] as const;

/** One feature's attributes as the layer returns them (epoch-ms dates). */
export interface ErpAttributes {
  APP_NO?: string | null;
  PERMIT_NO?: string | null;
  PROJECT_NAME?: string | null;
  AppType?: string | null;
  AppTypeDesc?: string | null;
  PermitFamily?: string | null;
  PermitSubFamilyDesc?: string | null;
  PermitType?: string | null;
  ApplicantName?: string | null;
  FullNameOrCompany?: string | null;
  AppStatus?: string | null;
  PermitStatus?: string | null;
  LandUse?: string | null;
  ProjectAcres?: number | null;
  PermitAcres?: number | null;
  AppReceivedDate?: number | null;
  AppFinalActionDate?: number | null;
  IssueDate?: number | null;
  PermitExpirationDate?: number | null;
  City?: string | null;
  State?: string | null;
  IsTestData?: string | null;
}

export interface ErpFeature {
  attributes: ErpAttributes;
  centroid?: { x: number; y: number } | null;
}

interface QueryResponse {
  features?: ErpFeature[];
  exceededTransferLimit?: boolean;
  error?: { code?: number; message?: string };
}

/** Body stored on the raw record: the feature plus the proximity we computed. */
export interface ErpRow {
  attributes: ErpAttributes;
  centroid: { x: number; y: number } | null;
  nearest: { slug: string; km: number } | null;
}

/** Human labels for the permit-type codes. */
const PERMIT_TYPE_LABELS: Record<string, string> = {
  IND: "Individual",
  GP: "General",
  CA: "Conceptual approval",
  EXEM: "Exemption",
  VAR: "Variance",
  FWD: "Formal wetland determination",
  IWD: "Informal wetland determination",
  MIT: "Mitigation bank",
  SLERP: "Sovereign submerged lands",
};

export function permitTypeLabel(code: string | null | undefined): string | null {
  if (!code) return null;
  return PERMIT_TYPE_LABELS[code] ?? code;
}

/** `YYMMDD-NNNNN` → the received calendar day at UTC noon, else null. */
export function receivedDateFromAppNo(appNo: string | null | undefined): Date | null {
  const m = /^(\d{2})(\d{2})(\d{2})-\d+$/.exec(appNo ?? "");
  if (!m) return null;
  const [, yy, mm, dd] = m;
  const year = 2000 + Number(yy);
  const month = Number(mm);
  const day = Number(dd);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return new Date(Date.UTC(year, month - 1, day, 12));
}

/** Epoch-ms from the layer → the park-local calendar day at UTC noon. */
export function localDay(epochMs: number | null | undefined): Date | null {
  if (typeof epochMs !== "number" || !Number.isFinite(epochMs)) return null;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: PARK_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(epochMs));
  const get = (t: string) => parts.find((p) => p.type === t)?.value;
  const y = get("year");
  const m = get("month");
  const d = get("day");
  if (!y || !m || !d) return null;
  return new Date(`${y}-${m}-${d}T12:00:00Z`);
}

/** Nearest park centre within `RADIUS_KM`, else null. */
export function nearestPark(
  lat: number,
  lng: number,
  parks: ParkGeo[],
): { slug: string; km: number } | null {
  let best: { slug: string; km: number } | null = null;
  for (const p of parks) {
    if (p.latitude == null || p.longitude == null) continue;
    const km = distanceMeters([lng, lat], [p.longitude, p.latitude]) / 1000;
    if (km <= RADIUS_KM && (!best || km < best.km))
      best = { slug: p.slug, km: Math.round(km * 100) / 100 };
  }
  return best;
}

/** Bounding envelope (`xmin,ymin,xmax,ymax`, WGS84) around every park centre, padded. */
export function parkEnvelope(parks: ParkGeo[]): string | null {
  const lats = parks.map((p) => p.latitude).filter((v): v is number => v != null);
  const lngs = parks.map((p) => p.longitude).filter((v): v is number => v != null);
  if (lats.length === 0 || lngs.length === 0) return null;
  const f = (n: number) => n.toFixed(4);
  return [
    f(Math.min(...lngs) - ENVELOPE_PAD_DEG),
    f(Math.min(...lats) - ENVELOPE_PAD_DEG),
    f(Math.max(...lngs) + ENVELOPE_PAD_DEG),
    f(Math.max(...lats) + ENVELOPE_PAD_DEG),
  ].join(",");
}

function sqlString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/**
 * Applicant clause from the alias table: plain `PREFIX%` patterns become
 * contains-matches on the upper-cased applicant (the feed's strings carry
 * punctuation the normalized alias doesn't — "Parks & Resorts, US, Inc" —
 * and the exact prefix rule is re-applied on the normalized filer in
 * `prepareRecord`, so the looser clause can't let a stranger through).
 */
export function applicantClause(aliases: AdapterContext["aliases"]): string | null {
  const terms = new Set<string>();
  for (const alias of aliases) {
    if (!/^[A-Z0-9 ]+%$/.test(alias.pattern)) continue;
    terms.add(alias.pattern.slice(0, -1).trim());
  }
  if (terms.size === 0) return null;
  return [...terms].map((t) => `UPPER(ApplicantName) LIKE ${sqlString(`%${t}%`)}`).join(" OR ");
}

/** Window clause: received or acted on since `sinceIso` (YYYY-MM-DD). */
export function windowClause(sinceIso: string): string {
  const d = `DATE '${sinceIso}'`;
  return `(AppReceivedDate >= ${d} OR AppFinalActionDate >= ${d} OR IssueDate >= ${d})`;
}

function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

async function queryAll(
  ctx: AdapterContext,
  params: Record<string, string>,
): Promise<ErpFeature[]> {
  const out: ErpFeature[] = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const search = new URLSearchParams({
      ...params,
      outFields: OUT_FIELDS.join(","),
      returnGeometry: "false",
      returnCentroid: "true",
      outSR: "4326",
      orderByFields: "APP_NO ASC",
      resultOffset: String(offset),
      resultRecordCount: String(PAGE_SIZE),
      f: "json",
    });
    const res = await ctx.fetch(`${LAYER_URL}?${search}`, {
      headers: { accept: "application/json" },
      signal: ctx.signal,
    });
    if (!res.ok) throw new Error(`SFWMD ERP layer HTTP ${res.status}`);
    const text = await res.text();
    let body: QueryResponse;
    try {
      body = JSON.parse(text) as QueryResponse;
    } catch {
      // The District's WAF answers blocked signatures with an HTML page.
      throw new Error(`SFWMD ERP layer: non-JSON response (${text.slice(0, 80)})`);
    }
    if (body.error) throw new Error(`SFWMD ERP layer: ${body.error.message ?? "error"}`);
    out.push(...(body.features ?? []));
    if (!body.exceededTransferLimit || (body.features?.length ?? 0) < PAGE_SIZE) break;
    if (ctx.signal.aborted) break;
  }
  return out;
}

export const sfwmdErpAdapter: Adapter = {
  source: SFWMD_ERP_SOURCE,
  agency: "SFWMD",
  cadence: "daily",

  async fetchSince(cursor, ctx): Promise<FetchResult> {
    const runStarted = new Date();
    const since =
      typeof cursor?.since === "string"
        ? isoDay(
            new Date(new Date(`${cursor.since}T12:00:00Z`).getTime() - OVERLAP_DAYS * 86_400_000),
          )
        : ctx.backfillFrom;
    const window = windowClause(since);
    ctx.log(`${cursor ? `incremental since ${since}` : `backfill from ${since}`}`);

    const byAppNo = new Map<string, ErpFeature>();
    const applicant = applicantClause(ctx.aliases);
    if (applicant) {
      const rows = await queryAll(ctx, { where: `${window} AND (${applicant})` });
      for (const f of rows) if (f.attributes.APP_NO) byAppNo.set(f.attributes.APP_NO, f);
      ctx.log(`applicant query: ${rows.length} rows`);
    }
    const envelope = parkEnvelope(ctx.parks);
    if (envelope && !ctx.signal.aborted) {
      const rows = await queryAll(ctx, {
        where: window,
        geometry: envelope,
        geometryType: "esriGeometryEnvelope",
        inSR: "4326",
        spatialRel: "esriSpatialRelIntersects",
      });
      let near = 0;
      for (const f of rows) {
        const appNo = f.attributes.APP_NO;
        if (!appNo || byAppNo.has(appNo)) continue;
        const c = f.centroid;
        if (!c || !nearestPark(c.y, c.x, ctx.parks)) continue;
        near++;
        byAppNo.set(appNo, f);
      }
      ctx.log(`envelope query: ${rows.length} rows, ${near} within ${RADIUS_KM} km of a park`);
    }

    const fetchedAt = new Date();
    const records: RawRecord[] = [];
    for (const f of byAppNo.values()) {
      if (f.attributes.IsTestData === "Yes") continue;
      const c = f.centroid ?? null;
      const body: ErpRow = {
        attributes: f.attributes,
        centroid: c,
        nearest: c ? nearestPark(c.y, c.x, ctx.parks) : null,
      };
      records.push({ externalId: f.attributes.APP_NO!, url: SFWMD_PORTAL_URL, fetchedAt, body });
    }
    // The cursor is the run day; the next run re-reads OVERLAP_DAYS behind it.
    return { records, cursor: { since: isoDay(runStarted) } };
  },

  normalize(raw: RawRecord): PublicRecordInput | null {
    const body = raw.body as ErpRow;
    const a = body?.attributes;
    if (!a || typeof a !== "object") throw new Error("sfwmd_erp: body has no attributes");
    const appNo = cleanText(a.APP_NO);
    if (!appNo) return null;

    const projectName = cleanText(a.PROJECT_NAME);
    const permitNo = cleanText(a.PERMIT_NO);
    const permitType = cleanText(a.PermitType);
    const typeLabel = permitTypeLabel(permitType);
    const appType = cleanText(a.AppType);
    const appTypeDesc = cleanText(a.AppTypeDesc);
    const applicant = cleanText(a.ApplicantName);
    const contact = cleanText(a.FullNameOrCompany);
    const appStatus = cleanText(a.AppStatus);
    const permitStatus = cleanText(a.PermitStatus);
    const acres = toNumber(a.ProjectAcres);
    const landUse = cleanText(a.LandUse);

    const receivedAt = receivedDateFromAppNo(appNo) ?? localDay(a.AppReceivedDate);
    const finalAt = localDay(a.AppFinalActionDate);
    const issuedAt = localDay(a.IssueDate);
    const expiresAt = localDay(a.PermitExpirationDate);

    // A completed application's news is the permit's fate; while pending, the
    // application status is the state. "Resolved-Withdrawn" → "Withdrawn" so
    // the feed's status buckets read it as closed, not open.
    const status =
      appStatus?.startsWith("Resolved-") && permitStatus
        ? permitStatus
        : appStatus?.startsWith("Resolved-")
          ? appStatus.slice("Resolved-".length)
          : appStatus;

    const title = projectName ?? `${typeLabel ?? "ERP"} application ${appNo}`;
    const description = [
      `Environmental resource permit application${typeLabel ? ` (${typeLabel}${appTypeDesc ? `, ${appTypeDesc.toLowerCase()}` : ""})` : ""}`,
      acres != null && acres > 0 ? `${acres.toLocaleString("en-US")} acres` : null,
      landUse ? `Land use: ${landUse}` : null,
      permitNo ? `Permit ${permitNo}` : null,
    ]
      .filter(Boolean)
      .join(". ");

    const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
    const payload = {
      applicationNumber: appNo,
      permitNumber: permitNo,
      projectName,
      permitFamily: cleanText(a.PermitFamily),
      permitType,
      permitTypeLabel: typeLabel,
      permitSubFamily: cleanText(a.PermitSubFamilyDesc),
      applicationType: appType,
      applicationTypeLabel: appTypeDesc,
      applicant,
      contact,
      applicationStatus: appStatus,
      permitStatus,
      landUse,
      projectAcres: acres,
      permitAcres: toNumber(a.PermitAcres),
      receivedDate: day(receivedAt),
      finalActionDate: day(finalAt),
      issueDate: day(issuedAt),
      expirationDate: day(expiresAt),
      // Applicant mailing city only — the street address is not the site (§9).
      applicantCity: cleanText(a.City),
      nearestPark: body.nearest,
    };

    return {
      kind: "erp",
      externalId: appNo,
      url: raw.url,
      title,
      description,
      // Pre-2015 rows were filed by Reedy Creek with the operator as the
      // contact; the contact carries the attribution through `linkText`.
      filer: applicant ?? contact,
      filedAt: receivedAt,
      status,
      statusAt: finalAt ?? issuedAt ?? receivedAt,
      latitude: body.centroid?.y ?? null,
      longitude: body.centroid?.x ?? null,
      // Modifications, extensions and transfers of one permit fold together.
      jobKey: permitNo ? jobSlug(permitNo) : null,
      jobTitle: projectName,
      payload,
      linkText: [projectName, applicant, contact].filter((s): s is string => s != null),
    };
  },

  linkTextOf(payload) {
    return [payload.projectName, payload.applicant, payload.contact].filter(
      (s): s is string => typeof s === "string" && s.length > 0,
    );
  },

  resortFor(operator: Operator): string | null {
    // The District covers Orlando only: Disney here is Walt Disney World.
    if (operator === "disney") return "walt-disney-world";
    if (operator === "universal") return "universal-orlando";
    return null;
  },
};
