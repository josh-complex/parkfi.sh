import { TRPCError } from "@trpc/server";
import { and, desc, eq, inArray, lt, or, sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "#/db/index.ts";
import {
  attractions,
  parks,
  publicRecord,
  publicRecordCursor,
  publicRecordLink,
  publicRecordRevision,
} from "#/db/schema.ts";
import { OPERATORS, RECORD_KINDS } from "#/lib/records.ts";
import { agencyFor } from "#/server/records/registry.ts";
import { publicProcedure } from "../init.ts";

import type { TRPCRouterRecord } from "@trpc/server";

/**
 * Public-records feed (docs/plans/public-records-intelligence.md §6). Pure
 * public reads over the `public_record` ledger — no per-user variation, so
 * every procedure here is on the edge-cache allowlist (`lib/cache.ts`).
 * Suppressed records never leave the server.
 */

const ENTITY_KINDS = ["park", "resort", "attraction"] as const;

/**
 * The feed's timeline axis: the record's latest as-filed activity (status
 * change, else filing date), falling back to our first sighting. Stable across
 * a backfill — a 2019 permit lands in 2019, not on the day we imported it —
 * and a revision (permit issued) bubbles the record back to the top.
 */
const activityAt = sql<Date>`coalesce(${publicRecord.statusAt}, ${publicRecord.filedAt}, ${publicRecord.firstSeenAt})`;

const recordColumns = {
  id: publicRecord.id,
  source: publicRecord.source,
  kind: publicRecord.kind,
  operator: publicRecord.operator,
  resortSlug: publicRecord.resortSlug,
  parkId: publicRecord.parkId,
  parkSlug: parks.slug,
  parkName: parks.name,
  filer: publicRecord.filer,
  title: publicRecord.title,
  description: publicRecord.description,
  url: publicRecord.url,
  filedAt: publicRecord.filedAt,
  status: publicRecord.status,
  statusAt: publicRecord.statusAt,
  address: publicRecord.address,
  latitude: publicRecord.latitude,
  longitude: publicRecord.longitude,
  score: publicRecord.score,
  firstSeenAt: publicRecord.firstSeenAt,
  changedAt: publicRecord.changedAt,
  activityAt,
} as const;

/** Minimal shape `present()` needs; the select above supplies the rest. */
interface RecordRowBase {
  id: number;
  source: string;
  parkId: number | null;
  parkSlug: string | null;
  parkName: string | null;
}

export interface ResolvedLink {
  entityKind: string;
  entityId: string;
  method: string;
  confidence: number;
  /** Display name (attraction / park name, resort slug). */
  label: string;
  /** Route params for the entity page, when we have one. */
  parkSlug: string | null;
  slug: string | null;
}

/** Resolve link rows to names + route slugs for a set of records. */
async function linksFor(recordIds: number[]): Promise<Map<number, ResolvedLink[]>> {
  const out = new Map<number, ResolvedLink[]>();
  if (recordIds.length === 0) return out;
  const rows = await db
    .select()
    .from(publicRecordLink)
    .where(inArray(publicRecordLink.recordId, recordIds));

  const attractionIds = rows
    .filter((r) => r.entityKind === "attraction")
    .map((r) => Number(r.entityId))
    .filter(Number.isFinite);
  const parkIds = rows
    .filter((r) => r.entityKind === "park")
    .map((r) => Number(r.entityId))
    .filter(Number.isFinite);

  const attractionRows = attractionIds.length
    ? await db
        .select({
          id: attractions.id,
          name: attractions.name,
          slug: attractions.slug,
          parkSlug: parks.slug,
        })
        .from(attractions)
        .innerJoin(parks, eq(parks.id, attractions.parkId))
        .where(inArray(attractions.id, attractionIds))
    : [];
  const parkRows = parkIds.length
    ? await db
        .select({ id: parks.id, name: parks.name, slug: parks.slug })
        .from(parks)
        .where(inArray(parks.id, parkIds))
    : [];
  const attractionById = new Map(attractionRows.map((a) => [String(a.id), a]));
  const parkById = new Map(parkRows.map((p) => [String(p.id), p]));

  for (const r of rows) {
    let label = r.entityId;
    let parkSlug: string | null = null;
    let slug: string | null = null;
    if (r.entityKind === "attraction") {
      const a = attractionById.get(r.entityId);
      if (!a) continue;
      label = a.name;
      parkSlug = a.parkSlug;
      slug = a.slug;
    } else if (r.entityKind === "park") {
      const p = parkById.get(r.entityId);
      if (!p) continue;
      label = p.name;
      slug = p.slug;
    } else if (r.entityKind === "resort") {
      label =
        r.entityId === "walt-disney-world"
          ? "Walt Disney World"
          : r.entityId === "universal-orlando"
            ? "Universal Orlando"
            : r.entityId;
      slug = r.entityId;
    }
    const list = out.get(r.recordId) ?? [];
    list.push({
      entityKind: r.entityKind,
      entityId: r.entityId,
      method: r.method,
      confidence: r.confidence,
      label,
      parkSlug,
      slug,
    });
    out.set(r.recordId, list);
  }
  for (const list of out.values()) list.sort((a, b) => b.confidence - a.confidence);
  return out;
}

function present<T extends RecordRowBase>(row: T, links: ResolvedLink[]) {
  const { parkSlug, parkName, ...rest } = row;
  return {
    ...rest,
    agency: agencyFor(row.source),
    park:
      row.parkId != null && parkSlug && parkName
        ? { id: row.parkId, slug: parkSlug, name: parkName }
        : null,
    links,
  };
}

/** `<activityAt ISO>|<id>` — stable keyset cursor over the feed order. */
function parseCursor(cursor: string | null | undefined): { at: Date; id: number } | null {
  if (!cursor) return null;
  const [ts, id] = cursor.split("|");
  const at = new Date(ts ?? "");
  const n = Number(id);
  if (Number.isNaN(at.getTime()) || !Number.isFinite(n)) return null;
  return { at, id: n };
}

export const recordsRouter = {
  /**
   * Reverse-chronological feed of records (by first sighting), filterable by
   * resort, park, kind and operator. Keyset-paginated.
   */
  feed: publicProcedure
    .input(
      z.object({
        resortSlug: z.string().min(1).optional(),
        parkId: z.number().int().positive().optional(),
        kinds: z.array(z.enum(RECORD_KINDS)).max(RECORD_KINDS.length).optional(),
        operator: z.enum(OPERATORS).optional(),
        /** Only records with as-filed activity in the last N days. */
        days: z.number().int().min(1).max(3650).optional(),
        limit: z.number().int().min(1).max(100).default(30),
        cursor: z.string().nullish(),
      }),
    )
    .query(async ({ input }) => {
      const cur = parseCursor(input.cursor);
      const since = input.days ? new Date(Date.now() - input.days * 86_400_000) : null;
      const rows = await db
        .select(recordColumns)
        .from(publicRecord)
        .leftJoin(parks, eq(parks.id, publicRecord.parkId))
        .where(
          and(
            eq(publicRecord.suppressed, false),
            input.resortSlug ? eq(publicRecord.resortSlug, input.resortSlug) : undefined,
            input.parkId ? eq(publicRecord.parkId, input.parkId) : undefined,
            input.kinds?.length ? inArray(publicRecord.kind, input.kinds) : undefined,
            input.operator ? eq(publicRecord.operator, input.operator) : undefined,
            since ? sql`${activityAt} >= ${since}` : undefined,
            cur
              ? or(
                  sql`${activityAt} < ${cur.at}`,
                  and(sql`${activityAt} = ${cur.at}`, lt(publicRecord.id, cur.id)),
                )
              : undefined,
          ),
        )
        .orderBy(desc(activityAt), desc(publicRecord.id))
        .limit(input.limit + 1);
      const hasMore = rows.length > input.limit;
      const page = hasMore ? rows.slice(0, input.limit) : rows;
      const links = await linksFor(page.map((r) => r.id));
      const last = page.at(-1);
      return {
        items: page.map((r) => present(r, links.get(r.id) ?? [])),
        nextCursor:
          hasMore && last ? `${new Date(last.activityAt).toISOString()}|${last.id}` : null,
      };
    }),

  /** One record with its links and revision timeline. */
  byId: publicProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .query(async ({ input }) => {
      const [row] = await db
        .select({
          ...recordColumns,
          payload: publicRecord.payload,
          externalId: publicRecord.externalId,
          parcelId: publicRecord.parcelId,
          lastSeenAt: publicRecord.lastSeenAt,
        })
        .from(publicRecord)
        .leftJoin(parks, eq(parks.id, publicRecord.parkId))
        .where(and(eq(publicRecord.id, input.id), eq(publicRecord.suppressed, false)))
        .limit(1);
      if (!row) throw new TRPCError({ code: "NOT_FOUND" });
      const [links, revisions] = await Promise.all([
        linksFor([row.id]),
        db
          .select({
            id: publicRecordRevision.id,
            seenAt: publicRecordRevision.seenAt,
            prevStatus: publicRecordRevision.prevStatus,
            nextStatus: publicRecordRevision.nextStatus,
            diff: publicRecordRevision.diff,
          })
          .from(publicRecordRevision)
          .where(eq(publicRecordRevision.recordId, row.id))
          .orderBy(desc(publicRecordRevision.seenAt)),
      ]);
      return {
        ...present(row, links.get(row.id) ?? []),
        externalId: row.externalId,
        parcelId: row.parcelId,
        lastSeenAt: row.lastSeenAt,
        payload: row.payload as Record<string, unknown>,
        revisions,
      };
    }),

  /** Records linked to one of our entities — the "Paper trail" section. */
  byEntity: publicProcedure
    .input(
      z.object({
        entityKind: z.enum(ENTITY_KINDS),
        entityId: z.string().min(1),
        limit: z.number().int().min(1).max(50).default(10),
      }),
    )
    .query(async ({ input }) => {
      const rows = await db
        .select(recordColumns)
        .from(publicRecordLink)
        .innerJoin(publicRecord, eq(publicRecord.id, publicRecordLink.recordId))
        .leftJoin(parks, eq(parks.id, publicRecord.parkId))
        .where(
          and(
            eq(publicRecordLink.entityKind, input.entityKind),
            eq(publicRecordLink.entityId, input.entityId),
            eq(publicRecord.suppressed, false),
          ),
        )
        .orderBy(desc(activityAt), desc(publicRecord.id))
        .limit(input.limit);
      const links = await linksFor(rows.map((r) => r.id));
      return rows.map((r) => present(r, links.get(r.id) ?? []));
    }),

  /** Counts by kind over a window + adapter run health, for the feed header. */
  summary: publicProcedure
    .input(
      z.object({
        resortSlug: z.string().min(1).optional(),
        operator: z.enum(OPERATORS).optional(),
        days: z.number().int().min(1).max(365).default(90),
      }),
    )
    .query(async ({ input }) => {
      const since = new Date(Date.now() - input.days * 86_400_000);
      const byKind = await db
        .select({ kind: publicRecord.kind, n: sql<number>`count(*)::int` })
        .from(publicRecord)
        .where(
          and(
            eq(publicRecord.suppressed, false),
            sql`${activityAt} >= ${since}`,
            input.resortSlug ? eq(publicRecord.resortSlug, input.resortSlug) : undefined,
            input.operator ? eq(publicRecord.operator, input.operator) : undefined,
          ),
        )
        .groupBy(publicRecord.kind);
      const [total] = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(publicRecord)
        .where(
          and(
            eq(publicRecord.suppressed, false),
            input.resortSlug ? eq(publicRecord.resortSlug, input.resortSlug) : undefined,
            input.operator ? eq(publicRecord.operator, input.operator) : undefined,
          ),
        );
      const sources = await db
        .select({
          source: publicRecordCursor.source,
          ranAt: publicRecordCursor.ranAt,
          stats: publicRecordCursor.stats,
        })
        .from(publicRecordCursor);
      return {
        days: input.days,
        byKind: byKind.map((r) => ({ kind: r.kind, n: r.n })),
        total: total?.n ?? 0,
        sources: sources.map((s) => ({ ...s, agency: agencyFor(s.source) })),
      };
    }),
} satisfies TRPCRouterRecord;
