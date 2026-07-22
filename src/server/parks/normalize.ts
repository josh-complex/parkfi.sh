import {
  AttractionStatus,
  QueueType,
  queueStateFromThemeparks,
  statusFromThemeparks,
  type AttractionStatusCode,
  type QueueStateCode,
  type QueueTypeCode,
} from "./codes.ts";
import type { LiveEntity, LivePayload } from "./schemas.ts";

export interface NormalizedQueue {
  queueType: QueueTypeCode;
  waitMin: number | null;
  state: QueueStateCode | null;
  priceCents: number | null;
  currency: string | null;
  returnStart: Date | null;
  returnEnd: Date | null;
  boardingGroup: number | null;
}

/** One of the day's performances for a SHOW entity (ISO times, park-local offset). */
export interface NormalizedShowtime {
  type: string | null;
  start: string | null;
  end: string | null;
}

export interface NormalizedEntity {
  externalId: string;
  name: string;
  entityType: string;
  observedAt: Date;
  status: AttractionStatusCode;
  queues: Array<NormalizedQueue>;
  /** Today's performances (SHOW entities); empty for non-shows. */
  showtimes: Array<NormalizedShowtime>;
}

function toDate(s?: string | null): Date | null {
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Turn a ThemeParks.wiki `/live` payload into per-entity normalized facts.
 *
 * Note: `PAID_RETURN_TIME.price` is *attraction-grain* demand pricing (LL
 * Single / à-la-carte), so it lands on the queue row's `priceCents`. Per-park
 * bundle pricing (LL Multi, Universal Express) is NOT in this feed — it flows
 * into `product_price_obs` from other sources.
 */
export function normalizeLive(payload: LivePayload, tickNow: Date): Array<NormalizedEntity> {
  const out: Array<NormalizedEntity> = [];
  for (const e of payload.liveData) {
    out.push(normalizeEntity(e, tickNow));
  }
  return out;
}

function normalizeEntity(e: LiveEntity, tickNow: Date): NormalizedEntity {
  const observedAt = toDate(e.lastUpdated) ?? tickNow;
  const queues: Array<NormalizedQueue> = [];
  const q = e.queue ?? {};

  if (q.STANDBY) {
    queues.push(blankQueue(QueueType.STANDBY, { waitMin: q.STANDBY.waitTime }));
  }
  if (q.SINGLE_RIDER) {
    queues.push(blankQueue(QueueType.SINGLE_RIDER, { waitMin: q.SINGLE_RIDER.waitTime }));
  }
  if (q.PAID_STANDBY) {
    queues.push(blankQueue(QueueType.PAID_STANDBY, { waitMin: q.PAID_STANDBY.waitTime }));
  }
  if (q.RETURN_TIME) {
    queues.push(
      blankQueue(QueueType.RETURN_TIME, {
        state: queueStateFromThemeparks(q.RETURN_TIME.state),
        returnStart: toDate(q.RETURN_TIME.returnStart),
        returnEnd: toDate(q.RETURN_TIME.returnEnd),
      }),
    );
  }
  if (q.PAID_RETURN_TIME) {
    const p = q.PAID_RETURN_TIME;
    queues.push(
      blankQueue(QueueType.PAID_RETURN_TIME, {
        state: queueStateFromThemeparks(p.state),
        priceCents: p.price?.amount ?? null,
        currency: p.price?.currency ?? null,
        returnStart: toDate(p.returnStart),
        returnEnd: toDate(p.returnEnd),
      }),
    );
  }
  if (q.BOARDING_GROUP) {
    queues.push(
      blankQueue(QueueType.BOARDING_GROUP, {
        state: queueStateFromThemeparks(q.BOARDING_GROUP.state),
        boardingGroup: q.BOARDING_GROUP.currentGroupStart ?? null,
      }),
    );
  }

  // SHOW showtimes: keep entries with a parseable start; preserve the raw ISO
  // strings (they carry the park-local offset the UI formats against).
  const showtimes: Array<NormalizedShowtime> = [];
  for (const s of e.showtimes ?? []) {
    if (!s.startTime || toDate(s.startTime) == null) continue;
    showtimes.push({
      type: s.type ?? null,
      start: s.startTime,
      end: s.endTime ?? null,
    });
  }

  return {
    externalId: e.id,
    name: e.name,
    entityType: e.entityType,
    observedAt,
    status: e.status ? statusFromThemeparks(e.status) : AttractionStatus.UNKNOWN,
    queues,
    showtimes,
  };
}

function blankQueue(
  queueType: QueueTypeCode,
  over: Partial<Omit<NormalizedQueue, "queueType">>,
): NormalizedQueue {
  return {
    queueType,
    waitMin: over.waitMin ?? null,
    state: over.state ?? null,
    priceCents: over.priceCents ?? null,
    currency: over.currency ?? null,
    returnStart: over.returnStart ?? null,
    returnEnd: over.returnEnd ?? null,
    boardingGroup: over.boardingGroup ?? null,
  };
}
