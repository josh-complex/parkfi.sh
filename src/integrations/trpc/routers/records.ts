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
  jobKey: publicRecord.jobKey,
  jobTitle: publicRecord.jobTitle,
  // How many tickets share this record's job (1 for a singleton) — lets a
  // card say "part of a 15-permit job" without a second query.
  jobSize: sql<number>`coalesce((select count(*)::int from public_record j
    where j.job_key = ${publicRecord.jobKey} and j.suppressed = false), 1)`,
} as const;

/**
 * Status text → one of four buckets, mirroring `StatusBadge` in the UI so the
 * filter and the chip agree. Orlando: Open/Hold → open, Finaled/Closed → closed;
 * USPTO: Registered/Granted → issued, Abandoned → closed.
 */
const statusClass = sql<string>`case
  when ${publicRecord.status} ~* '(issued|approved|registered|granted|active)' then 'issued'
  when ${publicRecord.status} ~* '(final|closed|complete|expired|abandoned|void|denied|cancel)' then 'closed'
  when ${publicRecord.status} is null then 'unknown'
  else 'open' end`;

/**
 * Maintenance noise (plan §6.1a "routine"): the same lists `score.ts` already
 * penalises, plus low-voltage / tent work. A job is routine when EVERY ticket
 * is; the feed hides those by default.
 */
const routine = sql<boolean>`(
  coalesce(${publicRecord.payload}->>'worktype', '') ~* '(fence|sign|temp|asbuilt|as-built|repair|reroof|re-roof|demo|pool|irrigation|lowvoltage|tent)'
  or ${publicRecord.title} ~* '\yannual\y'
  or coalesce(${publicRecord.payload}->>'projectName', '') ~* '\yannual\y'
)`;

/** Permit family from the record number (BLD2019-15795 → BLD); other sources use the kind. */
const family = sql<string>`case when ${publicRecord.source} = 'orlando_soda'
  then coalesce(substring(${publicRecord.externalId} from '^[A-Z]+'), 'OTHER')
  else ${publicRecord.kind} end`;

/** A job's identity: its key, or the record itself when it has none. */
const jobIdentity = sql<string>`coalesce(${publicRecord.jobKey}, 'rec:' || ${publicRecord.id})`;

const JOB_SORTS = ["activity", "score", "size"] as const;
const STATUS_FILTERS = ["open", "issued", "closed"] as const;

/** Escape a user string for ILIKE — `%`/`_` become literals. */
function likeContains(q: string): string {
  return `%${q.replace(/[\\%_]/g, "\\$&")}%`;
}

