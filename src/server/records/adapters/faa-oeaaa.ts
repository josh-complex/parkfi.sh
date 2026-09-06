/**
 * FAA Obstruction Evaluation / Airport Airspace Analysis (OE/AAA) — the
 * public **archive download** of the OE3A app (plan §5.5, A5), found in the
 * spike 2026-09-06: `GET /oeaaa/oe3a-external-api/downloadArchives.do?fname=
 * Part77<REGION><YEAR>List.gzip` returns one CSV per region-year (keyless,
 * `text/csv` despite the name; ~20–40 MB, 20–30k rows for the Southern
 * region `ASO`, which is where every `YYYY-ASO-####-OE` Orlando study lives).
 *
 * Every aeronautical study: sponsor, structure type, proposed/determined
 * AGL + AMSL heights, lat/long, status, determination, dates, proposal text.
 * Cranes over the notice threshold and every permanent tall structure near
 * MCO / Orlando Executive / Kissimmee airspace are here months before steel.
 *
 * Selection is GEOGRAPHY-first (sponsors are crane companies): a row is kept
 * when its point is inside a park polygon (full attribution via the linker)
 * or within `RADIUS_KM` of a park center (kept unattributed — `alwaysKeep` —
 * with the nearest park recorded in payload), or when the sponsor / text
 * matches an operator alias. The whole current year is re-read every run
 * (plus the previous year early in the year, and `RECORDS_FAA_BACKFILL_YEARS`
 * years on the first run); upserts are idempotent and status changes
 * (Studying → Determined) become revisions.
 */
import { gunzipSync } from "node:zlib";

import { distanceMeters } from "#/server/achievements/geo.ts";

import { parseCsvRecords } from "../faa/csv.ts";
import { cleanText, matchAlias, normalizeFiler, toNumber } from "../normalize.ts";

import type {
  Adapter,
  AdapterContext,
  FetchResult,
  ParkGeo,
  PublicRecordInput,
  RawRecord,
} from "../types.ts";

export const FAA_OEAAA_SOURCE = "faa_oeaaa";
const BASE = "https://oeaaa.faa.gov/oeaaa/oe3a-external-api/downloadArchives.do";
/** FAA region whose archive covers Florida. */
const REGION = process.env.RECORDS_FAA_REGION ?? "ASO";
const RADIUS_KM = Number(process.env.RECORDS_FAA_RADIUS_KM ?? 2.5);
const BACKFILL_YEARS = Number(process.env.RECORDS_FAA_BACKFILL_YEARS ?? 3);
/** The public search page — the app has no per-case deep link; the ASN is pasted there. */
export const FAA_SEARCH_URL = "https://oeaaa.faa.gov/oeaaa/oe3a/main/#/search/records";

/** Human labels for the `STRUCTURE TYPE` codes we see near the parks. */
const STRUCTURE_LABELS: Record<string, string> = {
  CRANE: "Crane",
  CRANE$MOBILE: "Mobile crane",
  CRANE$TOWER: "Tower crane",
  CRANE$FIXED: "Fixed crane",
  BUILDING: "Building",
  BUILDING$MULTI_PURPOSE: "Building",
  BUILDING$COMMERCIAL: "Commercial building",
  BUILDING$PARKING: "Parking structure",
  BUILDING$HOTEL: "Hotel",
  BUILDING$HOME: "House",
  BUILDING$HANGAR: "Hangar",
  AMUSEMENT_PARK_STRUCTURE: "Amusement park structure",
  TOWER$ANTENNA: "Antenna tower",
  POLE$MONO: "Monopole",
  POLE$UTILITY: "Utility pole",
  POLE: "Pole",
  TRANSMISSION_LINE$T_L_TOWER: "Transmission line tower",
  ELECTRICAL_SYSTEM$SOLAR_PANEL: "Solar panels",
  CONSTRUCTION$OTHER: "Construction equipment",
  OTHER: "Structure",
};

export function structureLabel(code: string | null): string {
  if (!code) return "Structure";
  if (STRUCTURE_LABELS[code]) return STRUCTURE_LABELS[code]!;
  const base = code.split("$")[0]!;
  return (
    STRUCTURE_LABELS[base] ??
    base
      .replace(/_/g, " ")
      .toLowerCase()
      .replace(/^\w/, (c) => c.toUpperCase())
  );
}

export function archiveUrl(region: string, year: number): string {
  return `${BASE}?fname=Part77${region}${year}List.gzip`;
}

/** Years to (re)read on this run: the current year, the previous one in Jan–Feb, all backfill years on a first run. */
export function yearsToRead(now: Date, firstRun: boolean): number[] {
  const y = now.getUTCFullYear();
  if (firstRun) return Array.from({ length: BACKFILL_YEARS }, (_, i) => y - BACKFILL_YEARS + 1 + i);
  return now.getUTCMonth() <= 1 ? [y - 1, y] : [y];
}

export interface NearestPark {
  slug: string;
  km: number;
}

/** Nearest park center within `RADIUS_KM`, else null. Exported for tests. */
export function nearestPark(lat: number, lng: number, parks: ParkGeo[]): NearestPark | null {
  let best: NearestPark | null = null;
  for (const p of parks) {
    if (p.latitude == null || p.longitude == null) continue;
    const km = distanceMeters([lng, lat], [p.longitude, p.latitude]) / 1000;
    if (km <= RADIUS_KM && (!best || km < best.km))
      best = { slug: p.slug, km: Math.round(km * 100) / 100 };
  }
  return best;
}

/** Body stored on the raw record: the CSV row plus the proximity we computed. */
export interface FaaRow {
  row: Record<string, string>;
  nearest: NearestPark | null;
}

