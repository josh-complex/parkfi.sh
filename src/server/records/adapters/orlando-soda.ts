/**
 * City of Orlando "Permit Applications" — Socrata dataset `ryhf-m453`
 * (plan §5.1, A1). Every Universal Orlando permit (the City is the AHJ for the
 * whole UOR property) plus SeaWorld Orlando; nothing Disney builds on property
 * appears here (that's the CFTOD Accela portal, §5.2).
 *
 * Filtered AT THE SOURCE: owner/contractor prefix matches for every operator
 * alias, OR a point within `RADIUS_M` of an active park center (only ~3 % of
 * rows are geocoded — probed 2026-09-04: 454 of 14,736 Universal rows — so
 * the alias clause carries the feed and the radius clause is the tenant /
 * un-aliased-entity safety net). Incremental on the `:updated_at` system
 * field; the first run backfills from `backfillFrom` on `processed_date`.
 *
 * Paging drains fully within one run (`$offset` over a stable `:updated_at,
 * :id` order) and the cursor is the max `:updated_at` seen, so a bulk
 * re-stamp (the City re-touched ~1M rows on 2026-06-02) costs one big drain,
 * never a missed row.
 */
import { config } from "#/server/parks/config.ts";

import { cleanText, latestDate, parseFloatingDate, toNumber } from "../normalize.ts";

import type {
  Adapter,
  AdapterContext,
  FetchResult,
  Operator,
  PublicRecordInput,
  RawRecord,
} from "../types.ts";

export const ORLANDO_SODA_SOURCE = "orlando_soda";
const DATASET = "ryhf-m453";
const RESOURCE_URL = `https://data.cityoforlando.net/resource/${DATASET}.json`;
const PAGE_SIZE = 5000;
/** Radius around each park center for the geocoded safety-net clause. */
const RADIUS_M = 1200;

/** Columns we read. `contractor_address` / `contractor_phone_number` are never selected (§9). */
const COLUMNS = [
  "permit_number",
  "application_type",
  "worktype",
  "project_name",
  "permit_address",
  "parcel_number",
  "property_owner_name",
  "parcel_owner_name",
  "contractor_name",
  "estimated_cost",
  "square_footage",
  "plan_review_type",
  "application_status",
  "processed_date",
  "under_review_date",
  "pending_issuance_date",
  "issue_permit_date",
  "final_date",
  "temp_coo_date",
  "coo_date",
  "geocoded_column",
  "neighborhood",
  "commissioner_district",
  "private_provider",
  "private_provider_company_name",
  ":updated_at",
  ":id",
] as const;

interface SodaRow {
  permit_number?: string;
  application_type?: string;
  worktype?: string;
  project_name?: string;
  permit_address?: string;
  parcel_number?: string;
  property_owner_name?: string;
  parcel_owner_name?: string;
  contractor_name?: string;
  estimated_cost?: string;
  square_footage?: string;
  plan_review_type?: string;
  application_status?: string;
  processed_date?: string;
  under_review_date?: string;
  pending_issuance_date?: string;
  issue_permit_date?: string;
  final_date?: string;
  temp_coo_date?: string;
  coo_date?: string;
  geocoded_column?: { type: "Point"; coordinates: [number, number] };
  neighborhood?: string;
  commissioner_district?: string;
  private_provider?: string;
  private_provider_company_name?: string;
  ":updated_at"?: string;
  ":id"?: string;
}

function soqlString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/**
 * The source-side filter. Alias patterns are LIKE patterns on our normalized
 * filer; the raw Socrata columns aren't normalized, so only plain
 * `PREFIX%` patterns are pushed down — as a CONTAINS match, because rows
 * exported since the City's 2026-06-02 restamp carry a leading space in the
 * owner columns (" UNIVERSAL CITY DEVELOPMENT PAR"; found 2026-09-05 when the
 * prefix form returned zero rows for three months). The exact prefix rule is
 * re-applied on the trimmed, normalized filer in `prepareRecord`, so the
 * looser source clause can't let a tenant through.
 */
