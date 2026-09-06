/**
 * The shared ingest loop every adapter runs through (plan §4.2 rules):
 *
 *   cursor → adapter.fetchSince → adapter.normalize → alias attribution →
 *   entity links → score → upsert on (source, external_id) → revision on
 *   content change → cursor + run stats.
 *
 * Attribution rule: a record is persisted only when it's attributable to an
 * operator (filer alias, adapter jurisdiction, or a contractor/owner string in
 * its link text) OR it carries a point inside a park polygon. Everything else
 * is a tenant or a stranger and is dropped before it touches the ledger.
 *
 * Revisions: an unchanged content hash only touches `last_seen_at`; a changed
 * one writes a `public_record_revision` diff, bumps `changed_at`, re-scores,
 * and rebuilds the auto links — unless an admin link exists on the record, in
 * which case the auto links are left alone (admin override wins, §4.3).
 */
import { and, eq, inArray, sql } from "drizzle-orm";

import { db } from "#/db/index.ts";
import {
  publicRecord,
  publicRecordCursor,
  publicRecordFilerAlias,
  publicRecordLink,
  publicRecordRevision,
} from "#/db/schema.ts";
import { config } from "#/server/parks/config.ts";

import { computeLinks, loadEntityCatalog, type EntityCatalog, type EntityLink } from "./link.ts";
import { contentHash, diffPayload, matchAlias, normalizeFiler } from "./normalize.ts";
import { scoreRecord } from "./score.ts";

import type { Adapter, FilerAlias, Operator, PublicRecordInput } from "./types.ts";

export interface IngestStats {
  fetched: number;
  /** Normalized and attributed — the rows that reached the upsert. */
  kept: number;
  inserted: number;
  changed: number;
  unchanged: number;
  /** Not ours (no attribution and no in-park point), or normalize returned null. */
  skipped: number;
  /** normalize() threw (schema drift) — logged, never fatal. */
  errors: number;
  /** Score distribution of inserted + changed rows, for threshold tuning. */
  scoreP50: number | null;
  scoreMax: number | null;
}

export interface IngestOptions {
  /** Wall-clock cap for the adapter's fetch phase. */
  budgetMs: number;
  backfillFrom: string;
  log: (message: string) => void;
  /** Shared across adapters in one run; loaded on demand when absent. */
  catalog?: EntityCatalog;
  aliases?: FilerAlias[];
}

export async function loadAliases(): Promise<FilerAlias[]> {
  const rows = await db.select().from(publicRecordFilerAlias);
  return rows.map((r) => ({
    pattern: r.pattern,
    operator: r.operator as Operator,
    resortSlug: r.resortSlug,
  }));
}

async function readCursor(source: string): Promise<Record<string, unknown> | null> {
  const [row] = await db
    .select({ cursor: publicRecordCursor.cursor })
    .from(publicRecordCursor)
    .where(eq(publicRecordCursor.source, source))
    .limit(1);
  return row?.cursor ?? null;
}

/** Last run time per source — the cron uses it to skip weekly adapters that aren't due. */
export async function lastRanAt(source: string): Promise<Date | null> {
  const [row] = await db
    .select({ ranAt: publicRecordCursor.ranAt })
    .from(publicRecordCursor)
    .where(eq(publicRecordCursor.source, source))
    .limit(1);
  return row?.ranAt ?? null;
}

interface Prepared {
  input: PublicRecordInput;
  filerNorm: string | null;
  operator: Operator | null;
  resortSlug: string | null;
  parkId: number | null;
  links: EntityLink[];
  score: number;
  hash: string;
  operatorFiler: boolean;
  linkResult: ReturnType<typeof computeLinks>;
}

/**
 * Pure-ish per-record pipeline: attribution → links → score. Exported so the
 * cron's dry-run mode and tests can exercise it without a database.
 */
