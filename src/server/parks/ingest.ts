import { and, eq, inArray, sql } from "drizzle-orm";

import { db } from "#/db/index.ts";
import {
  attractionQueueSupport,
  attractionStatusObs,
  attractions,
  externalIds,
  parks,
  queueObs,
} from "#/db/schema.ts";

import { AttractionStatus, QueueType, Source } from "./codes.ts";
import { config } from "./config.ts";
import { normalizeLive, type NormalizedEntity } from "./normalize.ts";
import { fetchQueueTimes } from "./sources/queue-times.ts";
import { fetchLive } from "./sources/themeparks.ts";

const KIND_ATTRACTION = "attraction";

export interface IngestResult {
  parkId: number;
  source: number;
  entities: number;
  statusChanges: number;
  queueRows: number;
  degraded: boolean;
  error?: string;
}

function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "unknown"
  );
}

/** External id (by source/kind) -> internal attraction id, creating rows as needed. */
async function resolveAttractions(
  parkId: number,
  source: number,
  entities: Array<{ externalId: string; name: string; entityType: string }>,
): Promise<Map<string, number>> {
  const ids = entities.map((e) => e.externalId);
  const map = new Map<string, number>();
  if (ids.length === 0) return map;

  const existing = await db
    .select({ externalId: externalIds.externalId, entityId: externalIds.entityId })
    .from(externalIds)
    .where(
      and(
        eq(externalIds.source, source),
        eq(externalIds.entityKind, KIND_ATTRACTION),
        inArray(externalIds.externalId, ids),
      ),
    );
  for (const row of existing) map.set(row.externalId, row.entityId);

  const missing = entities.filter((e) => !map.has(e.externalId));
  for (const e of missing) {
    const [inserted] = await db
      .insert(attractions)
      .values({
        parkId,
        name: e.name,
        slug: slugify(e.name),
        entityType: e.entityType,
      })
      .returning({ id: attractions.id });
    await db
      .insert(externalIds)
      .values({
        entityKind: KIND_ATTRACTION,
        entityId: inserted.id,
        source,
        externalId: e.externalId,
      })
      .onConflictDoNothing();
    map.set(e.externalId, inserted.id);
  }
  return map;
}

interface LatestStatus {
  status: number;
  observedAt: Date;
}

/** Latest known status + its observation time per attraction (carry-forward). */
async function latestStatuses(attractionIds: Array<number>): Promise<Map<number, LatestStatus>> {
  const map = new Map<number, LatestStatus>();
  if (attractionIds.length === 0) return map;
  const idList = sql.join(
    attractionIds.map((id) => sql`${id}`),
    sql`, `,
  );
  const result = await db.execute<{
    attraction_id: string;
    status: number;
    observed_at: string;
  }>(sql`
    SELECT DISTINCT ON (attraction_id) attraction_id, status, observed_at
    FROM ${attractionStatusObs}
    WHERE attraction_id IN (${idList})
    ORDER BY attraction_id, observed_at DESC
  `);
  for (const r of result.rows) {
    map.set(Number(r.attraction_id), {
      status: Number(r.status),
      observedAt: new Date(r.observed_at),
    });
  }
  return map;
}

/** Resolve a park's external id for a given source. */
async function parkExternalId(parkId: number, source: number): Promise<string | null> {
  const [row] = await db
    .select({ externalId: externalIds.externalId })
    .from(externalIds)
    .where(
      and(
        eq(externalIds.source, source),
        eq(externalIds.entityKind, "park"),
        eq(externalIds.entityId, parkId),
      ),
    )
    .limit(1);
  return row?.externalId ?? null;
}

/**
 * Poll one park: fetch -> validate -> normalize -> persist -> (status on change).
 * Falls back to queue-times (waits only) when ThemeParks.wiki fails.
 */
