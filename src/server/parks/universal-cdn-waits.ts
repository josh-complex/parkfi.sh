/**
 * Universal single-rider waits, overlaid onto the ThemeParks.wiki `/live`
 * feed — and the removal of Universal's Express "waits" from it.
 *
 * WHY THIS EXISTS. TP.wiki carries a STANDBY wait for every Universal ride but
 * a SINGLE_RIDER queue for only a handful. Universal's own app reads a public
 * CDN JSON that types every queue per ride — `STANDBY`, `EXPRESS`, `SINGLE` —
 * with a live status on the single-rider line. No auth, no cookies, ~50 KB,
 * republished about once a minute (research/universal-app-data-mining.md §1).
 *
 * THE JOIN. `wait_time_attraction_id` is the operator's place id
 * (`uor.<venue>.rides.<slug>`), and TP.wiki hands us the very same id as the
 * live entity's `externalId` (our `operatorExternalId`). That is an exact key —
 * 30 of 31 IOA entities on the probe day. The one miss was a slug the two sides
 * spell differently (`…seuss_trolley_train_ride!` vs `…train_ride_`), so a
 * normalized-name key within the park is the fallback.
 *
 * WHAT IS BELIEVED, measured 2026-09-03 across an operating day:
 *   • `display_wait_time: 995` is the feed's "nothing posted" sentinel — every
 *     closed single-rider queue carried it. Anything that large is read as
 *     null, never as a wait.
 *   • SINGLE queues carry a live status (`OPEN` / `CLOSED` / `AT_CAPACITY`) and
 *     an ops wait-board (SharePoint) id like the standby queues do, so a
 *     single-rider wait is only taken while that line is `OPEN`.
 *   • The EXPRESS queue is NOT a live wait. Its status reads `CLOSED` on all
 *     30 rides at all times (which is why the operator's app never shows it),
 *     none of the 30 carries an ops wait-board id, and over 24 hours of
 *     minute-level samples the value never moved on 29 of them (a flat 5, 10
 *     or 0 all day; Hulk "Express 10" beside a 5-minute standby; Despicable Me
 *     "Express 15" while closed). We published those for a day as
 *     PAID_STANDBY; they are now dropped, and any PAID_STANDBY queue TP.wiki
 *     reports for a Universal ride — it had relayed the same placard for 7–18
 *     rides since June 2026, six distinct values in three months — is
 *     stripped too. Whether a ride ACCEPTS Express is a different fact, from
 *     the places feed's `ExpressPassAccepted` (`attraction_meta.express_pass`).
 *   • Standby itself is never touched — TP.wiki stays the primary for it, and
 *     the two agree (it is where TP.wiki sources UOR from).
 *
 * Unlike the Virtual Line overlay, this one ADDS a queue TP.wiki did not
 * report. That is deliberate: an `attraction_queue_support` row for
 * SINGLE_RIDER is exactly the claim the feed makes ("this ride has a
 * single-rider line"), and a live wait with no queue row would have nowhere
 * to go.
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

export interface UniversalWaitRow {
  placeId: string;
  parkSlug: string;
  /** Normalized ride name, the fallback join key when place ids disagree. */
  nameKey: string;
  /** The ride has a single-rider line (a queue of type SINGLE in the feed). */
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

  const single = a.queues.find((q) => q.queue_type === "SINGLE");
  return {
    placeId,
    parkSlug,
    nameKey: normalizeUniversalName(a.name),
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
 * Overlay the CDN's single-rider waits onto a park's normalized entities, in
 * place, and strip any PAID_STANDBY (Express) queue from every entity — see
 * the header for why Universal's Express "wait" is not one. Exact place-id
 * join first, normalized name second, both scoped to the park. Returns the
 * number of entities that received a single-rider queue.
 */
export function applyUniversalWaits(
  entities: Array<NormalizedEntity>,
  parkSlug: string,
  index: UniversalWaitIndex,
): number {
  const names = index.byName.get(parkSlug);
  let applied = 0;
  for (const e of entities) {
    e.queues = e.queues.filter((q) => q.queueType !== QueueType.PAID_STANDBY);
    const byId = e.operatorExternalId ? index.byPlaceId.get(e.operatorExternalId) : undefined;
    const row =
      byId && byId.parkSlug === parkSlug ? byId : names?.get(normalizeUniversalName(e.name ?? ""));
    if (!row?.hasSingle) continue;
    upsertWait(e.queues, QueueType.SINGLE_RIDER, row.singleWait);
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
