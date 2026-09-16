/**
 * Florida DBPR — Division of Hotels and Restaurants food-service licences
 * (plan §5.15, B5). The earliest paper a NEW VENUE leaves, and the one place
 * the operators file the name they actually use internally.
 *
 * Two free CSV extracts, no key, no captcha:
 *
 *   • `newfood.csv`   — every licence approved since the fiscal year began
 *                       (~1,300 rows statewide), with the application type.
 *                       "Plan Review and Initial" is filed BEFORE the kitchen
 *                       is built, so it lands months ahead of an opening.
 *   • `chgownr_food.csv` — changes of ownership (a venue changing hands).
 *
 * Why it is worth a source of its own: the licence carries the venue's own
 * trade name at the operator's address. Epic Universe's live rows include
 * names Universal has never published — `UC LEGACY CLUB`, `CLUB JUPITER`,
 * `B1270 CARTS SUPPORT KITCHEN`, `EPIC KITCHEN`, `UNIVERSAL ORLANDO PK/ R&D`
 * — so a new venue's real name shows up here long before marketing, and a
 * building with a commercial kitchen (an event venue, a club, a lounge)
 * cannot open without one.
 *
 * Attribution: the licensee name goes through the shared alias table
 * (`UNIVERSAL CITY DEVELOPMENT%` and friends). That misses the third parties
 * who hold licences INSIDE the resorts — Loews' hotel entities, `UCF HOTEL
 * VENTURE VI` at Helios Grand — so a verified on-property ADDRESS list
 * carries those. The address list is deliberately narrow: `EPIC BLVD` also
 * exists in Saint Augustine, so every pattern is city-scoped.
 *
 * Identity is the licence number when there is one, else the application
 * number, so a row re-read from next week's file is the same record and an
 * amended one becomes a revision.
 */
import { parseCsv } from "../faa/csv.ts";
import { cleanText, matchAlias, normalizeFiler } from "../normalize.ts";

import type {
  Adapter,
  AdapterContext,
  FetchResult,
  Operator,
  PublicRecordInput,
  RawRecord,
} from "../types.ts";

export const DBPR_FOOD_SOURCE = "dbpr_food";

const EXTRACT_BASE =
  process.env.RECORDS_DBPR_BASE ?? "https://www2.myfloridalicense.com/sto/file_download/extracts";

/** The event extracts: what DBPR itself flags as new or transferred. */
export const DBPR_FILES = [
  { file: "newfood.csv", event: "new" as const },
  { file: "chgownr_food.csv", event: "ownership" as const },
];

/**
 * The full licensee roster for DBPR's Central Florida district — every active
 * food-service licence in the district, Universal's ~90 Epic Universe rows
 * included. The event files above only carry what DBPR approved this fiscal
 * year, so the roster is what catches a licence that predates the file and,
 * more usefully, a RENAME: the same licence number under a new trade name is
 * exactly what happens when an internal working name ("Sound Stage") becomes
 * the public one. First run seeds it and files nothing.
 */
const ROSTER_FILE = process.env.RECORDS_DBPR_ROSTER ?? "hrfood4.csv";

export type DbprEvent = (typeof DBPR_FILES)[number]["event"] | "roster" | "renamed";

/**
 * On-property addresses whose licences are the operator's business even when
 * the licensee is a hotel partner or a concessionaire. City-scoped on purpose.
 */
interface AddressRule {
  re: RegExp;
  city: RegExp;
  operator: Operator;
  resortSlug: string;
  /** What the address is, for the payload and the log. */
  place: string;
}