function tally(values: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const v of values) out[v] = (out[v] ?? 0) + 1;
  return out;
}

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

  /**
   * The feed grouped by job (plan §6.1a): one row per project / mark / study
   * family with its ticket count, trade mix, status roll-up and date span.
   * Records with no job key are their own single-ticket job, so this is a
   * superset view of `feed`, not a filter on it. Offset-paginated (jobs are
   * few thousand and the result is edge-cached).
   */
  jobs: publicProcedure
    .input(
      z.object({
        resortSlug: z.string().min(1).optional(),
        parkId: z.number().int().positive().optional(),
        kinds: z.array(z.enum(RECORD_KINDS)).max(RECORD_KINDS.length).optional(),
        operator: z.enum(OPERATORS).optional(),
        /** Only jobs whose latest as-filed activity is within N days. */
        days: z.number().int().min(1).max(3650).optional(),
        /** Substring over title, job title, filer, address, record number. */
        q: z.string().trim().min(2).max(80).optional(),
        /** Jobs with at least one ticket in this status bucket. */
        status: z.enum(STATUS_FILTERS).optional(),
        /** Include jobs made only of maintenance-noise tickets. */
        routine: z.boolean().default(false),
        sort: z.enum(JOB_SORTS).default("activity"),
        limit: z.number().int().min(1).max(100).default(30),
        offset: z.number().int().min(0).max(5000).default(0),
      }),
    )
    .query(async ({ input }) => {
      const since = input.days ? new Date(Date.now() - input.days * 86_400_000) : null;
      const q = input.q ? likeContains(input.q) : null;
      const ticketWhere = and(
        eq(publicRecord.suppressed, false),
        input.resortSlug ? eq(publicRecord.resortSlug, input.resortSlug) : undefined,
        input.parkId ? eq(publicRecord.parkId, input.parkId) : undefined,
        input.kinds?.length ? inArray(publicRecord.kind, input.kinds) : undefined,
        input.operator ? eq(publicRecord.operator, input.operator) : undefined,
      );
      const searchHit = q
        ? sql<boolean>`(${publicRecord.title} ilike ${q} or ${publicRecord.jobTitle} ilike ${q}
            or ${publicRecord.filer} ilike ${q} or ${publicRecord.address} ilike ${q}
            or ${publicRecord.externalId} ilike ${q})`
        : sql<boolean>`true`;
      const orderBy =
        input.sort === "score"
          ? sql`max_score desc, latest_at desc, job_key`
          : input.sort === "size"
            ? sql`ticket_count desc, latest_at desc, job_key`
            : sql`latest_at desc, job_key`;

      const rows = await db.execute<{
        job_key: string;
        job_title: string;
        source: string;
        kind: string;
        operator: string | null;
        resort_slug: string | null;
        park_id: string | null;
        park_slug: string | null;
        park_name: string | null;
        address: string | null;
        filer: string | null;
        ticket_count: number;
        families: string[];
        statuses: string[];
        first_filed_at: Date;
        latest_at: Date;
        max_score: number;
        routine: boolean;
        top_ids: string[];
      }>(sql`
        with t as (
          select ${publicRecord.id} as id, ${publicRecord.source} as source, ${publicRecord.kind} as kind,
                 ${publicRecord.operator} as operator, ${publicRecord.resortSlug} as resort_slug,
                 ${publicRecord.parkId} as park_id, ${publicRecord.address} as address,
                 ${publicRecord.filer} as filer, ${publicRecord.score} as score,
                 ${jobIdentity} as job_key,
                 coalesce(${publicRecord.jobTitle}, ${publicRecord.title}) as job_title,
                 ${activityAt} as activity_at,
                 coalesce(${publicRecord.filedAt}, ${publicRecord.firstSeenAt}) as filed_at,
                 ${statusClass} as status_class, ${routine} as routine, ${family} as family,
                 ${searchHit} as search_hit
          from ${publicRecord}
          where ${ticketWhere}
        ), j as (
          select job_key,
                 (array_agg(job_title order by score desc, id desc))[1] as job_title,
                 (array_agg(source order by score desc, id desc))[1] as source,
                 mode() within group (order by kind) as kind,
                 mode() within group (order by operator) filter (where operator is not null) as operator,
                 mode() within group (order by resort_slug) filter (where resort_slug is not null) as resort_slug,
                 mode() within group (order by park_id) filter (where park_id is not null) as park_id,
                 mode() within group (order by address) filter (where address is not null) as address,
                 mode() within group (order by filer) filter (where filer is not null) as filer,
                 count(*)::int as ticket_count,
                 array_agg(family) as families,
                 array_agg(status_class) as statuses,
                 min(filed_at) as first_filed_at,
                 max(activity_at) as latest_at,
                 max(score) as max_score,
                 bool_and(routine) as routine,
                 (array_agg(id order by score desc, id desc))[1:3] as top_ids,
                 bool_or(search_hit) as search_hit,
                 bool_or(status_class = ${input.status ?? ""}) as status_hit
          from t
          group by job_key
        )
        select j.*, p.slug as park_slug, p.name as park_name
        from j left join ${parks} p on p.id = j.park_id
        where j.search_hit
          ${input.status ? sql`and j.status_hit` : sql``}
          ${input.routine ? sql`` : sql`and not j.routine`}
          ${since ? sql`and j.latest_at >= ${since}` : sql``}
        order by ${orderBy}
        limit ${input.limit + 1} offset ${input.offset}
      `);
      const hasMore = rows.rows.length > input.limit;
      const page = hasMore ? rows.rows.slice(0, input.limit) : rows.rows;
      const topIds = page.flatMap((r) => r.top_ids.map(Number));
      const links = await linksFor(topIds);
      return {
        items: page.map((r) => {
          const ids = r.top_ids.map(Number);
          // Union of the top tickets' links, deduped by entity.
          const seen = new Set<string>();
          const jobLinks: ResolvedLink[] = [];
          for (const id of ids) {
            for (const l of links.get(id) ?? []) {
              const k = `${l.entityKind}:${l.entityId}`;
              if (seen.has(k)) continue;
              seen.add(k);
              jobLinks.push(l);
            }
          }
          return {
            jobKey: r.job_key,
            title: r.job_title,
            source: r.source,
            agency: agencyFor(r.source),
            kind: r.kind,
            operator: r.operator,
            resortSlug: r.resort_slug,
            park:
              r.park_id != null && r.park_slug && r.park_name
                ? { id: Number(r.park_id), slug: r.park_slug, name: r.park_name }
                : null,
            address: r.address,
            filer: r.filer,
            ticketCount: Number(r.ticket_count),
            families: tally(r.families),
            statuses: tally(r.statuses),
            firstFiledAt: new Date(r.first_filed_at),
            latestAt: new Date(r.latest_at),
            maxScore: Number(r.max_score),
            routine: r.routine,
            topIds: ids,
            links: jobLinks,
          };
        }),
        nextOffset: hasMore ? input.offset + input.limit : null,
      };
    }),

  /** One job: every ticket, newest activity first, plus the merged revision timeline. */
  job: publicProcedure
    .input(z.object({ jobKey: z.string().min(1).max(300) }))
    .query(async ({ input }) => {
      const rows = await db
        .select(recordColumns)
        .from(publicRecord)
        .leftJoin(parks, eq(parks.id, publicRecord.parkId))
        .where(and(eq(publicRecord.suppressed, false), sql`${jobIdentity} = ${input.jobKey}`))
        .orderBy(desc(activityAt), desc(publicRecord.id));
      if (rows.length === 0) throw new TRPCError({ code: "NOT_FOUND" });
      const ids = rows.map((r) => r.id);
      const [links, revisions] = await Promise.all([
        linksFor(ids),
        db
          .select({
            id: publicRecordRevision.id,
            recordId: publicRecordRevision.recordId,
            seenAt: publicRecordRevision.seenAt,
            prevStatus: publicRecordRevision.prevStatus,
            nextStatus: publicRecordRevision.nextStatus,
          })
          .from(publicRecordRevision)
          .where(inArray(publicRecordRevision.recordId, ids))
          .orderBy(desc(publicRecordRevision.seenAt))
          .limit(200),
      ]);
      const tickets = rows.map((r) => present(r, links.get(r.id) ?? []));
      const lead = rows[0]!;
      const seen = new Set<string>();
      const jobLinks: ResolvedLink[] = [];
      for (const t of tickets) {
        for (const l of t.links) {
          const k = `${l.entityKind}:${l.entityId}`;
          if (seen.has(k)) continue;
          seen.add(k);
          jobLinks.push(l);
        }
      }
      return {
        jobKey: input.jobKey,
        title: lead.jobTitle ?? lead.title,
        source: lead.source,
        agency: agencyFor(lead.source),
        operator: lead.operator,
        resortSlug: lead.resortSlug,
        park: tickets.find((t) => t.park)?.park ?? null,
        address: rows.find((r) => r.address)?.address ?? null,
        ticketCount: tickets.length,
        firstFiledAt: rows.reduce<Date | null>((m, r) => {
          const d = r.filedAt ?? r.firstSeenAt;
          return !m || d < m ? d : m;
        }, null),
        latestAt: new Date(lead.activityAt),
        links: jobLinks,
        tickets,
        revisions,
      };
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
