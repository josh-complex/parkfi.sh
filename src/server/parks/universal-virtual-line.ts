/**
 * Universal Virtual Line state, overlaid onto the ThemeParks.wiki `/live` feed.
 *
 * WHY THIS EXISTS. TP.wiki reports a `RETURN_TIME` queue for ~28 UOR rides, but
 * its `state` is a stuck constant: every sample is `TEMP_FULL` (→ our LIMITED),
 * `returnStart`/`returnEnd` are always null, and it fires for flat rides that
 * run no virtual queue at all. Measured 2026-07-28 over 24h: 11,601 samples, 28
 * rides, ONE distinct state. So the field is a capability flag wearing a state's
 * clothes, and every chart built on it (the ride page's availability timeline,
 * the board's VL pill) was rendering a constant. Disney's same queue type is
 * properly bimodal (39k AVAILABLE / 33k SOLD_OUT), which is why this only
 * affects UOR.
 *
 * The fix is Universal's own mobile-services `/api/Queues` — same host and same
 * static credential pair we already use for the POI catalog, no user session.
 * It returns the resort's 45 VL queues with `IsEnabled` / `IsUnavailable`,
 * keyed by `PlaceId`.
 *
 * WHAT IT STILL DOESN'T GIVE US: return windows. `/Queues/{id}` only repeats the
 * config and every appointment path 404s — actual return times live behind the
 * app's OIDC session (research/gated-feeds-report.md §U3). So this carries
 * operational state only, and `returnStart`/`returnEnd` stay null.
 *
 * UNPROVEN: whether `IsEnabled`/`IsUnavailable` actually move during a day. A
 * single snapshot can't tell a live flag from standing config, and `IsEnabled`
 * is true for rides that plainly run no VL (Storm Force, Cat in the Hat), so it
 * reads more like "VL is configured" than "you can book right now". Writing it
 * to `queue_obs` is itself the experiment: once a day of history exists, a
 * `count(DISTINCT state)` per ride settles it. Until then treat a green
 * timeline as "VL switched on", not "bookable".
 */
import { QueueState, QueueType, normalizeUniversalName, type QueueStateCode } from "./codes.ts";
import { config } from "./config.ts";
import { fetchUniversalQueues } from "./sources/universal-mobile.ts";

import type { NormalizedEntity } from "./normalize.ts";
import type { UniversalQueue } from "./schemas.ts";

/**
 * `PlaceId` venue segment -> our park slug. `ueu` and `eu` both appear for Epic
 * Universe (the Queues registry uses the former, the public CDN feed the
 * latter), so both are mapped.
 */
export const PARK_SLUG_BY_VENUE: Record<string, string> = {
  ioa: "islands-of-adventure",
  usf: "universal-studios-florida",
  ueu: "epic-universe",
  eu: "epic-universe",
  vb: "volcano-bay",
};

/**
 * Upstream misspellings in the `PlaceId` slug, mapped to the real ride name.
 * Universal's registry is hand-keyed and two entries don't match their own POI
 * catalog: "mario_cart" (Kart) and "hiccups" (Hiccup). Without these, Mario Kart
 * — one of only ~21 enabled queues — silently drops out of the join. Keyed by
 * the trailing slug so a venue re-key doesn't invalidate the entry.
 */
const SLUG_ALIASES: Record<string, string> = {
  mario_cart_bowsers_challenge: "mario kart bowsers challenge",
  hiccups_wing_glider: "hiccup wing glider",
};

/**
 * Join key for a Universal ride name. `normalizeUniversalName` gets us most of
 * the way, but the registry is inconsistent about "&" against its own catalog
 * ("popeye_blutos" drops it, "fast_and_furious" spells it out), so the
 * conjunctions and leading articles are dropped from both sides. Measured on the
 * live registry: 36/45 queues join, and every miss is a queue with no `PlaceId`,
 * a non-ride (a parade), or a disabled queue — 20 of the 21 ENABLED queues join,
 * and the alias table above covers the 21st.
 */
export function virtualLineJoinKey(name: string): string {
  return normalizeUniversalName(name)
    .split(" ")
    .filter((w) => w && w !== "and" && w !== "the" && w !== "a")
    .join(" ");
}