export function buildSodaFilter(ctx: Pick<AdapterContext, "parks" | "aliases">): string {
  const clauses: string[] = [];
  for (const alias of ctx.aliases) {
    if (!/^[A-Z0-9 ]+%$/.test(alias.pattern)) continue;
    const literal = soqlString(`%${alias.pattern}`);
    for (const col of ["parcel_owner_name", "property_owner_name", "contractor_name"]) {
      clauses.push(`upper(${col}) like ${literal}`);
    }
  }
  for (const park of ctx.parks) {
    if (park.latitude == null || park.longitude == null) continue;
    clauses.push(
      `within_circle(geocoded_column, ${park.latitude.toFixed(5)}, ${park.longitude.toFixed(5)}, ${RADIUS_M})`,
    );
  }
  return `(${clauses.join(" OR ")})`;
}

/** Human page for one permit: the dataset explorer pre-filtered to the row. */
export function permitUrl(permitNumber: string): string {
  const q = `SELECT * WHERE permit_number = '${permitNumber.replace(/'/g, "''")}'`;
  return `https://data.cityoforlando.net/Permitting/Permit-Applications/${DATASET}/explore/query/${encodeURIComponent(q)}/page/filter`;
}

async function fetchPage(ctx: AdapterContext, where: string, offset: number): Promise<SodaRow[]> {
  const params = new URLSearchParams({
    $select: COLUMNS.join(","),
    $where: where,
    $order: ":updated_at ASC, :id ASC",
    $limit: String(PAGE_SIZE),
    $offset: String(offset),
  });
  const headers: Record<string, string> = {
    "user-agent": config.userAgent,
    accept: "application/json",
  };
  const token = process.env.SODA_APP_TOKEN;
  if (token) headers["x-app-token"] = token;
  const res = await ctx.fetch(`${RESOURCE_URL}?${params}`, { headers, signal: ctx.signal });
  if (!res.ok)
    throw new Error(`SODA ${DATASET} HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const body: unknown = await res.json();
  if (!Array.isArray(body)) throw new Error(`SODA ${DATASET}: expected a JSON array`);
  return body as SodaRow[];
}

export const orlandoSodaAdapter: Adapter = {
  source: ORLANDO_SODA_SOURCE,
  agency: "City of Orlando",
  cadence: "daily",

  async fetchSince(cursor, ctx): Promise<FetchResult> {
    const since = typeof cursor?.updatedAt === "string" ? cursor.updatedAt : null;
    const window = since
      ? `:updated_at > ${soqlString(since)}`
      : `processed_date >= ${soqlString(ctx.backfillFrom)}`;
    const where = `${buildSodaFilter(ctx)} AND ${window}`;
    ctx.log(`${since ? `incremental since ${since}` : `backfill from ${ctx.backfillFrom}`}`);

    const records: RawRecord[] = [];
    let maxUpdatedAt = since;
    let offset = 0;
    for (;;) {
      const rows = await fetchPage(ctx, where, offset);
      const fetchedAt = new Date();
      for (const row of rows) {
        const id = row.permit_number ?? row[":id"];
        if (!id) continue;
        records.push({ externalId: id, url: permitUrl(id), fetchedAt, body: row });
        const u = row[":updated_at"];
        if (u && (!maxUpdatedAt || u > maxUpdatedAt)) maxUpdatedAt = u;
      }
      if (rows.length < PAGE_SIZE) break;
      offset += rows.length;
      if (ctx.signal.aborted) {
        // Budget spent mid-drain: keep what we have but DON'T advance the
        // cursor past it — the next run re-drains from `since`.
        ctx.log(`budget exhausted after ${records.length} rows; cursor held`);
        return { records, cursor: { updatedAt: since } };
      }
    }
    return { records, cursor: { updatedAt: maxUpdatedAt } };
  },

  normalize(raw: RawRecord): PublicRecordInput | null {
    const row = raw.body as SodaRow;
    if (!row || typeof row !== "object") throw new Error("orlando_soda: row is not an object");
    const permitNumber = cleanText(row.permit_number);
    if (!permitNumber) return null;

    const applicationType = cleanText(row.application_type);
    const worktype = cleanText(row.worktype);
    const projectName = cleanText(row.project_name);
    const address = cleanText(row.permit_address);
    const propertyOwner = cleanText(row.property_owner_name);
    const parcelOwner = cleanText(row.parcel_owner_name);
    const contractor = cleanText(row.contractor_name);

    const processedAt = parseFloatingDate(row.processed_date);
    const underReviewAt = parseFloatingDate(row.under_review_date);
    const pendingIssuanceAt = parseFloatingDate(row.pending_issuance_date);
    const issuedAt = parseFloatingDate(row.issue_permit_date);
    const finalAt = parseFloatingDate(row.final_date);
    const tempCooAt = parseFloatingDate(row.temp_coo_date);
    const cooAt = parseFloatingDate(row.coo_date);

    const coords = row.geocoded_column?.coordinates;
    const longitude = Array.isArray(coords) && typeof coords[0] === "number" ? coords[0] : null;
    const latitude = Array.isArray(coords) && typeof coords[1] === "number" ? coords[1] : null;

    const typeLabel = [applicationType, worktype].filter(Boolean).join(" · ");
    const title = projectName ?? `${typeLabel || "Permit"}${address ? ` — ${address}` : ""}`;

    const payload = {
      permitNumber,
      applicationType,
      worktype,
      projectName,
      address,
      parcelNumber: cleanText(row.parcel_number),
      propertyOwner,
      parcelOwner,
      contractor,
      estimatedCost: toNumber(row.estimated_cost),
      squareFootage: toNumber(row.square_footage),
      planReviewType: cleanText(row.plan_review_type),
      status: cleanText(row.application_status),
      processedDate: processedAt?.toISOString().slice(0, 10) ?? null,
      underReviewDate: underReviewAt?.toISOString().slice(0, 10) ?? null,
      pendingIssuanceDate: pendingIssuanceAt?.toISOString().slice(0, 10) ?? null,
      issueDate: issuedAt?.toISOString().slice(0, 10) ?? null,
      finalDate: finalAt?.toISOString().slice(0, 10) ?? null,
      tempCooDate: tempCooAt?.toISOString().slice(0, 10) ?? null,
      cooDate: cooAt?.toISOString().slice(0, 10) ?? null,
      neighborhood: cleanText(row.neighborhood),
      commissionerDistrict: cleanText(row.commissioner_district),
      privateProvider: /^(y|yes|true)$/i.test(row.private_provider ?? "") ? true : null,
      privateProviderCompany: cleanText(row.private_provider_company_name),
    };

    // Prefer the untruncated owner column; Socrata clips parcel_owner_name at 30.
    const filer = propertyOwner ?? parcelOwner ?? null;
    const description = [
      typeLabel ? `${typeLabel} permit` : null,
      contractor ? `Contractor: ${contractor}` : null,
      payload.estimatedCost
        ? `Estimated cost: $${payload.estimatedCost.toLocaleString("en-US")}`
        : null,
      payload.squareFootage ? `${payload.squareFootage.toLocaleString("en-US")} sq ft` : null,
    ]
      .filter(Boolean)
      .join(". ");

    return {
      kind: "permit",
      externalId: permitNumber,
      url: raw.url,
      title,
      description: description || null,
      filer,
      filedAt: processedAt,
      status: payload.status,
      statusAt: latestDate(
        processedAt,
        underReviewAt,
        pendingIssuanceAt,
        issuedAt,
        finalAt,
        tempCooAt,
        cooAt,
      ),
      latitude,
      longitude,
      parcelId: payload.parcelNumber,
      address,
      payload,
      // Contractor names hit alias patterns too (Universal self-permits), and
      // the parcel owner is the truncated form the normalized filer may miss.
      linkText: [projectName, contractor, address, parcelOwner].filter(
        (s): s is string => s != null,
      ),
    };
  },

  resortFor(operator: Operator): string | null {
    return operator === "universal" ? "universal-orlando" : null;
  },
};
