/**
 * One-shot historical backfill from queue-times.com.
 *
 * Phase 1 — Bootstrap (runs automatically if needed):
 *   Fetches queue-times.com/parks.json, name-matches to our parks, then fetches
 *   each park's current ride list and name-matches to our attractions. All new
 *   mappings are inserted into `external_ids` (idempotent — ON CONFLICT DO NOTHING).
 *   This is the same work the live worker's degraded fallback does, but done
 *   proactively so we don't need a ThemeParks.wiki outage to trigger it.
 *
 * Phase 2 — Backfill:
 *   Fetches per-ride daily wait-time history and inserts into `queue_obs`
 *   (STANDBY only, source=QUEUE_TIMES). The `queue_15min` continuous aggregate
 *   materialises automatically from those rows, giving the ML training pipeline
 *   real history before we've accumulated 60 days of our own observations.
 *
 * Resumable: a covered-set query finds all (attraction_id, date) pairs already
 * present with source=QUEUE_TIMES, so re-running the script skips them.
 *
 * Attribution: queue-times.com must be credited wherever their data appears.
 * "Historical data via Queue-Times.com"
 *
 * Env (all optional):
 *   BQ_START_DATE    ISO date string, inclusive (default: 2 years ago)
 *   BQ_END_DATE      ISO date string, inclusive (default: yesterday)
 *   BQ_DELAY_MS      ms between API requests (default: 400 — ~2.5 req/s)
 *   BQ_DRY_RUN       if "1", logs what would be fetched but inserts nothing
 *
 * Run:  bun run backfill:qt
 */
import { config as loadEnv } from "dotenv";
loadEnv({ path: [".env.local", ".env"] });

import { sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "#/db/index.ts";
import { externalIds, queueObs } from "#/db/schema.ts";
import { Source, QueueType } from "#/server/parks/codes.ts";
import { config } from "#/server/parks/config.ts";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

function envDate(name: string, fallback: Date): Date {
  const raw = process.env[name];
  if (!raw) return fallback;
  const d = new Date(raw + "T00:00:00Z");
  return isNaN(d.getTime()) ? fallback : d;
}

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

const _now = new Date();
const _yesterday = new Date(_now);
_yesterday.setUTCDate(_yesterday.getUTCDate() - 1);
const _twoYearsAgo = new Date(_now);
_twoYearsAgo.setUTCFullYear(_twoYearsAgo.getUTCFullYear() - 2);

const START_DATE = envDate("BQ_START_DATE", _twoYearsAgo);
const END_DATE = envDate("BQ_END_DATE", _yesterday);
const DELAY_MS = envInt("BQ_DELAY_MS", 400);
const DRY_RUN = process.env.BQ_DRY_RUN === "1";

// ---------------------------------------------------------------------------
// Queue-Times API schemas
// ---------------------------------------------------------------------------

const QtParkSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  country: z.string().optional(),
  latitude: z.union([z.string(), z.number()]).optional(),
  longitude: z.union([z.string(), z.number()]).optional(),
});
// Top-level response: array of operator groups, each containing parks.
const QtParksResponseSchema = z.array(
  z.object({ id: z.number().int(), name: z.string(), parks: z.array(QtParkSchema) }),
);

const QtRideSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  is_open: z.boolean(),
  wait_time: z.number().int().min(0),
  last_updated: z.string().nullable().optional(),
});
const QtLandSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  rides: z.array(QtRideSchema).default([]),
});
const QtCurrentResponseSchema = z.object({
  lands: z.array(QtLandSchema).default([]),
  rides: z.array(QtRideSchema).optional(),
});

const QtHistoricalPointSchema = z.object({
  dateTime: z.string(),
  waitTime: z.number().int().min(0),
  isOpen: z.boolean(),
});
const QtHistoricalResponseSchema = z.array(QtHistoricalPointSchema);
type QtHistoricalPoint = z.infer<typeof QtHistoricalPointSchema>;