/** Join key derived from a `uor.<venue>.rides.<slug>` PlaceId, plus its park. */
export function keyFromPlaceId(placeId: string): { parkSlug: string; key: string } | null {
  const parts = placeId.split(".");
  const parkSlug = PARK_SLUG_BY_VENUE[parts[1] ?? ""];
  // Only ride queues matter — the registry also carries a stale parade entry.
  if (!parkSlug || parts[2] !== "rides") return null;
  const slug = parts.slice(3).join(".");
  if (!slug) return null;
  const alias = SLUG_ALIASES[slug];
  return { parkSlug, key: virtualLineJoinKey(alias ?? slug.replace(/_/g, " ")) };
}

/**
 * Registry row -> queue state.
 *
 * NOT_OFFERED for a disabled queue is the important one: it renders as an empty
 * tick rather than a colour, so a ride whose VL is switched off reads as "no
 * virtual line right now" instead of the permanent amber TP.wiki gave us.
 */
export function virtualLineState(q: UniversalQueue): QueueStateCode {
  if (!q.IsEnabled) return QueueState.NOT_OFFERED;
  return q.IsUnavailable ? QueueState.PAUSED : QueueState.AVAILABLE;
}

/** park slug -> (ride join key -> state). */
export type VirtualLineStates = Map<string, Map<string, QueueStateCode>>;

export function indexVirtualLineQueues(queues: Array<UniversalQueue>): VirtualLineStates {
  const out: VirtualLineStates = new Map();
  for (const q of queues) {
    if (!q.PlaceId) continue;
    const parsed = keyFromPlaceId(q.PlaceId);
    if (!parsed) continue;
    let byKey = out.get(parsed.parkSlug);
    if (!byKey) out.set(parsed.parkSlug, (byKey = new Map()));
    byKey.set(parsed.key, virtualLineState(q));
  }
  return out;
}

/**
 * Overlay the registry's state onto a park's normalized entities, in place.
 *
 * Deliberately only REWRITES a RETURN_TIME queue TP.wiki already reported — it
 * never adds one. `attraction_queue_support` records every (attraction, queue
 * type) pair ingest sees and is what `paidLineInfo` reads to decide a ride "has
 * a virtual line", so synthesising queues here would advertise Virtual Line on
 * the two dozen rides whose registry entry is disabled. Narrower and reversible.
 *
 * Returns the number of entities whose state was replaced.
 */
export function applyVirtualLineStates(
  entities: Array<NormalizedEntity>,
  parkSlug: string,
  states: VirtualLineStates,
): number {
  const byKey = states.get(parkSlug);
  if (!byKey) return 0;
  let applied = 0;
  for (const e of entities) {
    const state = byKey.get(virtualLineJoinKey(e.name ?? ""));
    if (state == null) continue;
    const queue = e.queues.find((q) => q.queueType === QueueType.RETURN_TIME);
    if (!queue) continue;
    queue.state = state;
    applied++;
  }
  return applied;
}

// ---------------------------------------------------------------------------
// Per-tick cache. Parks are ingested concurrently, so four UOR parks would
// otherwise fire four identical requests within milliseconds of each other. The
// in-flight promise is shared and the result held for one poll interval.
// ---------------------------------------------------------------------------
let cached: { at: number; states: VirtualLineStates } | null = null;
let inFlight: Promise<VirtualLineStates> | null = null;

/** Drop the cache — tests only. */
export function resetVirtualLineCache(): void {
  cached = null;
  inFlight = null;
}

/**
 * The current registry, at most one fetch per poll interval for the whole
 * resort. Never throws: a rotated credential or a slow host costs us the
 * overlay for this tick (TP.wiki's value stands), not the tick.
 */
export async function virtualLineStates(): Promise<VirtualLineStates> {
  const now = Date.now();
  if (cached && now - cached.at < config.pollIntervalMs) return cached.states;
  if (inFlight) return inFlight;
  inFlight = fetchUniversalQueues(AbortSignal.timeout(config.fetchTimeoutMs))
    .then((feed) => {
      const states = indexVirtualLineQueues(feed.Results);
      cached = { at: Date.now(), states };
      return states;
    })
    .catch(() => cached?.states ?? new Map())
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}