export function prepareRecord(
  adapter: Adapter,
  input: PublicRecordInput,
  catalog: EntityCatalog,
  aliases: FilerAlias[],
): Prepared | null {
  const filerNorm = normalizeFiler(input.filer);
  let alias = matchAlias(filerNorm, aliases);
  // Contractor / secondary-owner strings the adapter exposed for linking can
  // carry the attribution when the primary filer is a tenant or blank.
  if (!alias) {
    for (const s of input.linkText ?? []) {
      alias = matchAlias(normalizeFiler(s), aliases);
      if (alias) break;
    }
  }
  const operator: Operator | null = input.operator ?? alias?.operator ?? null;
  const resortHint =
    input.resortSlug ??
    alias?.resortSlug ??
    (operator && adapter.resortFor ? adapter.resortFor(operator) : null);

  const linkResult = computeLinks({ ...input, operator, resortSlug: resortHint }, catalog);
  if (!linkResult.operator && linkResult.polygonParkId == null && !input.alwaysKeep) return null;

  const operatorFiler = alias != null || input.operator != null;
  const score = scoreRecord(input, { operatorFiler, links: linkResult });
  return {
    input,
    filerNorm,
    operator: linkResult.operator,
    resortSlug: linkResult.resortSlug,
    parkId: linkResult.parkId,
    links: linkResult.links,
    score,
    hash: contentHash(input),
    operatorFiler,
    linkResult,
  };
}

function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] ?? null;
}