export const ON_PROPERTY: readonly AddressRule[] = [
  {
    re: /\b4700\s+W\.?\s*SAND\s*LAKE\b/i,
    city: /ORLANDO/i,
    operator: "universal",
    resortSlug: "universal-orlando",
    place: "Universal Epic Universe",
  },
  {
    re: /\bEPIC\s+BLVD\b/i,
    city: /ORLANDO/i,
    operator: "universal",
    resortSlug: "universal-orlando",
    place: "Epic Universe campus",
  },
  {
    re: /\b1000\s+UNIVERSAL\s+(STUDIOS?\s+)?(PLAZA|PLZ|PL\b)/i,
    city: /ORLANDO/i,
    operator: "universal",
    resortSlug: "universal-orlando",
    place: "Universal Studios Florida / Islands of Adventure",
  },
  {
    re: /\b6000\s+UNIVERSAL\s+(STUDIOS\s+)?(BLVD|BOULEVARD)/i,
    city: /ORLANDO/i,
    operator: "universal",
    resortSlug: "universal-orlando",
    place: "Universal CityWalk",
  },
  {
    re: /\b7297\s+TURKEY\s+LAKE\b/i,
    city: /ORLANDO/i,
    operator: "universal",
    resortSlug: "universal-orlando",
    place: "Universal Volcano Bay",
  },
  {
    re: /\b5911\s+PRODUCTION\s+PLAZA\b/i,
    city: /ORLANDO/i,
    operator: "universal",
    resortSlug: "universal-orlando",
    place: "Universal production campus",
  },
];

/** DBPR's numeric status codes, as the extract's own key describes them. */
const STATUS: Record<string, string> = {
  "20": "Current",
  "21": "Current — inactive",
  "22": "Delinquent",
  "23": "Closed",
  "24": "Suspended",
  "25": "Revoked",
};

/** The row we keep, normalized out of the extract's 38 columns. */
export interface DbprRow {
  event: DbprEvent;
  applicationNumber: string | null;
  applicationType: string | null;
  approvedOn: string | null;
  licenseNumber: string | null;
  licensee: string | null;
  businessName: string | null;
  address: string | null;
  city: string | null;
  county: string | null;
  status: string | null;
  seats: number | null;
  /** Set when an on-property address rule matched, not the licensee name. */
  place: string | null;
  operator: Operator | null;
  resortSlug: string | null;
}

/**
 * The extracts declare MORE header columns than their rows carry (38 vs 36 on
 * `newfood.csv` — the two risk-level columns are simply absent), so the strict
 * shared parser drops every row. Positional zip, truncating to whichever is
 * shorter, is what the agency's own documentation implies and what the data
 * checks out as.
 */
export function dbprRows(text: string): Array<Record<string, string>> {
  const table = parseCsv(text);
  const header = (table[0] ?? []).map((h) => h.trim());
  if (header.length === 0) return [];
  const out: Array<Record<string, string>> = [];
  for (const row of table.slice(1)) {
    if (row.length <= 1 && !(row[0] ?? "").trim()) continue;
    const o: Record<string, string> = {};
    for (let i = 0; i < Math.min(header.length, row.length); i++) o[header[i]!] = row[i] ?? "";
    out.push(o);
  }
  return out;
}

function pick(row: Record<string, string>, ...names: string[]): string | null {
  for (const n of names) {
    // The extracts ship at least one header with a trailing space
    // ("Application Approval Date "), so match on the trimmed key too.
    const hit =
      row[n] ?? Object.entries(row).find(([k]) => k.trim().toLowerCase() === n.toLowerCase())?.[1];
    const v = cleanText(hit);
    if (v) return v;
  }
  return null;
}

/** `MM/DD/YYYY` or `YYYY-MM-DD` → ISO day, else null. */
export function dbprDate(raw: string | null): string | null {
  if (!raw) return null;
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(raw);
  if (us) return `${us[3]}-${us[1]!.padStart(2, "0")}-${us[2]!.padStart(2, "0")}`;
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw);
  return iso ? `${iso[1]}-${iso[2]}-${iso[3]}` : null;
}

/**
 * One extract row → our shape, or null when it is nobody we track. Attribution
 * is alias-first (the licensee IS the operator), address-second (a partner or
 * concessionaire operating inside a park).
 */
