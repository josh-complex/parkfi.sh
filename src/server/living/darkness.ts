/**
 * Living Layer — the Darkness engine (M2). THE mic-drop.
 *
 * Turns the REAL live park feed into reactive game state: when a ride actually
 * goes DOWN, darkness "leaks" from it — we spawn an `encounter`/`world` mark at
 * that attraction, right now. When it comes back up, the breach seals and the
 * mark expires. This is the thing no competitor can build, because no one else
 * holds the live operational wire (docs/plans/living-layer/04-game-design.md).
 *
 * DESIGN — level-triggered reconcile, not edge-triggered:
 *   Rather than hooking the hot ingest path and reacting to status *transitions*,
 *   `reconcileDarkness()` reads the CURRENT status of every attraction (the rows
 *   ingest already wrote) and makes the world match it. This means:
 *     • ZERO changes to services/parks/ingest.ts — it stays exactly as-is.
 *     • Self-healing — a missed tick can't strand the world in a wrong state.
 *     • Idempotent — safe to run every tick (a partial unique index keeps at
 *       most one active system mark per (attraction, type)).
 *
 * SAFETY: invoked only from the worker, only when LIVING_ENABLED=1, inside an
 * isolated try/catch — it can never affect ingestion or the existing app.
 */
import { sql } from "drizzle-orm";

import { db } from "#/db/index.ts";
import { mark } from "#/db/schema.ts";
import { AttractionStatus } from "#/server/parks/codes.ts";

import { livingConfig } from "./config.ts";
import { HeartlessType, MarkState, MarkType } from "./codes.ts";

import type { HeartlessTypeCode } from "./codes.ts";
import type { LiveStateSnapshot } from "#/db/schema.ts";

export interface DarknessResult {
  spawned: number;
  expired: number;
}

/** Inputs the spawn decision needs — kept narrow so the rule is pure/testable. */
export interface SpawnInputs {
  status: number;
  standbyMin: number | null;
  /** 0..23 local hour, for time-of-day weighting (optional). */
  hour?: number | null;
}

/**
 * Pure spawn rule: should a ride be leaking the Darkness right now, and how
 * strong? Returns null when there's nothing to spawn. Kept I/O-free so the
 * economy can be tuned and unit-tested without a DB or device (darkness.test.ts).
 */
export function spawnDecision(
  inp: SpawnInputs,
): { heartlessType: HeartlessTypeCode; rarity: number } | null {
  // A genuine breakdown is the headline event — darkness leaks here, now.
  if (inp.status === AttractionStatus.DOWN) {
    // A long-standby ride going down is a bigger deal → rarer/stronger spawn.
    const rarity = inp.standbyMin != null && inp.standbyMin >= 60 ? 3 : 2;
    return { heartlessType: HeartlessType.BREAKER, rarity };
  }
  return null;
}

// A `type` (not `interface`) so it satisfies db.execute's `Record<string,
// unknown>` generic constraint — interfaces lack an implicit index signature.
type CurrentStatusRow = {
  attraction_id: number;
  park_id: number;
  status: number;
  standby_min: number | null;
  latitude: number | null;
  longitude: number | null;
};

/**
 * Reconcile the Darkness layer to the current live park state.
 *
 *  1. For every attraction whose latest status is DOWN, ensure an active system
 *     `encounter` mark exists (idempotent upsert).
 *  2. Expire active system Darkness marks whose source ride is no longer DOWN
 *     (after a small grace), and any time-expired marks.
 *
 * Returns counts for the worker log line.
 */
export async function reconcileDarkness(): Promise<DarknessResult> {
  // (1) Spawn — current DOWN attractions in active parks, with their latest
  // standby and any world they fall in. DISTINCT ON gives the carry-forward
  // latest status per attraction (mirrors how the board derives "current").
  const down = (
    await db.execute<CurrentStatusRow>(sql`
      WITH latest AS (
        SELECT DISTINCT ON (attraction_id) attraction_id, status
        FROM attraction_status_obs
        ORDER BY attraction_id, observed_at DESC
      ),
      latest_wait AS (
        SELECT DISTINCT ON (attraction_id) attraction_id, wait_min
        FROM queue_obs
        WHERE queue_type = 1
        ORDER BY attraction_id, observed_at DESC
      )
      SELECT a.id AS attraction_id, a.park_id, l.status,
             lw.wait_min AS standby_min, a.latitude, a.longitude
      FROM latest l
      JOIN attractions a ON a.id = l.attraction_id
      JOIN parks p ON p.id = a.park_id AND p.active = true
      LEFT JOIN latest_wait lw ON lw.attraction_id = a.id
      WHERE l.status = ${AttractionStatus.DOWN}
        AND a.category IS NOT NULL
    `)
  ).rows;

  const nowIso = new Date().toISOString();
  // Despawn clock: a spawn lives until `expiresAt`, which we (re)stamp to
  // now + TTL on every reconcile WHILE the ride is down. Once the ride recovers
  // we stop refreshing it, so its last `expiresAt` stands and it lingers TTL
  // longer before the time-expiry sweep fades it (giving players time to reach
  // it). TTL is flaggable via LIVING_SPAWN_TTL_MS (see livingConfig).
  const expiresAt = new Date(Date.now() + livingConfig.spawnTtlMs);
  let spawned = 0;
  for (const row of down) {
    const decision = spawnDecision({ status: row.status, standbyMin: row.standby_min });
    if (!decision) continue;

    const snapshot: LiveStateSnapshot = {
      status: "DOWN",
      standbyMin: row.standby_min,
      capturedAt: nowIso,
    };

    // Idempotent: the partial unique index on (attraction_id, type) WHERE
    // is_system AND state='active' means re-running just refreshes the snapshot
    // and pushes the TTL out for as long as the ride stays down.
    await db
      .insert(mark)
      .values({
        type: MarkType.ENCOUNTER,
        isSystem: true,
        parkId: Number(row.park_id),
        // World association is added later via a geofence point-in-polygon step
        // (a single park has many worlds, so it can't be joined in SQL here).
        worldId: null,
        attractionId: Number(row.attraction_id),
        latitude: row.latitude,
        longitude: row.longitude,
        state: MarkState.ACTIVE,
        liveStateSnapshot: snapshot,
        expiresAt,
        payload: {
          heartlessType: decision.heartlessType,
          rarity: decision.rarity,
          source: "darkness",
        },
      })
      .onConflictDoUpdate({
        target: [mark.attractionId, mark.type],
        targetWhere: sql`is_system = true AND state = 'active' AND attraction_id IS NOT NULL`,
        set: { liveStateSnapshot: snapshot, expiresAt },
      });
    spawned++;
  }

  // (2) Despawn — purely time-driven, off `expires_at`. A recovered ride is no
  // longer refreshed above, so it simply ages out TTL after recovery. (This one
  // sweep also covers any other time-bounded marks, e.g. collectibles.)
  const expired = await db.execute(sql`
    UPDATE mark
    SET state = ${MarkState.FADED}
    WHERE state = 'active' AND expires_at IS NOT NULL AND expires_at < now()
  `);

  return { spawned, expired: expired.rowCount ?? 0 };
}