function parseQtTimestamp(s: string): Date | null {
  // "2024-06-01 09:00:00 UTC"  →  "2024-06-01T09:00:00Z"
  const iso = s.trim().replace(" UTC", "Z").replace(" ", "T");
  const d = new Date(iso);
  return isNaN(d.getTime()) ? null : d;
}

// ---------------------------------------------------------------------------
// Name normalisation for fuzzy matching
// ---------------------------------------------------------------------------

// Noise words stripped before word-overlap scoring. "disney" and "universal"
// are intentionally kept so "Magic Kingdom" doesn't match "Universal" parks.
const STOP = new Set([
  "the",
  "a",
  "an",
  "at",
  "of",
  "in",
  "s",
  "park",
  "theme",
  "ride",
  "attraction",
  "resort",
  "studios",
]);

function normWords(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/['']/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter((w) => w.length > 1 && !STOP.has(w));
}

/** Jaccard-style word-overlap score in [0,1]. */
function overlapScore(a: string, b: string): number {
  const wa = new Set(normWords(a));
  const wb = new Set(normWords(b));
  let shared = 0;
  for (const w of wa) if (wb.has(w)) shared++;
  const union = wa.size + wb.size - shared;
  return union === 0 ? 0 : shared / union;
}

/** Best QT park for `ourName`, or null if nothing scores above the threshold. */
function bestParkMatch(
  ourName: string,
  qtParks: Array<{ id: number; name: string }>,
  threshold = 0.35,
): { id: number; name: string } | null {
  let best: { id: number; name: string } | null = null;
  let bestScore = 0;
  for (const qt of qtParks) {
    const score = overlapScore(ourName, qt.name);
    if (score > bestScore) {
      bestScore = score;
      best = qt;
    }
  }
  return bestScore >= threshold ? best : null;
}

/** Best QT ride for `ourName`, or null if nothing scores above the threshold. */
function bestRideMatch(
  ourName: string,
  qtRides: Array<{ id: number; name: string }>,
  threshold = 0.5,
): { id: number; name: string } | null {
  let best: { id: number; name: string } | null = null;
  let bestScore = 0;
  for (const qt of qtRides) {
    const score = overlapScore(ourName, qt.name);
    if (score > bestScore) {
      bestScore = score;
      best = qt;
    }
  }
  return bestScore >= threshold ? best : null;
}

// ---------------------------------------------------------------------------
// Fetch helpers
// ---------------------------------------------------------------------------

