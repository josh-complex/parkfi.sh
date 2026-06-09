/**
 * Ride wait-time alert evaluation. Runs once per worker tick (see
 * services/worker/main.ts): reads each active alert's latest STANDBY wait +
 * status from the data the poller already wrote, decides whether to fire, and
 * enqueues a push job. No separate fetch path — alert latency == POLL_INTERVAL_MS.
 *
 * The decision is a pure function (`decideAlert`) over a row + clock so it can be
 * unit-tested in isolation; `evaluateAlerts` is the thin DB/queue shell around it.
 */
import { sql } from "drizzle-orm";

import { db } from "#/db/index.ts";
import { rideAlert } from "#/db/schema.ts";
import { config } from "#/server/parks/config.ts";
import { getPushQueue, type PushJob } from "#/server/notifications/queue.ts";

/** Alert rule modes (mirrors `ride_alert.mode`). */
export const AlertMode = {
  THRESHOLD: 1,
  CHANGE: 2,
} as const;
export type AlertModeCode = (typeof AlertMode)[keyof typeof AlertMode];

/** One active alert joined to the attraction's latest observed wait + status. */
export interface AlertRow {
  id: number;
  userId: string;
  attractionId: number;
  attractionName: string;
  parkSlug: string;
  mode: number;
  thresholdMin: number | null;
  changeDelta: number | null;
  armed: boolean;
  lastFiredAt: Date | null;
  lastWaitMin: number | null;
  lastStatus: number | null;
  // latest observed (null when the ride has no recent data)
  wait: number | null;
  status: number | null;
}

/** Columns the evaluator writes back after deciding a row. */
export interface AlertStateUpdate {
  armed?: boolean;
  lastFiredAt?: Date;
  lastWaitMin?: number | null;
  lastStatus: number | null;
}

export interface AlertDecision {
  /** Whether to enqueue a push for this alert right now. */
  fire: boolean;
  /** State to persist back to the row (always set, even when not firing). */
  set: AlertStateUpdate;
}

/** Does the alert's *rule* currently match the latest observation? */
function ruleMet(a: AlertRow): boolean {
  if (a.mode === AlertMode.THRESHOLD) {
    return a.thresholdMin != null && a.wait != null && a.wait <= a.thresholdMin;
  }
  if (a.mode === AlertMode.CHANGE) {
    const statusFlipped = a.lastStatus != null && a.status != null && a.status !== a.lastStatus;
    const drifted =
      a.changeDelta != null &&
      a.wait != null &&
      a.lastWaitMin != null &&
      Math.abs(a.wait - a.lastWaitMin) >= a.changeDelta;
    return statusFlipped || drifted;
  }
  return false;
}

/**
 * Pure decision: given an alert row, the current time, and the cooldown, decide
 * whether to fire and what state to write back.
 *
 * Edge-trigger: fire only on the arming edge (armed && met), then disarm; re-arm
 * once the rule stops matching. Cooldown gates repeat fires while still matched.
 * `lastStatus` is always refreshed so status flips are edge-detected next tick.
 */
export function decideAlert(a: AlertRow, now: number, cooldownMs: number): AlertDecision {
  const met = ruleMet(a);
  const cooled = a.lastFiredAt == null || now - a.lastFiredAt.getTime() >= cooldownMs;
  const set: AlertStateUpdate = { lastStatus: a.status };

  if (met && a.armed && cooled) {
    set.armed = false;
    set.lastFiredAt = new Date(now);
    // Change mode tracks drift from a moving baseline; reset it on fire.
    if (a.mode === AlertMode.CHANGE) set.lastWaitMin = a.wait;
    return { fire: true, set };
  }
  if (!met) set.armed = true;
  return { fire: false, set };
}

/** Build the push payload for a firing alert. */
function buildJob(a: AlertRow): PushJob {
  const wait = a.wait != null ? `${a.wait} min` : "update";
  const body =
    a.mode === AlertMode.THRESHOLD
      ? `Standby dropped to ${a.wait} min (alert: ≤${a.thresholdMin} min)`
      : `Standby is now ${a.wait != null ? `${a.wait} min` : "updated"}`;
  return {
    userId: a.userId,
    title: `${a.attractionName} — ${wait}`,
    body,
    url: `/park/${a.parkSlug}`,
  };
}

/** Whether a decision changes anything we need to persist (avoid no-op writes). */
function isDirty(a: AlertRow, d: AlertDecision): boolean {
  return (
    d.set.armed !== undefined ||
    d.set.lastFiredAt !== undefined ||
    d.set.lastWaitMin !== undefined ||
    a.lastStatus !== a.status
  );
}

/**
 * Evaluate every active alert against the latest observation and enqueue pushes.
 * Returns the number of alerts fired this tick.
 */
export async function evaluateAlerts(now: number = Date.now()): Promise<number> {
  const result = await db.execute<{
    id: string;
    user_id: string;
    attraction_id: string;
    attraction_name: string;
    park_slug: string;
    mode: number;
    threshold_min: number | null;
    change_delta: number | null;
    armed: boolean;
    last_fired_at: string | null;
    last_wait_min: number | null;
    last_status: number | null;
    wait: number | null;
    status: number | null;
  }>(sql`
    SELECT ra.id, ra.user_id, ra.attraction_id, a.name AS attraction_name, p.slug AS park_slug,
           ra.mode, ra.threshold_min, ra.change_delta, ra.armed, ra.last_fired_at,
           ra.last_wait_min, ra.last_status,
           sb.wait_min AS wait, st.status AS status
    FROM ride_alert ra
    JOIN attractions a ON a.id = ra.attraction_id
    JOIN parks p ON p.id = ra.park_id
    LEFT JOIN LATERAL (
      SELECT q.wait_min
      FROM queue_obs q
      WHERE q.attraction_id = ra.attraction_id
        AND q.queue_type = 1
        AND q.observed_at >= now() - INTERVAL '24 hours'
      ORDER BY q.observed_at DESC
      LIMIT 1
    ) sb ON true
    LEFT JOIN LATERAL (
      SELECT s.status
      FROM attraction_status_obs s
      WHERE s.attraction_id = ra.attraction_id
      ORDER BY s.observed_at DESC
      LIMIT 1
    ) st ON true
    WHERE ra.active = true
  `);

  const rows: Array<AlertRow> = result.rows.map((r) => ({
    id: Number(r.id),
    userId: r.user_id,
    attractionId: Number(r.attraction_id),
    attractionName: r.attraction_name,
    parkSlug: r.park_slug,
    mode: Number(r.mode),
    thresholdMin: r.threshold_min,
    changeDelta: r.change_delta,
    armed: r.armed,
    lastFiredAt: r.last_fired_at ? new Date(r.last_fired_at) : null,
    lastWaitMin: r.last_wait_min,
    lastStatus: r.last_status,
    wait: r.wait,
    status: r.status,
  }));

  let fired = 0;
  for (const a of rows) {
    const decision = decideAlert(a, now, config.alertCooldownMs);
    if (decision.fire) {
      await getPushQueue().add("ride-alert", buildJob(a));
      fired++;
    }
    if (isDirty(a, decision)) {
      await db
        .update(rideAlert)
        .set(decision.set)
        .where(sql`${rideAlert.id} = ${a.id}`);
    }
  }
  return fired;
}
