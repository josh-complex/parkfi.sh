/**
 * Universal Express and single-rider waits, overlaid onto the ThemeParks.wiki
 * `/live` feed.
 *
 * WHY THIS EXISTS. TP.wiki carries a STANDBY wait for every Universal ride but
 * a PAID_STANDBY (Express) or SINGLE_RIDER queue for only a handful — Islands
 * of Adventure on 2026-09-03 showed 3 and 2 rides. Universal's own app reads a
 * public CDN JSON that types every queue per ride — `STANDBY`, `EXPRESS`,
 * `SINGLE` — and on the same day published 30 Express and 13 single-rider lines
 * across the resort. No auth, no cookies, ~50 KB, republished about once a
 * minute (research/universal-app-data-mining.md §1). Nobody else shows live
 * Express waits.
 *
 * THE JOIN. `wait_time_attraction_id` is the operator's place id
 * (`uor.<venue>.rides.<slug>`), and TP.wiki hands us the very same id as the
 * live entity's `externalId` (our `operatorExternalId`). That is an exact key —
 * 30 of 31 IOA entities on the probe day. The one miss was a slug the two sides
 * spell differently (`…seuss_trolley_train_ride!` vs `…train_ride_`), so a
 * normalized-name key within the park is the fallback.
 *
 * WHAT IS BELIEVED, measured 2026-09-03 at midday on an operating day:
 *   • `display_wait_time: 995` is the feed's "nothing posted" sentinel — every
 *     closed Express and single-rider queue carried it. Anything that large is
 *     read as null, never as a wait.
 *   • The EXPRESS queue's own `status` read `CLOSED` on all 30 rides while
 *     their STANDBY queues were `OPEN` and Express waits of 5–15 min were
 *     posted: ops evidently don't maintain a status on the Express line. So an
 *     Express wait is taken whenever the ride's STANDBY queue is open in the
 *     same feed, and the Express status is ignored.
 *   • SINGLE queues DO carry a live status (`OPEN` / `CLOSED` / `AT_CAPACITY`),
 *     so a single-rider wait is only taken while that line is `OPEN`.
 *   • Standby itself is never touched — TP.wiki stays the primary for it, and
 *     the two agree (it is where TP.wiki sources UOR from).
 *
 * Unlike the Virtual Line overlay, this one ADDS queues TP.wiki did not
 * report. That is deliberate: an `attraction_queue_support` row for
 * PAID_STANDBY is exactly the claim the feed makes ("this ride has an Express
 * line"), and a live Express wait with no queue row would have nowhere to go.
 */
import { QueueType, normalizeUniversalName } from "./codes.ts";
import { config } from "./config.ts";
import { fetchUniversalWaitTimes } from "./sources/universal-cdn.ts";
import { PARK_SLUG_BY_VENUE } from "./universal-virtual-line.ts";

import type { NormalizedEntity, NormalizedQueue } from "./normalize.ts";
import type { UniversalWaitAttraction, UniversalWaitFeed } from "./schemas.ts";

/** Our park slug -> the CDN's resort code. Only Orlando has parks here. */
const RESORT_BY_PARK_SLUG: Record<string, string> = Object.fromEntries(
  Object.values(PARK_SLUG_BY_VENUE).map((slug) => [slug, "uor"]),
);

/** The CDN resort code a park's waits live under, or null for non-Universal parks. */
export function universalResortForPark(parkSlug: string): string | null {
  return RESORT_BY_PARK_SLUG[parkSlug] ?? null;
}

/**
 * Waits at or above this are the feed's "no wait posted" sentinel (995 live),
 * not a queue length. Nothing real approaches it — the longest wait Universal
 * has ever posted is a few hundred minutes.
 */
export const WAIT_SENTINEL_MIN = 900;

/** A posted wait in minutes, or null for the sentinel / an absent value. */
export function waitMinutes(value: number | null | undefined): number | null {
  if (value == null || !Number.isFinite(value) || value < 0) return null;
  return value >= WAIT_SENTINEL_MIN ? null : Math.round(value);
}

/** Queue statuses under which a standby line is taking guests. */
const STANDBY_OPEN = new Set(["OPEN", "CLOSES_AT", "RIDE_NOW"]);

export interface UniversalWaitRow {
  placeId: string;
  parkSlug: string;
  /** Normalized ride name, the fallback join key when place ids disagree. */
  nameKey: string;
  /** The ride's standby line is open in this feed. */
  standbyOpen: boolean;
  /** The ride has an Express line (a queue of type EXPRESS in the feed). */
  hasExpress: boolean;
  /** Express wait to publish — null when unposted or the ride isn't open. */
  expressWait: number | null;
  /** The ride has a single-rider line. */
  hasSingle: boolean;
  /** Single-rider wait to publish — null unless that line is OPEN with a wait. */
  singleWait: number | null;
}

export interface UniversalWaitIndex {
  byPlaceId: Map<string, UniversalWaitRow>;
  /** park slug -> (name key -> row). */
  byName: Map<string, Map<string, UniversalWaitRow>>;
}

