/**
 * Dining-alert evaluation. Runs at the end of each dining-availability sweep
 * (see services/dining-availability/main.ts): reads each active alert's latest
 * `dining_obs` generation for its (facility-or-any × party × date/window) and
 * decides whether to fire. On a fire it always enqueues an immediate PUSH job
 * (push is opted into via browser subscription, independent of email prefs —
 * never gated on `dining_email_opt_out`) and, unless the user opted out of
 * dining email, also writes a durable `dining_notification` row (status
 * `queued`) and enqueues a `dining-alerts` job carrying that id — email
 * delivery is logged + retried, never fire-and-forget.
 *
 * The decision is a pure function (`decideDiningAlert`) over a row + clock so it
 * unit-tests in isolation; `evaluateDiningAlerts` is the DB/queue shell around
 * it. Mirrors src/server/notifications/stayAlerts.ts.
 */
import { sql } from "drizzle-orm";

import { db } from "#/db/index.ts";
import { diningNotification } from "#/db/schema.ts";
import { config } from "#/server/parks/config.ts";
import { getDiningAlertQueue, getPushQueue } from "#/server/notifications/queue.ts";
import {
  buildDiningDeepLink,
  diningDateLabel,
  formatServiceDate,
  type DiningNotificationPayload,
} from "#/server/notifications/diningFormat.ts";

/** One active alert joined to the soonest matching available service date. */
export interface DiningAlertRow {
  id: number;
  userId: string;
  facilityId: string; // '' = any priority restaurant
  partySize: number;
  serviceDate: string | null; // set = watch this single day
  windowDays: number | null; // set = watch any day in the next N
  armed: boolean;
  lastFiredAt: Date | null;
  lastAvailable: boolean | null;
  // Push is independent of this — it's opted into via browser subscription, not
  // this flag. Only gates whether a fire also logs+sends the email.
  emailOptOut: boolean;
  // latest-generation match (null when nothing is available)
  matchedDate: string | null;
  matchedFacilityId: string | null;
  matchedOfferTime: string | null;
  matchedName: string | null;
}

/** Columns the evaluator writes back after deciding a row. */
export interface DiningAlertStateUpdate {
  armed?: boolean;
  lastFiredAt?: Date;
  lastAvailable: boolean;
}

export interface DiningAlertDecision {
  fire: boolean;
  set: DiningAlertStateUpdate;
}

/** Does the alert's rule currently match? (a reservation is available). */
function ruleMet(a: DiningAlertRow): boolean {
  return a.matchedDate != null;
}

/**
 * Pure decision: edge-trigger on the arming edge (armed && met), then disarm;
 * re-arm once the rule stops matching (the table is taken again). Cooldown gates
 * repeat fires while still matched. `last_available` is always refreshed so a
 * flip is edge-detected next sweep. Mirrors `decideStayAlert`.
 */
export function decideDiningAlert(
  a: DiningAlertRow,
  now: number,
  cooldownMs: number,
): DiningAlertDecision {
  const met = ruleMet(a);
  const cooled = a.lastFiredAt == null || now - a.lastFiredAt.getTime() >= cooldownMs;
  const set: DiningAlertStateUpdate = { lastAvailable: met };

  if (met && a.armed && cooled) {
    set.armed = false;
    set.lastFiredAt = new Date(now);
    return { fire: true, set };
  }
  if (!met) set.armed = true;
  return { fire: false, set };
}

/** Whether a decision changes anything we need to persist (avoid no-op writes). */
function isDirty(a: DiningAlertRow, d: DiningAlertDecision): boolean {
  return (
    d.set.armed !== undefined ||
    d.set.lastFiredAt !== undefined ||
    a.lastAvailable !== d.set.lastAvailable
  );
}

/** Build the persisted payload + subject for a firing alert. */
function buildPayload(a: DiningAlertRow): DiningNotificationPayload {
  const restaurantName = a.matchedName ?? "a Disney restaurant";
  const matchedDate = a.matchedDate ?? "";
  const dateLabel = diningDateLabel(a.serviceDate, a.windowDays);
  const subject = matchedDate
    ? `${restaurantName} has a table for ${a.partySize} — ${formatServiceDate(matchedDate)}`
    : `${restaurantName} has a table for ${a.partySize}`;
  const deepLink =
    a.matchedFacilityId && a.matchedDate && a.matchedOfferTime
      ? buildDiningDeepLink({
          facilityId: a.matchedFacilityId,
          partySize: a.partySize,
          serviceDate: a.matchedDate,
          offerTime: a.matchedOfferTime,
          completionDeepLink: `${config.appBaseUrl}/dining/${a.matchedFacilityId}`,
        })
      : null;
  return {
    facilityId: a.facilityId,
    restaurantName,
    partySize: a.partySize,
    serviceDate: a.serviceDate,
    windowDays: a.windowDays,
    matchedDate,
    dateLabel,
    subject,
    deepLink,
  };
}

