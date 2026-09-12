/**
 * Presentation vocabulary for filing-watch alerts (public-records plan §6.3).
 * Pure functions + the persisted payload shape, shared by the evaluator, the
 * mailer and the push job so an email, a push and the audit row all say the
 * same thing.
 *
 * The wording rules of plan §9 live here as much as in the blog prompt: a
 * filing is described with the agency's own verb ("filed", "issued",
 * "determined"), never as an announcement, and never with a guess at purpose.
 */

/** One matched record as carried in a notification payload. */
export interface FilingNotificationRecord {
  id: number;
  source: string;
  kind: string;
  title: string;
  filer: string | null;
  status: string | null;
  url: string;
  /** Our park link, when the record has one. */
  park: string | null;
  /** Park-local `YYYY-MM-DD` the agency recorded it, when known. */
  filedOn: string | null;
}

export interface FilingNotificationPayload {
  /** What the user watched, e.g. "Universal Orlando" or "“villains” filings". */
  watchLabel: string;
  subject: string;
  /** Total matched this run (may exceed `records.length`). */
  count: number;
  records: FilingNotificationRecord[];
  /** Matches beyond the ones carried above. */
  moreCount: number;
}

/** Human label for a `public_record.kind`. Unknown kinds degrade to "filing". */
const KIND_LABELS: Record<string, string> = {
  permit: "Permit",
  noc: "Notice of Commencement",
  deed: "Deed",
  airspace: "FAA airspace study",
  erp: "Environmental permit",
  planning_case: "Planning case",
  board_item: "Board agenda item",
  trademark: "Trademark",
  patent_app: "Patent application",
  patent_grant: "Patent",
  assignment: "IP assignment",
  lawsuit: "Lawsuit",
  sec_filing: "SEC filing",
  corp_filing: "Corporate filing",
  incident: "Incident report",
  license: "License",
  tls_cert: "Certificate",
};

export function kindLabel(kind: string): string {
  return KIND_LABELS[kind] ?? "Filing";
}

/** Plural-safe label, e.g. "2 permits", "1 trademark". */
export function kindCount(kind: string, n: number): string {
  const label = kindLabel(kind).toLowerCase();
  return `${n} ${label}${n === 1 ? "" : "s"}`;
}

/**
 * The alert's subject line. One match names the record; several summarize by
 * count. Deliberately flat: "filed", never "coming" — a watch firing is news
 * that a document exists, not that a project is happening.
 */
export function filingSubject(payload: Omit<FilingNotificationPayload, "subject">): string {
  const [first] = payload.records;
  if (payload.count === 1 && first) {
    return `${kindLabel(first.kind)} filed: ${truncate(first.title, 80)}`;
  }
  return `${payload.count} new filings — ${payload.watchLabel}`;
}

/** Push body: the top titles, comma-joined, trimmed to a notification's width. */
export function filingPushBody(payload: FilingNotificationPayload): string {
  const titles = payload.records.slice(0, 3).map((r) => truncate(r.title, 48));
  const rest = payload.count - titles.length;
  return rest > 0 ? `${titles.join(" · ")} +${rest} more` : titles.join(" · ");
}

export function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max - 1).trimEnd()}…`;
}
