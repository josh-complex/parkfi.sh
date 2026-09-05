/**
 * Public-records intelligence — shared contracts
 * (docs/plans/public-records-intelligence.md §4.2).
 *
 * An adapter is one government source: `fetchSince` pulls everything new or
 * changed past a cursor (filtering at the source when the source can), and
 * `normalize` is a pure function from one source row to our ledger shape.
 * Everything downstream — alias attribution, entity linking, scoring, upsert,
 * revisions — is shared (`ingest.ts`), so adding a destination or a source is
 * one adapter file, not a new pipeline.
 */
import type { GeoPolygon } from "#/db/schema.ts";
import type { PublicRecordKind } from "#/lib/records.ts";

export type { PublicRecordKind } from "#/lib/records.ts";

export type Operator = "disney" | "universal" | "seaworld";

/** One source row as fetched: identity, canonical government URL, and the body. */
export interface RawRecord {
  externalId: string;
  url: string;
  fetchedAt: Date;
  body: unknown;
}

/** The normalized ledger shape one adapter row becomes (before linking/scoring). */
export interface PublicRecordInput {
  kind: PublicRecordKind;
  externalId: string;
  url: string;
  title: string;
  description?: string | null;
  /** Verbatim owner / applicant / assignee / party. */
  filer?: string | null;
  filedAt?: Date | null;
  status?: string | null;
  statusAt?: Date | null;
  latitude?: number | null;
  longitude?: number | null;
  parcelId?: string | null;
  address?: string | null;
  /** Normalized source-native fields, already PII-stripped (plan §9). */
  payload: Record<string, unknown>;
  /** Extra as-filed text the linker may match entity names against. */
  linkText?: string[];
  /** Attribution the adapter already knows from jurisdiction (CFTOD = WDW). */
  operator?: Operator | null;
  resortSlug?: string | null;
}

/** A park's geo + ownership, as the linker and source filters need it. */
export interface ParkGeo {
  id: number;
  slug: string;
  name: string;
  resortSlug: string | null;
  operator: Operator | null;
  latitude: number | null;
  longitude: number | null;
  boundary: GeoPolygon | null;
}

export interface FilerAlias {
  pattern: string;
  operator: Operator;
  resortSlug: string | null;
}

export interface AdapterContext {
  fetch: typeof fetch;
  log: (message: string) => void;
  /** Aborts when the adapter's wall-clock budget is spent (plan §4.2). */
  signal: AbortSignal;
  /** Active parks with geo — for source-side radius filters. */
  parks: ParkGeo[];
  /** Curated filer aliases — for source-side name filters. */
  aliases: FilerAlias[];
  /** ISO date the first (cursor-less) run backfills from, when the source can. */
  backfillFrom: string;
}

export interface FetchResult {
  records: RawRecord[];
  /** The next cursor. Persisted only when the whole step succeeds. */
  cursor: Record<string, unknown>;
}

export interface Adapter {
  /** Ledger `source` id — stable forever, it's half the record identity. */
  source: string;
  /** Human label for logs and the UI's "View on <agency>" link. */
  agency: string;
  cadence: "daily" | "weekly";
  /** Pull everything new/changed since `cursor`. Must be idempotent. */
  fetchSince(cursor: Record<string, unknown> | null, ctx: AdapterContext): Promise<FetchResult>;
  /** Pure: source body → ledger input. Throw on schema drift; null = not ours. */
  normalize(raw: RawRecord): PublicRecordInput | null;
  /** Jurisdiction default: which resort an operator's filing in this source belongs to. */
  resortFor?(operator: Operator): string | null;
}
