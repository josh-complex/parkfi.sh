import { and, eq, inArray, sql } from "drizzle-orm";

import { db } from "#/db/index.ts";
import {
  attractionLive,
  attractionQueueSupport,
  attractionStatusObs,
  attractions,
  diningWalkupLive,
  externalIds,
  operators,
  parks,
  queueObs,
} from "#/db/schema.ts";

import { AttractionStatus, QueueType, Source } from "./codes.ts";
import { config } from "./config.ts";
import { normalizeLive, type NormalizedEntity } from "./normalize.ts";
import { fetchQueueTimes } from "./sources/queue-times.ts";
import { fetchLive } from "./sources/themeparks.ts";
import { applyVirtualLineStates, virtualLineStates } from "./universal-virtual-line.ts";

const KIND_ATTRACTION = "attraction";

export interface IngestResult {
  parkId: number;
  source: number;
  entities: number;
  statusChanges: number;
  queueRows: number;
  /** Rides whose virtual-line state came from Universal's registry, not TP.wiki. */
  virtualLineRows: number;
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
 * Park slug + operator, cached: every tick needs it to decide whether the
 * Universal virtual-line overlay applies, and parks change about once a year.
 */
const parkMetaCache = new Map<number, { slug: string; operatorSlug: string }>();

async function parkMeta(parkId: number): Promise<{ slug: string; operatorSlug: string } | null> {
  const hit = parkMetaCache.get(parkId);
  if (hit) return hit;
  const [row] = await db
    .select({ slug: parks.slug, operatorSlug: operators.slug })
    .from(parks)
    .innerJoin(operators, eq(operators.id, parks.operatorId))
    .where(eq(parks.id, parkId))
    .limit(1);
  if (!row) return null;
  parkMetaCache.set(parkId, row);
  return row;
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
      virtualLineRows: 0,
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
        virtualLineRows: 0,
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
          boardingGroupEnd: null,
          boardingAllocation: null,
        },
      ],
      showtimes: [],
      hoursToday: [],
      diningWaits: [],
      operatorExternalId: null,
    }));
  }

  // Universal only: TP.wiki's UOR `RETURN_TIME.state` is a stuck `TEMP_FULL`
  // constant, so the operator's own Virtual Line registry supersedes it before
  // anything is written — one overlay point keeps `queue_obs`, the
  // `attraction_live` mirror and the alert evaluator telling the same story.
  // Isolated and non-fatal: on any failure TP.wiki's value simply stands.
  let virtualLineRows = 0;
  const meta = await parkMeta(parkId);
  if (meta?.operatorSlug === "universal") {
    virtualLineRows = applyVirtualLineStates(normalized, meta.slug, await virtualLineStates());
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

  // (B) queue observations — one row per ride per poll tick. We stamp
  // `observedAt` at `tickNow` (uniform poll cadence) rather than the feed's
  // `lastUpdated`: the PK is (attraction, queue_type, observed_at), so keying it
  // on `lastUpdated` collapsed every unchanged poll into the same row via
  // onConflictDoNothing, leaving buckets with wildly uneven sample counts and a
  // jagged park-average line. The feed timestamp is preserved on `lastUpdated`.
  const queueRows = normalized.flatMap((e) => {
    const attractionId = idMap.get(e.externalId)!;
    return e.queues.map((q) => ({
      observedAt: tickNow,
      lastUpdated: e.observedAt,
      attractionId,
      queueType: q.queueType,
      waitMin: q.waitMin,
      state: q.state,
      priceCents: q.priceCents,
      currency: q.currency,
      returnStart: q.returnStart,
      returnEnd: q.returnEnd,
      boardingGroup: q.boardingGroup,
      boardingGroupEnd: q.boardingGroupEnd,
      boardingAllocation: q.boardingAllocation,
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

  // (D) current-state mirror — one row per attraction, upserted with this tick's
  // full snapshot so the live board/overview reads are a plain join on
  // `attraction_live` instead of DISTINCT ON scans over the change-logs (see the
  // table's schema comment). Each queue type the feed reported this tick maps to
  // its columns; types not reported land null (full-snapshot replace).
  const liveRows = normalized.map((e) => {
    const attractionId = idMap.get(e.externalId)!;
    const byType = new Map(e.queues.map((q) => [q.queueType, q]));
    const standby = byType.get(QueueType.STANDBY);
    const ll = byType.get(QueueType.PAID_RETURN_TIME);
    const rt = byType.get(QueueType.RETURN_TIME);
    const bg = byType.get(QueueType.BOARDING_GROUP);
    return {
      attractionId,
      status: e.status,
      standbyWait: standby?.waitMin ?? null,
      llState: ll?.state ?? null,
      llPriceCents: ll?.priceCents ?? null,
      llCurrency: ll?.currency ?? null,
      llReturnStart: ll?.returnStart ?? null,
      llReturnEnd: ll?.returnEnd ?? null,
      returnState: rt?.state ?? null,
      returnStart: rt?.returnStart ?? null,
      returnEnd: rt?.returnEnd ?? null,
      boardingGroup: bg?.boardingGroup ?? null,
      boardingGroupEnd: bg?.boardingGroupEnd ?? null,
      boardingAllocation: bg?.boardingAllocation ?? null,
      showtimes: e.showtimes.length > 0 ? e.showtimes : null,
      hoursToday: e.hoursToday.length > 0 ? e.hoursToday : null,
      source,
      observedAt: tickNow,
    };
  });
  if (liveRows.length > 0) {
    for (let i = 0; i < liveRows.length; i += 500) {
      await db
        .insert(attractionLive)
        .values(liveRows.slice(i, i + 500))
        .onConflictDoUpdate({
          target: attractionLive.attractionId,
          set: {
            status: sql`excluded.status`,
            standbyWait: sql`excluded.standby_wait`,
            llState: sql`excluded.ll_state`,
            llPriceCents: sql`excluded.ll_price_cents`,
            llCurrency: sql`excluded.ll_currency`,
            llReturnStart: sql`excluded.ll_return_start`,
            llReturnEnd: sql`excluded.ll_return_end`,
            returnState: sql`excluded.return_state`,
            returnStart: sql`excluded.return_start`,
            returnEnd: sql`excluded.return_end`,
            boardingGroup: sql`excluded.boarding_group`,
            boardingGroupEnd: sql`excluded.boarding_group_end`,
            boardingAllocation: sql`excluded.boarding_allocation`,
            showtimes: sql`excluded.showtimes`,
            hoursToday: sql`excluded.hours_today`,
            source: sql`excluded.source`,
            observedAt: sql`excluded.observed_at`,
          },
        });
    }
  }

  // (E) walk-up dining mirror (plan item 1.2) — restaurant entities carrying a
  // live `diningAvailability` breakdown. The join key is the operator's own
  // numeric id prefix (== restaurant_dim.facility_id). Headline wait prefers
  // the party-of-2 entry, else the venue's minimum posted wait.
  const walkupRows = normalized
    .filter((e) => e.diningWaits.length > 0 && e.operatorExternalId)
    .map((e) => {
      const posted = e.diningWaits.filter((d) => d.waitMin != null);
      const partyOf2 = posted.find((d) => d.partySize === 2);
      const min = posted.length > 0 ? Math.min(...posted.map((d) => d.waitMin!)) : null;
      return {
        facilityId: e.operatorExternalId!.split(";")[0],
        waitMin: partyOf2?.waitMin ?? min,
        partySizes: e.diningWaits,
        observedAt: tickNow,
      };
    });
  if (walkupRows.length > 0) {
    await db
      .insert(diningWalkupLive)
      .values(walkupRows)
      .onConflictDoUpdate({
        target: diningWalkupLive.facilityId,
        set: {
          waitMin: sql`excluded.wait_min`,
          partySizes: sql`excluded.party_sizes`,
          observedAt: sql`excluded.observed_at`,
        },
      });
  }

  return {
    parkId,
    source,
    entities: normalized.length,
    statusChanges: statusRows.length,
    queueRows: queueRows.length,
    virtualLineRows,
    degraded,
  };
}

/** Active parks that have a ThemeParks.wiki mapping, for the poll loop. */
export async function activeParkIds(): Promise<Array<number>> {
  const rows = await db.select({ id: parks.id }).from(parks).where(eq(parks.active, true));
  return rows.map((r) => r.id);
}