export function normalizeRow(
  row: Record<string, string>,
  event: DbprEvent,
  aliases: AdapterContext["aliases"],
): DbprRow | null {
  const licensee = pick(row, "Licensee Name");
  const address = pick(row, "Location Street Address");
  const city = pick(row, "Location City");

  const alias = matchAlias(normalizeFiler(licensee), aliases);
  const rule =
    address && city
      ? (ON_PROPERTY.find((r) => r.re.test(address) && r.city.test(city)) ?? null)
      : null;
  if (!alias && !rule) return null;

  const seatsRaw = pick(row, "Number of Seats");
  const seats = seatsRaw && /^\d+$/.test(seatsRaw) ? Number(seatsRaw) : null;
  const statusCode = pick(row, "Primary Status Code");

  return {
    event,
    applicationNumber: pick(row, "Application Number"),
    applicationType: pick(row, "Application Type"),
    approvedOn: dbprDate(pick(row, "Application Approval Date")),
    licenseNumber: pick(row, "License Number"),
    licensee,
    businessName: pick(row, "Business Name"),
    address,
    city,
    county: pick(row, "Location County"),
    status: statusCode ? (STATUS[statusCode] ?? statusCode) : null,
    seats,
    place: rule?.place ?? null,
    operator: alias?.operator ?? rule?.operator ?? null,
    resortSlug: alias?.resortSlug ?? rule?.resortSlug ?? null,
  };
}

/** A plan review is filed before the kitchen exists — the earliest signal here. */
export function isPlanReview(applicationType: string | null): boolean {
  return /plan\s*review/i.test(applicationType ?? "");
}

