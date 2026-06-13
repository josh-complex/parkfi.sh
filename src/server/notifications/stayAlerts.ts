/**
 * Stay-alert evaluation. Runs at the end of each stays sweep (see
 * services/stays-availability/main.ts): reads each active alert's latest
 * `stay_obs` generation for its query and decides whether to fire. On a fire it
 * writes a durable `notification` row (status `queued`) and enqueues a
 * `stay-alerts` job carrying that id — delivery is logged + retried EMAIL, never
 * fire-and-forget.
 *
 * The decision is a pure function (`decideStayAlert`) over a row + clock so it
 * unit-tests in isolation; `evaluateStayAlerts` is the DB/queue shell around it.
 * Mirrors src/server/notifications/alerts.ts (ride alerts).
 */
import { sql } from "drizzle-orm";

import { db } from "#/db/index.ts";
import { notification, stayAlert } from "#/db/schema.ts";
import { config } from "#/server/parks/config.ts";
import { getStayAlertQueue } from "#/server/notifications/queue.ts";
import {
  formatDateRange,
  resortDisplayName,
  scopeResortPairs,
  type StayNotificationPayload,
} from "#/server/notifications/stayFormat.ts";

/** Stay-alert rule modes (mirrors `stay_alert.mode`). */
export const StayAlertMode = {
  BECOMES_AVAILABLE: 1,
  PRICE_BELOW: 2,
} as const;
export type StayAlertModeCode = (typeof StayAlertMode)[keyof typeof StayAlertMode];

/** One active alert joined to its query's latest observed availability + price. */
export interface StayAlertRow {
  id: number;
  userId: string;
  resortId: string; // '' = any resort
  scope: string; // canonical selector ('' | 'r:<id>' | 't:<tier>' | 'a:<area>')
  mode: number;
  priceBelow: number | null;
  armed: boolean;
  lastFiredAt: Date | null;
  lastAvailable: boolean | null;
  lastPrice: number | null;
  checkIn: string;
  checkOut: string;
  // latest observed (null when the query has no obs yet)
  available: boolean | null;
  price: number | null;
  cheapestResortId: string | null;
}

/** Columns the evaluator writes back after deciding a row. */
export interface StayAlertStateUpdate {
  armed?: boolean;
  lastFiredAt?: Date;
  lastAvailable: boolean | null;
  lastPrice: number | null;
}

export interface StayAlertDecision {
  fire: boolean;
  set: StayAlertStateUpdate;
}

/** Does the alert's *rule* currently match the latest observation? */
function ruleMet(a: StayAlertRow): boolean {
  if (a.mode === StayAlertMode.BECOMES_AVAILABLE) {
    // A room is open. An optional priceBelow tightens it into a ceiling: only
    // fire when the open price is also at/under the cap.
    if (a.available !== true) return false;
    if (a.priceBelow == null) return true;
    return a.price != null && a.price <= a.priceBelow;
  }
  if (a.mode === StayAlertMode.PRICE_BELOW) {
    return (
      a.available === true && a.price != null && a.priceBelow != null && a.price <= a.priceBelow
    );
  }
  return false;
}

/**
 * Pure decision: edge-trigger on the arming edge (armed && met), then disarm;
 * re-arm once the rule stops matching (e.g. the room sells out again). Cooldown
 * gates repeat fires while still matched. `last_available`/`last_price` are
 * always refreshed so a flip is edge-detected next sweep.
 */
export function decideStayAlert(
  a: StayAlertRow,
  now: number,
  cooldownMs: number,
): StayAlertDecision {
  const met = ruleMet(a);
  const cooled = a.lastFiredAt == null || now - a.lastFiredAt.getTime() >= cooldownMs;
  const set: StayAlertStateUpdate = { lastAvailable: a.available, lastPrice: a.price };

  if (met && a.armed && cooled) {
    set.armed = false;
    set.lastFiredAt = new Date(now);
    return { fire: true, set };
  }
  if (!met) set.armed = true;
  return { fire: false, set };
}

/** Whether a decision changes anything we need to persist (avoid no-op writes). */
function isDirty(a: StayAlertRow, d: StayAlertDecision): boolean {
  return (
    d.set.armed !== undefined ||
    d.set.lastFiredAt !== undefined ||
    a.lastAvailable !== a.available ||
    a.lastPrice !== a.price
  );
}