function textMatchesAlias(
  row: Record<string, string>,
  ctx: Pick<AdapterContext, "aliases">,
): boolean {
  for (const key of ["SPONSOR NAME", "STRUCTURE NAME", "PROPOSAL DESCRIPTION"]) {
    if (matchAlias(normalizeFiler(row[key] ?? null), ctx.aliases)) return true;
  }
  return false;
}

export const faaOeaaaAdapter: Adapter = {
  source: FAA_OEAAA_SOURCE,
  agency: "FAA",
  cadence: "daily",

  async fetchSince(cursor, ctx): Promise<FetchResult> {
    const years = yearsToRead(new Date(), cursor == null);
    const records: RawRecord[] = [];
    const counts: Record<string, number> = {};
    for (const year of years) {
      if (ctx.signal.aborted) break;
      const res = await ctx.fetch(archiveUrl(REGION, year), { signal: ctx.signal });
      if (!res.ok) throw new Error(`FAA archive ${REGION} ${year} HTTP ${res.status}`);
      let buf = Buffer.from(await res.arrayBuffer());
      if (buf[0] === 0x1f && buf[1] === 0x8b) buf = gunzipSync(buf);
      // One record per line that opens with a study number ("2026-ASO-381-OE,").
      const { rows, dropped } = parseCsvRecords(
        buf.toString("utf8"),
        /^\d{4}-[A-Z]{2,3}-\d+-[A-Z]+,/m,
      );
      const fetchedAt = new Date();
      let kept = 0;
      for (const row of rows) {
        const asn = cleanText(row["STUDY (ASN)"]);
        if (!asn) continue;
        const lat = toNumber(row.LATITUDE);
        const lng = toNumber(row.LONGITUDE);
        const nearest = lat != null && lng != null ? nearestPark(lat, lng, ctx.parks) : null;
        if (!nearest && !textMatchesAlias(row, ctx)) continue;
        kept++;
        records.push({
          externalId: asn,
          url: FAA_SEARCH_URL,
          fetchedAt,
          body: { row, nearest } satisfies FaaRow,
        });
      }
      counts[String(year)] = rows.length;
      ctx.log(
        `${REGION} ${year}: ${rows.length} studies (${dropped} malformed rows dropped), ${kept} near a park or naming an operator`,
      );
    }
    return { records, cursor: { region: REGION, years: counts } };
  },

  normalize(raw: RawRecord): PublicRecordInput | null {
    const body = raw.body as FaaRow;
    const r = body?.row;
    if (!r || typeof r !== "object") throw new Error("faa_oeaaa: body is not a CSV row");
    const asn = cleanText(r["STUDY (ASN)"]);
    if (!asn) return null;
    const structureType = cleanText(r["STRUCTURE TYPE"]);
    const structureName = cleanText(r["STRUCTURE NAME"]);
    const proposal = cleanText(r["PROPOSAL DESCRIPTION"]);
    const location = cleanText(r["LOCATION DESCRIPTION"]);
    const sponsor = cleanText(r["SPONSOR NAME"]);
    const status = cleanText(r.STATUS);
    const entered = cleanText(r["ENTERED DATE"]);
    const completed = cleanText(r["COMPLETION DATE"]);
    const aglProposed = toNumber(r["AGL HEIGHT PROPOSED"]);
    const aglDetermined = toNumber(r["AGL HEIGHT DET"]);
    const label = structureLabel(structureType);
    const height = aglDetermined ?? aglProposed;
    const title = `${label}${height != null ? ` ${height} ft` : ""}${structureName ? ` — ${structureName}` : ""}`;
    const day = (s: string | null) =>
      s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(`${s}T12:00:00Z`) : null;

    return {
      kind: "airspace",
      externalId: asn,
      url: raw.url,
      title,
      description:
        [proposal, location ? `Location: ${location}` : null].filter(Boolean).join(". ") || null,
      filer: sponsor,
      filedAt: day(entered),
      status,
      statusAt: day(completed) ?? day(entered),
      latitude: toNumber(r.LATITUDE),
      longitude: toNumber(r.LONGITUDE),
      address: location,
      payload: {
        asn,
        priorAsn: cleanText(r["PRIOR ASN"]),
        status,
        determination: cleanText(r.DETERMINATION),
        enteredDate: entered,
        completionDate: completed,
        expirationDate: cleanText(r["EXPIRATION DATE"]),
        structureType,
        structureLabel: label,
        structureName,
        city: cleanText(r["STRUCTURE CITY"]),
        county: cleanText(r["STRUCTURE COUNTY NAME"]),
        state: cleanText(r["STRUCTURE STATE"]),
        nearestAirport: cleanText(r["NEAREST AIRPORT"]),
        distanceFromAirportFt: toNumber(r["DISTANCE FROM AIRPORT"]),
        noticeOf: cleanText(r["NOTICE OF"]),
        duration: cleanText(r.DURATION),
        durationMonths: toNumber(r["DURATION MONTHS"]),
        workBegin: cleanText(r["WORK SCHEDULE BEGINNING DATE"]),
        workEnd: cleanText(r["WORK SCHEDULE ENDING DATE"]),
        aglProposed,
        aglDetermined,
        amslProposed: toNumber(r["AMSL HEIGHT PROPOSED"]),
        amslDetermined: toNumber(r["AMSL HEIGHT DET"]),
        groundElevation: toNumber(r.ELEVATION),
        markingLighting: cleanText(r["MARKING LIGHTING TYPE"]),
        sponsor,
        nearestPark: body.nearest,
      },
      // The representative's personal name and the signature control number
      // are never carried (§9).
      linkText: [structureName, proposal, location].filter((s): s is string => s != null),
      alwaysKeep: body.nearest != null,
    };
  },

  resortFor() {
    return null;
  },
};
