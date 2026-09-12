/**
 * Parser for FDACS's "MOU Exempt Facilities Report" (plan §5.14, B4) — the
 * quarterly PDF in which Florida's exempt parks (Disney, Universal, SeaWorld,
 * Busch Gardens, LEGOLAND) report ride incidents that needed a hospital stay.
 *
 * The PDF is a Word export, not a table: per quarter a header line, then
 * facility labels ("Disney World:") introducing date-led rows
 * ("4/6/26 Snow Stormers, 41 yof, guest struck her head…") whose text wraps
 * onto continuation lines. One cumulative file goes back to Q4 2001, so a
 * parse yields the whole history every time; identity is a hash, not a
 * position.
 *
 * Privacy (plan §9): the guest's age and sex are read only to disambiguate
 * the identity hash and are NOT returned on the parsed row — nothing
 * downstream can render them.
 */
import { createHash } from "node:crypto";

import { cleanText } from "../normalize.ts";

export type FacilityKey = "disney" | "universal" | "seaworld" | "busch" | "legoland";

export interface ParsedIncident {
  /** Stable identity: sha256 (first 24 hex) over quarter, facility, date, ride, demographics, text head. */
  id: string;
  quarter: string; // "2026Q2"
  facility: FacilityKey;
  facilityLabel: string; // as printed
  /** YYYY-MM-DD as printed (M/D/YY or M/D/YYYY). */
  date: string;
  ride: string;
  /** Park named inline in older rows ("Epcot, Mission: Space, …"), else null. */
  park: string | null;
  description: string;
  /** Whether an age/sex token was present (for parser health stats only). */
  demographicsParsed: boolean;
}

export interface ParsedReport {
  updatedOn: string | null; // "2026-07-15"
  quarters: string[];
  incidents: ParsedIncident[];
  /** "None Reported" facility lines, by quarter — proves a quarter was read. */
  noneReported: number;
  /** Date-led rows whose text could not be split into ride + description. */
  malformed: number;
}

const FACILITY_RE =
  /^(Sea\s?World|Busch\s+Gardens|Disney(?:\s+World)?|Universal(?:\s+Orlando)?|Lego\s?land)\s*:?\s*(.*)$/i;
const QUARTER_RE = /^([1-4])(?:st|nd|rd|th)\s+Quarter(?:\s+(\d{4}))?\s*\(([^)]*)\)?/i;
const DATE_LEAD_RE = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})\s+(.*)$/;
const UPDATED_RE = /^Updated:\s*([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})/;
const NONE_RE = /^none\s+reported\.?$/i;
/** Boilerplate repeated at every page head. */
const BOILERPLATE_RE =
  /^(The following report is a compilation|of the incident\.|condition\.?$|MOU Exempt Facilities Report|<<<PAGE>>>)/;

/**
 * Age/sex as the parks write it: "41 yof", "40’s yom", "68, yof", "63 YOF",
 * "59 year old female", "female, age unknown", "a 22-year-old patron".
 * Captures (age | null, sex | null) and the span to cut out of the text.
 */