async function qtFetch<T>(path: string, schema: z.ZodType<T>): Promise<T | null> {
  const url = `${config.queueTimesBase}${path}`;
  const res = await fetch(url, {
    signal: AbortSignal.timeout(config.fetchTimeoutMs),
    headers: { "user-agent": config.userAgent, accept: "application/json" },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`);
  const parsed = schema.safeParse(await res.json());
  if (!parsed.success) {
    console.warn(`[backfill] unexpected shape from ${url}:`, parsed.error.issues[0]?.message);
    return null;
  }
  return parsed.data;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ---------------------------------------------------------------------------
// Phase 1 helpers — bootstrap external_ids
// ---------------------------------------------------------------------------

interface OurPark {
  id: number;
  slug: string;
  name: string;
}
interface OurAttraction {
  id: number;
  name: string;
  parkId: number;
}

async function ourParks(): Promise<OurPark[]> {
  const r = await db.execute<{ id: string; slug: string; name: string }>(sql`
    SELECT id, slug, name FROM parks WHERE active = true ORDER BY id
  `);
  return r.rows.map((p) => ({ id: Number(p.id), slug: p.slug, name: p.name }));
}

async function ourAttractions(parkId: number): Promise<OurAttraction[]> {
  const r = await db.execute<{ id: string; name: string }>(sql`
    SELECT id, name FROM attractions
    WHERE park_id = ${parkId} AND active = true AND entity_type = 'ATTRACTION'
    ORDER BY id
  `);
  return r.rows.map((a) => ({ id: Number(a.id), name: a.name, parkId }));
}

async function existingQtParkIds(): Promise<Map<number, string>> {
  const r = await db.execute<{ entity_id: string; external_id: string }>(sql`
    SELECT entity_id, external_id FROM external_ids
    WHERE source = ${Source.QUEUE_TIMES} AND entity_kind = 'park'
  `);
  return new Map(r.rows.map((row) => [Number(row.entity_id), row.external_id]));
}

async function existingQtAttractionIds(): Promise<Map<number, string>> {
  const r = await db.execute<{ entity_id: string; external_id: string }>(sql`
    SELECT entity_id, external_id FROM external_ids
    WHERE source = ${Source.QUEUE_TIMES} AND entity_kind = 'attraction'
  `);
  return new Map(r.rows.map((row) => [Number(row.entity_id), row.external_id]));
}

/**
 * Fetch queue-times.com's park list and match to our parks by name.
 * The response is an array of operator groups: [{ name, parks: [...] }].
 * Inserts new `external_ids` rows for matched parks (idempotent).
 */
async function bootstrapParkIds(ourParkList: OurPark[]): Promise<number> {
  const data = await qtFetch("/parks.json", QtParksResponseSchema);
  if (!data) {
    console.warn("[backfill] bootstrap: could not fetch /parks.json");
    return 0;
  }

  // Flatten operator groups into a single list of parks.
  const allQtParks = data.flatMap((op) => op.parks);

  let matched = 0;
  for (const ours of ourParkList) {
    const best = bestParkMatch(ours.name, allQtParks);
    if (!best) {
      console.warn(`[backfill] bootstrap: no QT park match for "${ours.name}" (${ours.slug})`);
      continue;
    }
    console.log(`[backfill] bootstrap: "${ours.name}" → QT ${best.id} "${best.name}"`);
    if (!DRY_RUN) {
      await db
        .insert(externalIds)
        .values({
          entityKind: "park",
          entityId: ours.id,
          source: Source.QUEUE_TIMES,
          externalId: String(best.id),
        })
        .onConflictDoNothing();
    }
    matched++;
  }
  return matched;
}

/**
 * For one park, fetch the current QT ride list and match to our attractions by name.
 * Inserts new `external_ids` rows for matched attractions (idempotent).
 * Returns the number of new matches found.
 */
async function bootstrapAttractionIds(
  ours: OurPark,
  qtParkId: string,
  knownAttractionIds: Map<number, string>,
): Promise<number> {
  const data = await qtFetch(`/parks/${qtParkId}/queue_times.json`, QtCurrentResponseSchema);
  if (!data) {
    console.warn(`[backfill] bootstrap: no ride list for QT park ${qtParkId} (${ours.slug})`);
    return 0;
  }

  const qtRides = [...(data.rides ?? []), ...data.lands.flatMap((l) => l.rides)];
  const ourAttrList = await ourAttractions(ours.id);

  let matched = 0;
  for (const ourA of ourAttrList) {
    if (knownAttractionIds.has(ourA.id)) continue; // already mapped
    const best = bestRideMatch(ourA.name, qtRides);
    if (!best) continue;
    console.log(`[backfill] bootstrap:   "${ourA.name}" → QT ride ${best.id} "${best.name}"`);
    if (!DRY_RUN) {
      await db
        .insert(externalIds)
        .values({
          entityKind: "attraction",
          entityId: ourA.id,
          source: Source.QUEUE_TIMES,
          externalId: String(best.id),
        })
        .onConflictDoNothing();
      knownAttractionIds.set(ourA.id, String(best.id));
    }
    matched++;
  }
  return matched;
}

// ---------------------------------------------------------------------------
// Phase 2 helpers — historical backfill
// ---------------------------------------------------------------------------

interface RideMapping {
  attractionId: number;
  qtParkId: string;
  qtRideId: string;
  parkSlug: string;
  name: string;
}

async function rideMappings(): Promise<RideMapping[]> {
  const result = await db.execute<{
    attraction_id: string;
    qt_park_id: string;
    qt_ride_id: string;
    park_slug: string;
    name: string;
  }>(sql`
    SELECT
      a.id           AS attraction_id,
      ep.external_id AS qt_park_id,
      er.external_id AS qt_ride_id,
      p.slug         AS park_slug,
      a.name
    FROM attractions a
    JOIN parks p ON p.id = a.park_id
    JOIN external_ids er
      ON er.entity_kind = 'attraction'
      AND er.entity_id  = a.id
      AND er.source     = ${Source.QUEUE_TIMES}
    JOIN external_ids ep
      ON ep.entity_kind = 'park'
      AND ep.entity_id  = a.park_id
      AND ep.source     = ${Source.QUEUE_TIMES}
    WHERE a.active = true
      AND a.entity_type = 'ATTRACTION'
    ORDER BY p.slug, a.id
  `);
  return result.rows.map((r) => ({
    attractionId: Number(r.attraction_id),
    qtParkId: r.qt_park_id,
    qtRideId: r.qt_ride_id,
    parkSlug: r.park_slug,
    name: r.name,
  }));
}

async function coveredSet(start: Date, end: Date): Promise<Set<string>> {
  // Compute end-of-day in JS so we don't add INTERVAL to a parameter (type error).
  const endPlusOne = new Date(end);
  endPlusOne.setUTCDate(endPlusOne.getUTCDate() + 1);
  const result = await db.execute<{ attraction_id: string; d: string }>(sql`
    SELECT attraction_id, (observed_at AT TIME ZONE 'UTC')::date::text AS d
    FROM queue_obs
    WHERE source     = ${Source.QUEUE_TIMES}
      AND queue_type = ${QueueType.STANDBY}
      AND observed_at >= ${start.toISOString()}
      AND observed_at <  ${endPlusOne.toISOString()}
    GROUP BY attraction_id, d
  `);
  const set = new Set<string>();
  for (const r of result.rows) set.add(`${r.attraction_id}:${r.d}`);
  return set;
}

async function fetchDay(ride: RideMapping, date: string): Promise<QtHistoricalPoint[]> {
  const data = await qtFetch(
    `/parks/${ride.qtParkId}/rides/${ride.qtRideId}/queue_times.json?date=${date}`,
    QtHistoricalResponseSchema,
  );
  return data ?? [];
}

type QueueRow = typeof queueObs.$inferInsert;

async function insertPoints(attractionId: number, points: QtHistoricalPoint[]): Promise<number> {
  const rows: QueueRow[] = [];
  for (const p of points) {
    const observedAt = parseQtTimestamp(p.dateTime);
    if (!observedAt) continue;
    rows.push({
      observedAt,
      attractionId,
      queueType: QueueType.STANDBY,
      waitMin: p.isOpen ? p.waitTime : null,
      state: null,
      priceCents: null,
      currency: null,
      returnStart: null,
      returnEnd: null,
      boardingGroup: null,
      source: Source.QUEUE_TIMES,
    });
  }
  if (rows.length === 0) return 0;

  let inserted = 0;
  const CHUNK = 500;
  for (let i = 0; i < rows.length; i += CHUNK) {
    await db
      .insert(queueObs)
      .values(rows.slice(i, i + CHUNK))
      .onConflictDoNothing();
    inserted += rows.slice(i, i + CHUNK).length;
  }
  return inserted;
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function* dateRange(start: Date, end: Date): Generator<string> {
  const cur = new Date(start);
  cur.setUTCHours(0, 0, 0, 0);
  const last = new Date(end);
  last.setUTCHours(0, 0, 0, 0);
  while (cur <= last) {
    yield cur.toISOString().slice(0, 10);
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
}

async function runStep(label: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (err) {
    console.error(`[backfill] ${label} error:`, err instanceof Error ? err.message : err);
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log(
    `[backfill] queue-times historical import${DRY_RUN ? " (DRY RUN)" : ""}` +
      ` | ${START_DATE.toISOString().slice(0, 10)} → ${END_DATE.toISOString().slice(0, 10)}` +
      ` | delay ${DELAY_MS}ms`,
  );

  // ── Phase 1: bootstrap external_ids ──────────────────────────────────────

  const ourParkList = await ourParks();
  const qtParkMap = await existingQtParkIds();
  const qtAttrMap = await existingQtAttractionIds();

  const parksNeedingQtId = ourParkList.filter((p) => !qtParkMap.has(p.id));
  if (parksNeedingQtId.length > 0) {
    console.log(
      `[backfill] bootstrap: ${parksNeedingQtId.length} park(s) missing QT IDs — fetching parks.json`,
    );
    await sleep(DELAY_MS);
    const n = await bootstrapParkIds(ourParkList);
    console.log(`[backfill] bootstrap: ${n} park(s) matched and seeded`);

    // Reload after insert.
    const refreshed = await existingQtParkIds();
    for (const [k, v] of refreshed) qtParkMap.set(k, v);
  }

  // For each park that now has a QT park ID, bootstrap attraction IDs.
  let totalAttrSeeded = 0;
  for (const park of ourParkList) {
    const qtParkId = qtParkMap.get(park.id);
    if (!qtParkId) continue;
    await sleep(DELAY_MS);
    await runStep(`bootstrap attractions ${park.slug}`, async () => {
      const n = await bootstrapAttractionIds(park, qtParkId, qtAttrMap);
      if (n > 0) {
        console.log(`[backfill] bootstrap: ${park.slug}: ${n} attraction(s) matched`);
        totalAttrSeeded += n;
      }
    });
  }
  if (totalAttrSeeded > 0) {
    console.log(`[backfill] bootstrap: seeded ${totalAttrSeeded} attraction IDs total`);
  }

  // ── Phase 2: historical backfill ─────────────────────────────────────────

  const rides = await rideMappings();
  if (rides.length === 0) {
    console.warn(
      "[backfill] no attractions with Queue-Times IDs after bootstrap — check park name matching above",
    );
    return;
  }
  const parkCount = new Set(rides.map((r) => r.parkSlug)).size;
  console.log(`[backfill] ${rides.length} ride(s) across ${parkCount} park(s)`);

  const covered = await coveredSet(START_DATE, END_DATE);
  console.log(`[backfill] ${covered.size} (attraction, date) pair(s) already covered — will skip`);

  const dates = [...dateRange(START_DATE, END_DATE)];
  const total = dates.length * rides.length;
  console.log(
    `[backfill] up to ${total} request(s) (${rides.length} rides × ${dates.length} days)`,
  );

  let fetched = 0;
  let skipped = 0;
  let totalRows = 0;

  for (const ride of rides) {
    await runStep(`${ride.parkSlug}/${ride.name}`, async () => {
      let rideRows = 0;
      let rideFetches = 0;

      for (const date of dates) {
        const key = `${ride.attractionId}:${date}`;
        if (covered.has(key)) {
          skipped++;
          continue;
        }

        if (DRY_RUN) {
          console.log(`[backfill] DRY RUN: ${ride.parkSlug}/${ride.name} ${date}`);
          fetched++;
          continue;
        }

        await sleep(DELAY_MS);
        const points = await fetchDay(ride, date);
        const n = await insertPoints(ride.attractionId, points);
        rideRows += n;
        rideFetches++;
        fetched++;
        covered.add(key);
      }

      if (!DRY_RUN && rideFetches > 0) {
        console.log(
          `[backfill] ${ride.parkSlug}/${ride.name}: ${rideFetches} day(s), ${rideRows} rows`,
        );
      }
      totalRows += rideRows;
    });
  }

  console.log(
    `[backfill] done — fetched ${fetched}, skipped ${skipped} covered, inserted ${totalRows} rows`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