/** Park slug for a `uor.<venue>.…` place id, via the venue segment. */
function parkSlugForPlaceId(placeId: string): string | null {
  return PARK_SLUG_BY_VENUE[placeId.split(".")[1] ?? ""] ?? null;
}

/** One feed record -> the facts we publish from it, or null if it can't be placed. */
export function waitRow(a: UniversalWaitAttraction): UniversalWaitRow | null {
  const placeId = a.wait_time_attraction_id;
  if (!placeId) return null;
  const parkSlug = parkSlugForPlaceId(placeId);
  if (!parkSlug) return null;

  const byType = new Map(a.queues.map((q) => [q.queue_type ?? "", q]));
  const standby = byType.get("STANDBY");
  const express = byType.get("EXPRESS");
  const single = byType.get("SINGLE");
  const standbyOpen = STANDBY_OPEN.has(standby?.status ?? "");

  return {
    placeId,
    parkSlug,
    nameKey: normalizeUniversalName(a.name),
    standbyOpen,
    hasExpress: express != null,
    expressWait: express != null && standbyOpen ? waitMinutes(express.display_wait_time) : null,
    hasSingle: single != null,
    singleWait: single?.status === "OPEN" ? waitMinutes(single.display_wait_time) : null,
  };
}

export function indexUniversalWaits(feed: UniversalWaitFeed): UniversalWaitIndex {
  const byPlaceId = new Map<string, UniversalWaitRow>();
  const byName = new Map<string, Map<string, UniversalWaitRow>>();
  for (const a of feed) {
    const row = waitRow(a);
    if (!row) continue;
    byPlaceId.set(row.placeId, row);
    let names = byName.get(row.parkSlug);
    if (!names) byName.set(row.parkSlug, (names = new Map()));
    if (row.nameKey) names.set(row.nameKey, row);
  }
  return { byPlaceId, byName };
}

function upsertWait(
  queues: Array<NormalizedQueue>,
  queueType: NormalizedQueue["queueType"],
  waitMin: number | null,
): void {
  const existing = queues.find((q) => q.queueType === queueType);
  if (existing) {
    existing.waitMin = waitMin;
    return;
  }
  queues.push({
    queueType,
    waitMin,
    state: null,
    priceCents: null,
    currency: null,
    returnStart: null,
    returnEnd: null,
    boardingGroup: null,
    boardingGroupEnd: null,
    boardingAllocation: null,
  });
}

/**
 * Overlay the CDN's Express and single-rider waits onto a park's normalized
 * entities, in place. Exact place-id join first, normalized name second, both
 * scoped to the park. Returns the number of entities that received a queue.
 */
export function applyUniversalWaits(
  entities: Array<NormalizedEntity>,
  parkSlug: string,
  index: UniversalWaitIndex,
): number {
  const names = index.byName.get(parkSlug);
  let applied = 0;
  for (const e of entities) {
    const byId = e.operatorExternalId ? index.byPlaceId.get(e.operatorExternalId) : undefined;
    const row =
      byId && byId.parkSlug === parkSlug ? byId : names?.get(normalizeUniversalName(e.name ?? ""));
    if (!row) continue;
    if (!row.hasExpress && !row.hasSingle) continue;
    if (row.hasExpress) upsertWait(e.queues, QueueType.PAID_STANDBY, row.expressWait);
    if (row.hasSingle) upsertWait(e.queues, QueueType.SINGLE_RIDER, row.singleWait);
    applied++;
  }
  return applied;
}

// ---------------------------------------------------------------------------
// Per-tick cache, per resort. Parks are ingested concurrently, so the four UOR
// parks would otherwise fire four identical requests within milliseconds. The
// in-flight promise is shared and the result held for one poll interval.
// ---------------------------------------------------------------------------
const EMPTY_INDEX: UniversalWaitIndex = { byPlaceId: new Map(), byName: new Map() };
const cached = new Map<string, { at: number; index: UniversalWaitIndex }>();
const inFlight = new Map<string, Promise<UniversalWaitIndex>>();

/** Drop the cache — tests only. */
export function resetUniversalWaitsCache(): void {
  cached.clear();
  inFlight.clear();
}

/**
 * The resort's current wait board, at most one fetch per poll interval. Never
 * throws: a CDN hiccup costs us the overlay for this tick (TP.wiki's queues
 * stand as reported), not the tick.
 */
export async function universalWaits(resort: string): Promise<UniversalWaitIndex> {
  const now = Date.now();
  const hit = cached.get(resort);
  if (hit && now - hit.at < config.pollIntervalMs) return hit.index;
  const pending = inFlight.get(resort);
  if (pending) return pending;
  const p = fetchUniversalWaitTimes(resort, AbortSignal.timeout(config.fetchTimeoutMs))
    .then((feed) => {
      const index = indexUniversalWaits(feed);
      cached.set(resort, { at: Date.now(), index });
      return index;
    })
    .catch(() => cached.get(resort)?.index ?? EMPTY_INDEX)
    .finally(() => {
      inFlight.delete(resort);
    });
  inFlight.set(resort, p);
  return p;
}