export const dbprFoodAdapter: Adapter = {
  source: DBPR_FOOD_SOURCE,
  agency: "Florida DBPR",
  cadence: "weekly",
  // Most weeks the operators open nothing new; an empty run is the norm.
  quietWhenEmpty: true,

  async fetchSince(cursor, ctx): Promise<FetchResult> {
    const prior = (cursor?.files ?? {}) as Record<string, string>;
    const nextFiles: Record<string, string> = { ...prior };
    const records: RawRecord[] = [];

    for (const { file, event } of DBPR_FILES) {
      const url = `${EXTRACT_BASE}/${file}`;
      let text: string;
      try {
        const res = await ctx.fetch(url, { headers: { accept: "text/csv" }, signal: ctx.signal });
        if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`);
        const stamp = `${res.headers.get("last-modified") ?? ""}/${res.headers.get("content-length") ?? ""}`;
        text = await res.text();
        // The extracts are regenerated in place; an unchanged stamp means the
        // same rows we already upserted, so skip the parse (never the fetch —
        // the stamp is only trustworthy alongside the body).
        if (stamp.length > 1 && stamp === prior[file]) {
          ctx.log(`${file}: unchanged since the last run`);
          continue;
        }
        nextFiles[file] = stamp;
      } catch (err) {
        ctx.log(`${file}: fetch failed (${err instanceof Error ? err.message : err})`);
        continue;
      }

      if (!/licensee name/i.test(text.slice(0, 2000))) {
        ctx.log(`${file}: not the expected CSV (got ${text.slice(0, 60).replace(/\s+/g, " ")})`);
        continue;
      }

      const rows = dbprRows(text);
      let kept = 0;
      for (const raw of rows) {
        const row = normalizeRow(raw, event, ctx.aliases);
        if (!row) continue;
        const id = row.licenseNumber ?? row.applicationNumber;
        if (!id) continue;
        kept++;
        records.push({
          externalId: `${event}:${id}`,
          url: "https://www2.myfloridalicense.com/hotels-restaurants/public-records/",
          fetchedAt: new Date(),
          body: row,
        });
      }
      ctx.log(`${file}: ${rows.length} rows, ${kept} on operator property`);
    }

    // Roster pass: seed on the first run, then file anything new or renamed.
    const priorRoster = (cursor?.roster ?? null) as Record<string, string> | null;
    let nextRoster: Record<string, string> | null = priorRoster;
    try {
      const url = `${EXTRACT_BASE}/${ROSTER_FILE}`;
      const res = await ctx.fetch(url, { headers: { accept: "text/csv" }, signal: ctx.signal });
      if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`);
      const text = await res.text();
      const rows = dbprRows(text);
      const roster: Record<string, string> = {};
      const ours: DbprRow[] = [];
      for (const raw of rows) {
        const row = normalizeRow(raw, "roster", ctx.aliases);
        if (!row?.licenseNumber) continue;
        roster[row.licenseNumber] = row.businessName ?? "";
        ours.push(row);
      }
      if (Object.keys(roster).length === 0) {
        ctx.log(`${ROSTER_FILE}: ${rows.length} rows, none on operator property — roster held`);
      } else if (!priorRoster) {
        nextRoster = roster;
        ctx.log(`${ROSTER_FILE}: seeded ${Object.keys(roster).length} operator licences`);
      } else {
        nextRoster = roster;
        let added = 0;
        let renamed = 0;
        for (const row of ours) {
          const id = row.licenseNumber!;
          const before = priorRoster[id];
          const now = row.businessName ?? "";
          if (before === undefined) added++;
          else if (before !== now) renamed++;
          else continue;
          records.push({
            externalId: `roster:${id}`,
            url: "https://www2.myfloridalicense.com/hotels-restaurants/public-records/",
            fetchedAt: new Date(),
            body: {
              ...row,
              event: before === undefined ? "roster" : "renamed",
              previousName: before ?? null,
            },
          });
        }
        ctx.log(`${ROSTER_FILE}: ${added} new licence(s), ${renamed} renamed`);
      }
    } catch (err) {
      ctx.log(`${ROSTER_FILE}: fetch failed (${err instanceof Error ? err.message : err})`);
    }

    return { records, cursor: { files: nextFiles, roster: nextRoster } };
  },

  normalize(raw: RawRecord): PublicRecordInput | null {
    const row = raw.body as DbprRow;
    if (!row || typeof row.event !== "string") throw new Error("dbpr_food: body has no event");
    const name = row.businessName ?? row.licensee;
    if (!name) return null;

    const previousName =
      typeof (row as { previousName?: unknown }).previousName === "string"
        ? ((row as { previousName?: string }).previousName ?? null)
        : null;
    const what =
      row.event === "renamed"
        ? `licence renamed${previousName ? ` from ${previousName}` : ""}`
        : row.event === "ownership"
          ? "change of ownership"
          : row.event === "roster"
            ? "food service licence"
            : isPlanReview(row.applicationType)
              ? "plan review — pre-opening"
              : "new food service licence";

    return {
      kind: "license",
      externalId: raw.externalId,
      url: raw.url,
      title: `${name} — ${what}`,
      description: [
        row.applicationType,
        row.seats != null && row.seats > 0 ? `${row.seats} seats` : null,
        row.place,
        row.address,
      ]
        .filter(Boolean)
        .join(" · "),
      filer: row.licensee,
      operator: row.operator,
      resortSlug: row.resortSlug,
      filedAt: row.approvedOn ? new Date(`${row.approvedOn}T12:00:00Z`) : raw.fetchedAt,
      status: row.status,
      address: row.address,
      payload: {
        event: row.event,
        applicationNumber: row.applicationNumber,
        applicationType: row.applicationType,
        approvedOn: row.approvedOn,
        licenseNumber: row.licenseNumber,
        businessName: row.businessName,
        address: row.address,
        city: row.city,
        county: row.county,
        seats: row.seats,
        place: row.place,
        planReview: isPlanReview(row.applicationType),
        previousName,
      },
      // The venue name is the point: match it against our dining/shop catalog
      // both ways, so a known venue links and an unknown one stands out.
      linkText: [row.businessName, row.place].filter((v): v is string => Boolean(v)),
      entityNames: row.businessName ? [row.businessName] : [],
    };
  },

  linkTextOf(payload) {
    return [payload.businessName, payload.place].filter((v): v is string => typeof v === "string");
  },

  entityNamesOf(payload) {
    return typeof payload.businessName === "string" ? [payload.businessName] : [];
  },

  resortFor: (operator) => (operator === "universal" ? "universal-orlando" : null),
};
