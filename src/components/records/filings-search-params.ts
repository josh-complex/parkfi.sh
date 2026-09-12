/**
 * URL <-> filter bridge for `/filings` (plan §6.1a). Every filter the feed
 * offers round-trips through the route's search params so a filtered view is
 * shareable and survives Back. Defaults are omitted rather than encoded, so
 * the bare `/filings` URL stays canonical for crawlers.
 */
import { OPERATORS, RECORD_KINDS, type Operator, type PublicRecordKind } from "#/lib/records.ts";

export const FILINGS_SORTS = ["activity", "score", "size"] as const;
export type FilingsSort = (typeof FILINGS_SORTS)[number];

export const FILINGS_STATUSES = ["open", "issued", "closed"] as const;
export type FilingsStatus = (typeof FILINGS_STATUSES)[number];

/** Windows offered as chips. `DEFAULT_WINDOW` is what an unqualified URL means. */
export const FILINGS_WINDOWS = [30, 90, 365] as const;
export const DEFAULT_WINDOW = 90;

export interface FilingsSearch {
  /** Substring over title, job title, filer, address, record number. */
  q?: string;
  op?: Operator;
  kind?: PublicRecordKind[];
  park?: number;
  status?: FilingsStatus;
  /** Window in days, or "all"; omitted = `DEFAULT_WINDOW`. */
  days?: number | "all";
  /** Omitted = "activity". */
  sort?: Exclude<FilingsSort, "activity">;
  /** Include jobs made only of maintenance-noise tickets. */
  routine?: true;
  /** Flat record list instead of jobs. */
  view?: "records";
}

const KIND_SET = new Set<string>(RECORD_KINDS);
const OPERATOR_SET = new Set<string>(OPERATORS);

/** Coerce raw (untrusted) URL search into a typed `FilingsSearch`. */
export function validateFilingsSearch(search: Record<string, unknown>): FilingsSearch {
  const out: FilingsSearch = {};
  if (typeof search.q === "string" && search.q.trim().length >= 2)
    out.q = search.q.trim().slice(0, 80);
  if (typeof search.op === "string" && OPERATOR_SET.has(search.op)) out.op = search.op as Operator;
  const kinds = (Array.isArray(search.kind) ? search.kind : [search.kind]).filter(
    (k): k is PublicRecordKind => typeof k === "string" && KIND_SET.has(k),
  );
  if (kinds.length) out.kind = [...new Set(kinds)];
  const park = Number(search.park);
  if (Number.isInteger(park) && park > 0) out.park = park;
  if (
    typeof search.status === "string" &&
    (FILINGS_STATUSES as readonly string[]).includes(search.status)
  ) {
    out.status = search.status as FilingsStatus;
  }
  if (search.days === "all") out.days = "all";
  else {
    const d = Number(search.days);
    if (Number.isInteger(d) && d > 0 && d <= 3650 && d !== DEFAULT_WINDOW) out.days = d;
  }
  if (search.sort === "score" || search.sort === "size") out.sort = search.sort;
  if (search.routine === true || search.routine === "true") out.routine = true;
  if (search.view === "records") out.view = "records";
  return out;
}

/** The window as the API wants it: a day count, or undefined for all time. */
export function windowDays(s: FilingsSearch): number | undefined {
  if (s.days === "all") return undefined;
  return s.days ?? DEFAULT_WINDOW;
}

/** How many non-default filters are set — the badge on the mobile Filters button. */
export function activeFilterCount(s: FilingsSearch): number {
  let n = 0;
  if (s.q) n++;
  if (s.op) n++;
  if (s.kind?.length) n++;
  if (s.park) n++;
  if (s.status) n++;
  if (s.days !== undefined) n++;
  if (s.sort) n++;
  if (s.routine) n++;
  return n;
}

/** Drop keys whose value is undefined/empty so the URL stays minimal. */
export function cleanSearch(s: FilingsSearch): FilingsSearch {
  const out: FilingsSearch = {};
  if (s.q) out.q = s.q;
  if (s.op) out.op = s.op;
  if (s.kind?.length) out.kind = s.kind;
  if (s.park) out.park = s.park;
  if (s.status) out.status = s.status;
  if (s.days !== undefined && s.days !== DEFAULT_WINDOW) out.days = s.days;
  if (s.sort) out.sort = s.sort;
  if (s.routine) out.routine = true;
  if (s.view) out.view = s.view;
  return out;
}