/**
 * Evaluate every active dining alert against the latest `dining_obs` generation
 * and fire push + (unless opted out) email for the ones that match. Returns the
 * number of alerts fired this run.
 */
export async function evaluateDiningAlerts(now: number = Date.now()): Promise<number> {
  const result = await db.execute<{
    id: string;
    user_id: string;
    facility_id: string;
    party_size: number;
    service_date: string | null;
    window_days: number | null;
    armed: boolean;
    last_fired_at: string | null;
    last_available: boolean | null;
    email_opt_out: boolean | null;
    matched_date: string | null;
    matched_facility_id: string | null;
    matched_offer_time: string | null;
    matched_name: string | null;
  }>(sql`
    SELECT da.id, da.user_id, da.facility_id, da.party_size,
           da.service_date, da.window_days,
           da.armed, da.last_fired_at, da.last_available,
           ao.dining_email_opt_out AS email_opt_out,
           m.matched_date, m.matched_facility_id, m.matched_offer_time, m.matched_name
    FROM dining_alert da
    LEFT JOIN alert_optout ao ON ao.user_id = da.user_id
    LEFT JOIN LATERAL (
      SELECT o.service_date AS matched_date,
             o.facility_id  AS matched_facility_id,
             o.offer_time   AS matched_offer_time,
             r.name         AS matched_name
      FROM dining_obs o
      JOIN restaurant_dim r ON r.facility_id = o.facility_id
      WHERE r.priority = true AND r.active = true AND r.bookable = true
        AND o.party_size = da.party_size
        AND (da.facility_id = '' OR o.facility_id = da.facility_id)
        AND (
          (da.service_date IS NOT NULL AND o.service_date = da.service_date)
          OR (da.window_days IS NOT NULL
              AND o.service_date >= current_date
              AND o.service_date < current_date + da.window_days)
        )
        AND o.meal_period <> ''
        AND o.observed_at = (
          SELECT max(o2.observed_at) FROM dining_obs o2
          WHERE o2.facility_id = o.facility_id
            AND o2.service_date = o.service_date
            AND o2.party_size = o.party_size
        )
      ORDER BY o.service_date ASC
      LIMIT 1
    ) m ON true
    WHERE da.active = true
  `);

  const rows: Array<DiningAlertRow> = result.rows.map((r) => ({
    id: Number(r.id),
    userId: r.user_id,
    facilityId: r.facility_id,
    partySize: Number(r.party_size),
    serviceDate: r.service_date ? String(r.service_date).slice(0, 10) : null,
    windowDays: r.window_days == null ? null : Number(r.window_days),
    armed: r.armed,
    lastFiredAt: r.last_fired_at ? new Date(r.last_fired_at) : null,
    lastAvailable: r.last_available,
    emailOptOut: r.email_opt_out ?? false,
    matchedDate: r.matched_date ? String(r.matched_date).slice(0, 10) : null,
    matchedFacilityId: r.matched_facility_id,
    matchedOfferTime: r.matched_offer_time,
    matchedName: r.matched_name,
  }));

  let fired = 0;
  for (const a of rows) {
    const decision = decideDiningAlert(a, now, config.alertCooldownMs);
    if (decision.fire) {
      const payload = buildPayload(a);
      // Push first: it's the fast, opt-in-by-subscription channel and never
      // waits on the durable email log. A user with no registered device just
      // gets a harmless no-op (the worker logs and drops it).
      await getPushQueue().add("dining-alert", {
        userId: a.userId,
        title: payload.subject,
        body: `Party of ${a.partySize} · ${payload.dateLabel}`,
        url: a.matchedFacilityId ? `/dining/${a.matchedFacilityId}` : "/dining",
      });
      if (!a.emailOptOut) {
        // Durable log FIRST (status queued), then enqueue carrying its id — a
        // crash between the two leaves a queued row to reconcile, never a
        // silent send.
        const [row] = await db
          .insert(diningNotification)
          .values({
            alertId: a.id,
            userId: a.userId,
            channel: "email",
            payload,
            status: "queued",
          })
          .returning({ id: diningNotification.id });
        await getDiningAlertQueue().add("dining-alert", { notificationId: row.id });
      }
      fired++;
    }
    if (isDirty(a, decision)) {
      await db.execute(sql`
        UPDATE dining_alert
        SET last_available = ${decision.set.lastAvailable}
            ${decision.set.armed !== undefined ? sql`, armed = ${decision.set.armed}` : sql``}
            ${decision.set.lastFiredAt !== undefined ? sql`, last_fired_at = ${decision.set.lastFiredAt}` : sql``}
        WHERE id = ${a.id}
      `);
    }
  }
  return fired;
}