/** Run one adapter end to end. Throws only when the FETCH fails (cursor is then held). */
export async function runAdapter(adapter: Adapter, opts: IngestOptions): Promise<IngestStats> {
  const stats: IngestStats = {
    fetched: 0,
    kept: 0,
    inserted: 0,
    changed: 0,
    unchanged: 0,
    skipped: 0,
    errors: 0,
    scoreP50: null,
    scoreMax: null,
  };
  const catalog = opts.catalog ?? (await loadEntityCatalog());
  const aliases = opts.aliases ?? (await loadAliases());
  const cursor = await readCursor(adapter.source);
  const log = (m: string) => opts.log(`[${adapter.source}] ${m}`);

  const { records, cursor: nextCursor } = await adapter.fetchSince(cursor, {
    fetch: (input, init) =>
      fetch(input, {
        ...init,
        headers: {
          "user-agent": config.userAgent,
          ...(init?.headers as Record<string, string> | undefined),
        },
      }),
    log,
    signal: AbortSignal.timeout(opts.budgetMs),
    parks: catalog.parks,
    aliases,
    backfillFrom: opts.backfillFrom,
  });
  stats.fetched = records.length;

  // Normalize + attribute everything first so the DB phase is one tight loop.
  const prepared: Prepared[] = [];
  for (const raw of records) {
    let input: PublicRecordInput | null;
    try {
      input = adapter.normalize(raw);
    } catch (err) {
      stats.errors++;
      if (stats.errors <= 5)
        log(`normalize failed for ${raw.externalId}: ${err instanceof Error ? err.message : err}`);
      continue;
    }
    if (!input) {
      stats.skipped++;
      continue;
    }
    const p = prepareRecord(adapter, input, catalog, aliases);
    if (!p) {
      stats.skipped++;
      continue;
    }
    prepared.push(p);
  }
  stats.kept = prepared.length;

  const scores: number[] = [];
  for (let i = 0; i < prepared.length; i += 500) {
    const chunk = prepared.slice(i, i + 500);
    const existing = await db
      .select({
        id: publicRecord.id,
        externalId: publicRecord.externalId,
        contentHash: publicRecord.contentHash,
        status: publicRecord.status,
        payload: publicRecord.payload,
      })
      .from(publicRecord)
      .where(
        and(
          eq(publicRecord.source, adapter.source),
          inArray(
            publicRecord.externalId,
            chunk.map((p) => p.input.externalId),
          ),
        ),
      );
    const byExternalId = new Map(existing.map((e) => [e.externalId, e]));
    const adminLinked = new Set(
      (
        await db
          .select({ recordId: publicRecordLink.recordId })
          .from(publicRecordLink)
          .where(
            and(
              inArray(
                publicRecordLink.recordId,
                existing.map((e) => e.id),
              ),
              eq(publicRecordLink.createdBy, "admin"),
            ),
          )
      ).map((r) => r.recordId),
    );

    for (const p of chunk) {
      const prev = byExternalId.get(p.input.externalId);
      const { input } = p;
      const columns = {
        kind: input.kind,
        operator: p.operator,
        resortSlug: p.resortSlug,
        parkId: p.parkId,
        filer: input.filer ?? null,
        filerNorm: p.filerNorm,
        title: input.title,
        description: input.description ?? null,
        url: input.url,
        filedAt: input.filedAt ?? null,
        status: input.status ?? null,
        statusAt: input.statusAt ?? null,
        latitude: input.latitude ?? null,
        longitude: input.longitude ?? null,
        parcelId: input.parcelId ?? null,
        address: input.address ?? null,
        payload: input.payload,
        contentHash: p.hash,
      };

      if (!prev) {
        const [row] = await db
          .insert(publicRecord)
          .values({
            ...columns,
            source: adapter.source,
            externalId: input.externalId,
            score: p.score,
          })
          .onConflictDoNothing()
          .returning({ id: publicRecord.id });
        if (!row) continue; // raced with a concurrent run; next run reconciles
        await writeLinks(row.id, p.links);
        // A later occurrence of the same record in THIS run (a mark whose
        // status moved across several daily files) must take the change path
        // below, not collide with the row we just inserted and get dropped.
        byExternalId.set(input.externalId, {
          id: row.id,
          externalId: input.externalId,
          contentHash: p.hash,
          status: input.status ?? null,
          payload: input.payload,
        });
        stats.inserted++;
        scores.push(p.score);
        continue;
      }

      if (prev.contentHash === p.hash) {
        await db
          .update(publicRecord)
          .set({ lastSeenAt: sql`now()` })
          .where(eq(publicRecord.id, prev.id));
        stats.unchanged++;
        continue;
      }

      // Content changed: status transitions raise the score, the diff is the news.
      const transition = { from: prev.status, to: input.status ?? null };
      const score = scoreRecord(input, {
        operatorFiler: p.operatorFiler,
        links: p.linkResult,
        statusTransition: transition,
      });
      await db.insert(publicRecordRevision).values({
        recordId: prev.id,
        prevStatus: prev.status,
        nextStatus: input.status ?? null,
        diff: diffPayload(prev.payload, input.payload),
      });
      const keepAdmin = adminLinked.has(prev.id);
      // Admin-relinked records keep their park assignment as well as their links.
      const { parkId: autoParkId, ...columnsSansPark } = columns;
      await db
        .update(publicRecord)
        .set({
          ...columnsSansPark,
          ...(keepAdmin ? {} : { parkId: autoParkId }),
          score,
          lastSeenAt: sql`now()`,
          changedAt: sql`now()`,
        })
        .where(eq(publicRecord.id, prev.id));
      if (!keepAdmin) {
        await db
          .delete(publicRecordLink)
          .where(
            and(eq(publicRecordLink.recordId, prev.id), eq(publicRecordLink.createdBy, "auto")),
          );
        await writeLinks(prev.id, p.links);
      }
      byExternalId.set(input.externalId, {
        ...prev,
        contentHash: p.hash,
        status: input.status ?? null,
        payload: input.payload,
      });
      stats.changed++;
      scores.push(score);
    }
  }

  stats.scoreP50 = percentile(scores, 0.5);
  stats.scoreMax = scores.length ? Math.max(...scores) : null;

  await db
    .insert(publicRecordCursor)
    .values({ source: adapter.source, cursor: nextCursor, stats: statsForDb(stats) })
    .onConflictDoUpdate({
      target: publicRecordCursor.source,
      set: { cursor: nextCursor, ranAt: sql`now()`, stats: statsForDb(stats) },
    });
  return stats;
}

function statsForDb(stats: IngestStats): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(stats)) if (typeof v === "number") out[k] = v;
  return out;
}

async function writeLinks(recordId: number, links: EntityLink[]): Promise<void> {
  if (links.length === 0) return;
  await db
    .insert(publicRecordLink)
    .values(
      links.map((l) => ({
        recordId,
        entityKind: l.entityKind,
        entityId: l.entityId,
        method: l.method,
        confidence: l.confidence,
      })),
    )
    .onConflictDoNothing();
}