const DEMO_RES: RegExp[] = [
  /\b(\d{1,3})(?:['’]s)?\s*,?\s*y\/?o\s*([mf])\b\.?/i,
  /\b(\d{1,3})[\s-]+year[\s-]+old\s+(male|female|patron|guest)\b/i,
  /\b(male|female)\s*,\s*age\s+unknown\b/i,
];

const MONTHS: Record<string, number> = {
  january: 1,
  february: 2,
  march: 3,
  april: 4,
  may: 5,
  june: 6,
  july: 7,
  august: 8,
  september: 9,
  october: 10,
  november: 11,
  december: 12,
};

function facilityKey(label: string): FacilityKey {
  const l = label.toLowerCase().replace(/\s+/g, " ");
  if (l.startsWith("sea")) return "seaworld";
  if (l.startsWith("busch")) return "busch";
  if (l.startsWith("disney")) return "disney";
  if (l.startsWith("universal")) return "universal";
  return "legoland";
}

/** A "ride" that is really the complaint, in the 2003–04 symptom-first rows. */
const SYMPTOM_RE =
  /\b(pain|nausea|chest|dizz|faint|injur|fractur|seizure|sick|ill|knee|ankle|elbow|wrist|hypertension|feel|felt|well|cardiac|stroke|breath|headache|collapse)\b/i;

/** Park names older rows put before the ride ("Epcot, Mission: Space, …"). */
const PARK_PREFIX_RE =
  /^(epcot|mgm|disney[-\s]mgm(?: studios)?|magic kingdom|mk|animal kingdom|ak|dak|hollywood studios|dhs|typhoon lagoon|blizzard beach|disney['’]s blizzard beach|disney['’]s typhoon lagoon|islands of adventure|ioa|universal studios|usf|volcano bay|citywalk|wet\s?['’]?n\s?wild)$/i;

function isoDate(m: string, d: string, y: string, quarterYear: number | null): string | null {
  const month = Number(m);
  const day = Number(d);
  let year = Number(y);
  if (y.length === 2) year += year < 50 ? 2000 : 1900;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  // A two-digit year that disagrees wildly with the section is a typo; keep
  // the section's year so the row still lands in its quarter.
  if (quarterYear != null && Math.abs(year - quarterYear) > 1) year = quarterYear;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

interface Pending {
  quarter: string;
  quarterYear: number;
  facility: FacilityKey;
  facilityLabel: string;
  date: string;
  lines: string[];
}

/** Split "ride, 41 yof, description" (or the older park-first forms). */
export function splitIncidentText(text: string): {
  ride: string;
  park: string | null;
  description: string;
  age: string | null;
  sex: string | null;
} | null {
  let age: string | null = null;
  let sex: string | null = null;
  let body = text;
  for (const re of DEMO_RES) {
    const m = re.exec(body);
    if (!m) continue;
    const a = m[1] && /^\d/.test(m[1]) ? m[1] : null;
    const s = (m[2] ?? m[1] ?? "").toLowerCase();
    age = a;
    sex = s.startsWith("m") ? "m" : s.startsWith("f") ? "f" : null;
    body = `${body.slice(0, m.index)} ${body.slice(m.index + m[0].length)}`;
    break;
  }
  // Collapse the ", ," left where the token sat, then split on commas.
  const parts = body
    .split(",")
    .map((p) => cleanText(p))
    .filter((p): p is string => !!p);
  if (parts.length === 0) return null;
  let park: string | null = null;
  let ride: string;
  let rest: string[];
  if (parts.length >= 2 && PARK_PREFIX_RE.test(parts[0]!)) {
    park = parts[0]!;
    ride = parts[1]!;
    rest = parts.slice(2);
  } else {
    ride = parts[0]!;
    rest = parts.slice(1);
  }
  if (park) {
    // Older rows sometimes put the symptom before the ride ("Epcot, Chest
    // Pains, 59 year old female, Mission: Space"): when the only remaining
    // part is short and the "ride" reads as a symptom, swap them.
    if (rest.length === 1 && rest[0]!.length <= 30 && SYMPTOM_RE.test(ride)) {
      [ride, rest] = [rest[0]!, [ride]];
    }
    // Or the ride is omitted ("Disney's Blizzard Beach, 41 year old female,
    // injured ankle getting into raft"): the park is the venue.
    else if (
      (rest.length === 0 && SYMPTOM_RE.test(ride)) ||
      (ride.length > 40 && /\b(injur|fell|pain|hurt|struck|felt|lost)\b/i.test(ride))
    ) {
      rest = [ride, ...rest];
      ride = park;
    }
  }
  const description = rest
    .join(", ")
    .replace(/^[\s.;:-]+/, "")
    .trim();
  if (!ride || /^\d/.test(ride)) return null;
  return { ride: ride.replace(/\.$/, ""), park, description, age, sex };
}

function flush(p: Pending | null, out: ParsedReport): void {
  if (!p) return;
  const text = cleanText(p.lines.join(" "));
  const split = text ? splitIncidentText(text) : null;
  if (!split) {
    out.malformed++;
    return;
  }
  const id = createHash("sha256")
    .update(
      [
        p.quarter,
        p.facility,
        p.date,
        split.ride.toLowerCase(),
        split.age ?? "",
        split.sex ?? "",
        split.description.slice(0, 40).toLowerCase(),
      ].join("|"),
    )
    .digest("hex")
    .slice(0, 24);
  out.incidents.push({
    id,
    quarter: p.quarter,
    facility: p.facility,
    facilityLabel: p.facilityLabel,
    date: p.date,
    ride: split.ride,
    park: split.park,
    description: split.description,
    demographicsParsed: split.age != null || split.sex != null,
  });
}

/** Parse the report's extracted text (one line per printed line). */
export function parseExemptReport(text: string): ParsedReport {
  const out: ParsedReport = {
    updatedOn: null,
    quarters: [],
    incidents: [],
    noneReported: 0,
    malformed: 0,
  };
  let quarter: string | null = null;
  let quarterYear: number | null = null;
  let facility: { key: FacilityKey; label: string } | null = null;
  // Held in an object: `startRow` assigns it from a closure, which control-flow
  // narrowing cannot see through.
  const st: { pending: Pending | null } = { pending: null };

  const startRow = (dateText: string, rest: string): boolean => {
    const m = DATE_LEAD_RE.exec(`${dateText} ${rest}`.trim());
    if (!m || !quarter || quarterYear == null || !facility) return false;
    const date = isoDate(m[1]!, m[2]!, m[3]!, quarterYear);
    if (!date) return false;
    flush(st.pending, out);
    st.pending = {
      quarter,
      quarterYear,
      facility: facility.key,
      facilityLabel: facility.label,
      date,
      lines: [m[4]!],
    };
    return true;
  };

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/\s+/g, " ").trim();
    if (!line || BOILERPLATE_RE.test(line)) continue;

    const upd = UPDATED_RE.exec(line);
    if (upd) {
      const month = MONTHS[upd[1]!.toLowerCase()];
      if (month)
        out.updatedOn = `${upd[3]}-${String(month).padStart(2, "0")}-${upd[2]!.padStart(2, "0")}`;
      continue;
    }

    const q = QUARTER_RE.exec(line);
    if (q) {
      flush(st.pending, out);
      st.pending = null;
      facility = null;
      const yearInParens = /(\d{4})/.exec(q[3] ?? "")?.[1];
      const year = Number(q[2] ?? yearInParens);
      if (!Number.isFinite(year)) continue;
      quarterYear = year;
      quarter = `${year}Q${q[1]}`;
      out.quarters.push(quarter);
      continue;
    }

    const f = FACILITY_RE.exec(line);
    if (f && quarter) {
      flush(st.pending, out);
      st.pending = null;
      facility = { key: facilityKey(f[1]!), label: cleanText(f[1]) ?? f[1]! };
      const rest = f[2]?.trim() ?? "";
      if (!rest) continue;
      if (NONE_RE.test(rest)) {
        out.noneReported++;
        continue;
      }
      const d = DATE_LEAD_RE.exec(rest);
      if (d) startRow(`${d[1]}/${d[2]}/${d[3]}`, d[4]!);
      continue;
    }

    const d = DATE_LEAD_RE.exec(line);
    if (d && facility) {
      startRow(`${d[1]}/${d[2]}/${d[3]}`, d[4]!);
      continue;
    }

    // Continuation of the current row's wrapped text.
    if (st.pending) st.pending.lines.push(line);
  }
  flush(st.pending, out);
  return out;
}