export async function ingestPark(parkId: number): Promise<IngestResult> {
  const signal = AbortSignal.timeout(config.fetchTimeoutMs);
  const tickNow = new Date();

  let normalized: Array<NormalizedEntity>;
  let source: number = Source.THEMEPARKS_WIKI;
  let degraded = false;

  const uuid = await parkExternalId(parkId, Source.THEMEPARKS_WIKI);
  if (!uuid) {
    return {
      parkId,
      source,
      entities: 0,
      statusChanges: 0,
      queueRows: 0,
      degraded: false,
      error: "no themeparks_wiki external id for park",
    };
  }

  try {
    const payload = await fetchLive(uuid, signal);
    normalized = normalizeLive(payload, tickNow);
  } catch (err) {
    // Degraded path: queue-times for waits only, LL fields left unknown.
    const qtId = await parkExternalId(parkId, Source.QUEUE_TIMES);
    if (!qtId) {
      return {
        parkId,
        source,
        entities: 0,
        statusChanges: 0,
        queueRows: 0,
        degraded: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
    source = Source.QUEUE_TIMES;
    degraded = true;
    const qt = await fetchQueueTimes(qtId, AbortSignal.timeout(config.fetchTimeoutMs));
    const rides = [...(qt.rides ?? []), ...qt.lands.flatMap((l) => l.rides)];
    normalized = rides.map((r) => ({
      externalId: String(r.id),
      name: r.name,
      entityType: "ATTRACTION",
      observedAt: r.last_updated ? new Date(r.last_updated) : tickNow,
      status: r.is_open ? AttractionStatus.OPERATING : AttractionStatus.CLOSED,
      queues: [
        {
          queueType: QueueType.STANDBY,
          waitMin: r.wait_time,
          state: null,
          priceCents: null,
          currency: null,
          returnStart: null,
          returnEnd: null,
          boardingGroup: null,
        },
      ],
    }));
  }

  const idMap = await resolveAttractions(parkId, source, normalized);
  const attractionIds = [...idMap.values()];
  const prevStatus = await latestStatuses(attractionIds);

  // (A) status — change-log: write on transition, plus a heartbeat re-assert when
  // the last recorded observation has gone stale, so a single missed transition
  // can't strand a ride at the wrong status (see config.statusHeartbeatMs).
  const heartbeatMs = config.statusHeartbeatMs;
  const statusRows = normalized
    .map((e) => ({ e, attractionId: idMap.get(e.externalId)! }))
    .filter(({ e, attractionId }) => {
      const prev = prevStatus.get(attractionId);
      if (!prev) return true; // never seen — record it
      if (prev.status !== e.status) return true; // genuine transition
      // unchanged: re-assert only once the prior row is older than the heartbeat
      return heartbeatMs > 0 && tickNow.getTime() - prev.observedAt.getTime() >= heartbeatMs;
    })
    .map(({ e, attractionId }) => {
      // The row must become the carry-forward latest (max observed_at). The feed's
      // `lastUpdated` can be stale or non-monotonic, so if it isn't strictly newer
      // than the prior row, stamp it at tickNow — otherwise the write lands behind
      // the existing row and the transition/heartbeat is silently lost.
      const prev = prevStatus.get(attractionId);
      const observedAt =
        prev && e.observedAt.getTime() <= prev.observedAt.getTime() ? tickNow : e.observedAt;
      return { observedAt, attractionId, status: e.status, source };
    });
  if (statusRows.length > 0) {
    await db.insert(attractionStatusObs).values(statusRows).onConflictDoNothing();
  }

  // (B) queue observations — always upsert, idempotent on the PK
  const queueRows = normalized.flatMap((e) => {
    const attractionId = idMap.get(e.externalId)!;
    return e.queues.map((q) => ({
      observedAt: e.observedAt,
      attractionId,
      queueType: q.queueType,
      waitMin: q.waitMin,
      state: q.state,
      priceCents: q.priceCents,
      currency: q.currency,
      returnStart: q.returnStart,
      returnEnd: q.returnEnd,
      boardingGroup: q.boardingGroup,
      source,
    }));
  });
  if (queueRows.length > 0) {
    // chunk to keep parameter counts sane on big parks
    for (let i = 0; i < queueRows.length; i += 500) {
      await db
        .insert(queueObs)
        .values(queueRows.slice(i, i + 500))
        .onConflictDoNothing({
          target: [queueObs.attractionId, queueObs.queueType, queueObs.observedAt],
        });
    }
  }

  // (C) capability: record every (attraction, queue_type) pair we've ever seen so
  // the board can answer "does this ride offer a paid/virtual line?" authoritatively,
  // independent of whether a return time happens to be posted right now.
  const supportRows = [
    ...new Map(queueRows.map((q) => [`${q.attractionId}:${q.queueType}`, q])).values(),
  ].map((q) => ({ attractionId: q.attractionId, queueType: q.queueType }));
  if (supportRows.length > 0) {
    await db.insert(attractionQueueSupport).values(supportRows).onConflictDoNothing();
  }

  return {
    parkId,
    source,
    entities: normalized.length,
    statusChanges: statusRows.length,
    queueRows: queueRows.length,
    degraded,
  };
}

/** Active parks that have a ThemeParks.wiki mapping, for the poll loop. */
export async function activeParkIds(): Promise<Array<number>> {
  const rows = await db.select({ id: parks.id }).from(parks).where(eq(parks.active, true));
  return rows.map((r) => r.id);
}