/** Build the persisted payload + subject for a firing alert. */
function buildPayload(a: StayAlertRow): StayNotificationPayload {
  const resortName = resortDisplayName(a.resortId, a.cheapestResortId);
  const dateRange = formatDateRange(a.checkIn, a.checkOut);
  const subject =
    a.mode === StayAlertMode.PRICE_BELOW
      ? `${resortName} dropped to $${a.price?.toLocaleString() ?? ""}/night — ${dateRange}`
      : `${resortName} is available — ${dateRange}`;
  return {
    mode: a.mode,
    resortId: a.resortId,
    resortName,
    checkInDate: a.checkIn,
    checkOutDate: a.checkOut,
    dateRange,
    pricePerNight: a.price,
    priceBelow: a.priceBelow,
    subject,
  };
}

/**
 * Evaluate every active stay alert against its query's latest obs generation and
 * enqueue emails for the ones that fire. Skips users who've globally opted out.
 * Returns the number of alerts fired this run.
 */
export async function evaluateStayAlerts(now: number = Date.now()): Promise<number> {
  // (scope-token → resort-id) map so the lateral can resolve a tier/area scope
  // to its resort set in one set-based pass; '' (any) short-circuits the filter.
  const { scopes, resorts } = scopeResortPairs();
  const result = await db.execute<{
    id: string;
    user_id: string;
    resort_id: string;
    scope: string;
    mode: number;
    price_below: number | null;
    armed: boolean;
    last_fired_at: string | null;
    last_available: boolean | null;
    last_price: number | null;
    check_in: string;
    check_out: string;
    available: boolean | null;
    price: number | null;
    cheapest_resort_id: string | null;
  }>(sql`
    WITH scope_map AS (
      SELECT scope, resort_id
      FROM unnest(${scopes}::text[], ${resorts}::text[]) AS t(scope, resort_id)
    )
    SELECT sa.id, sa.user_id, sa.resort_id, sa.scope, sa.mode, sa.price_below,
           sa.armed, sa.last_fired_at, sa.last_available, sa.last_price,
           sq.check_in, sq.check_out,
           latest.available, latest.price, latest.cheapest_resort_id
    FROM stay_alert sa
    JOIN stay_query sq ON sq.id = sa.query_id
    LEFT JOIN alert_optout ao ON ao.user_id = sa.user_id
    LEFT JOIN LATERAL (
      SELECT bool_or(o.available) AS available,
             min(o.price_per_night) FILTER (WHERE o.available) AS price,
             (array_agg(o.resort_id ORDER BY o.price_per_night ASC NULLS LAST)
               FILTER (WHERE o.available))[1] AS cheapest_resort_id
      FROM stay_obs o
      WHERE o.check_in = sq.check_in
        AND o.check_out = sq.check_out
        AND o.party_key = sq.party_key
        AND (sa.scope = '' OR o.resort_id IN (
              SELECT sm.resort_id FROM scope_map sm WHERE sm.scope = sa.scope))
        AND o.observed_at = (
          SELECT max(o2.observed_at) FROM stay_obs o2
          WHERE o2.check_in = sq.check_in
            AND o2.check_out = sq.check_out
            AND o2.party_key = sq.party_key
        )
    ) latest ON true
    WHERE sa.active = true
      AND coalesce(ao.stay_email_opt_out, false) = false
  `);

  const rows: Array<StayAlertRow> = result.rows.map((r) => ({
    id: Number(r.id),
    userId: r.user_id,
    resortId: r.resort_id,
    scope: r.scope,
    mode: Number(r.mode),
    priceBelow: r.price_below,
    armed: r.armed,
    lastFiredAt: r.last_fired_at ? new Date(r.last_fired_at) : null,
    lastAvailable: r.last_available,
    lastPrice: r.last_price,
    checkIn: r.check_in,
    checkOut: r.check_out,
    available: r.available,
    price: r.price == null ? null : Number(r.price),
    cheapestResortId: r.cheapest_resort_id,
  }));

  let fired = 0;
  for (const a of rows) {
    const decision = decideStayAlert(a, now, config.alertCooldownMs);
    if (decision.fire) {
      const payload = buildPayload(a);
      // Durable log FIRST (status queued), then enqueue carrying its id — so a
      // crash between the two leaves a queued row we can reconcile, never a
      // silent send.
      const [row] = await db
        .insert(notification)
        .values({
          alertId: a.id,
          userId: a.userId,
          channel: "email",
          payload,
          status: "queued",
        })
        .returning({ id: notification.id });
      await getStayAlertQueue().add("stay-alert", { notificationId: row.id });
      fired++;
    }
    if (isDirty(a, decision)) {
      await db
        .update(stayAlert)
        .set(decision.set)
        .where(sql`${stayAlert.id} = ${a.id}`);
    }
  }
  return fired;
}
