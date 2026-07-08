/**
 * Owner-only debug tools for the alert/notification pipelines: run a sweep on
 * demand instead of waiting for the cron tick, fire an arbitrary test push,
 * and force-fire a real dining alert's full push+email+deep-link delivery
 * without waiting for live availability to match. Backs the floating dev
 * `ErrorTestPanel` (self-scoped one-click actions) and `/admin/alerts` (the
 * fuller any-user tool with a picker).
 */
import { TRPCError, type TRPCRouterRecord } from "@trpc/server";
import { sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "#/db/index.ts";
import { evaluateAlerts } from "#/server/notifications/alerts.ts";
import {
  buildDiningNotificationPayload,
  dispatchDiningFire,
  evaluateDiningAlerts,
  type DiningAlertRow,
} from "#/server/notifications/diningAlerts.ts";
import type { DiningNotificationPayload } from "#/server/notifications/diningFormat.ts";
import { getPushQueue } from "#/server/notifications/queue.ts";
import { adminProcedure } from "../init.ts";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD");
const isoTime = z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/, "expected HH:MM or HH:MM:SS");

/** The bit shared by every force-fire path: resolve the offer, dispatch. */
async function fireDiningAlertRow(
  alert: {
    id: number;
    userId: string;
    facilityId: string;
    partySize: number;
    serviceDate: string | null;
    windowDays: number | null;
    emailOptOut: boolean;
  },
  matchedFacilityId: string,
  matchedDate: string,
  matchedOfferTime: string,
): Promise<DiningNotificationPayload> {
  const restaurantResult = await db.execute<{ name: string }>(sql`
    SELECT name FROM restaurant_dim WHERE facility_id = ${matchedFacilityId}
  `);
  const restaurant = restaurantResult.rows[0];
  if (!restaurant) throw new TRPCError({ code: "NOT_FOUND", message: "Unknown facility id" });

  const row: DiningAlertRow = {
    ...alert,
    armed: true,
    lastFiredAt: null,
    lastAvailable: null,
    matchedDate,
    matchedFacilityId,
    matchedOfferTime,
    matchedName: restaurant.name,
  };
  const payload = buildDiningNotificationPayload(row);
  await dispatchDiningFire({
    alertId: row.id,
    userId: row.userId,
    payload,
    pushUrl: `/dining/${matchedFacilityId}`,
    emailOptOut: row.emailOptOut,
  });
  return payload;
}

export const adminAlertsRouter = {
  /** Run the real dining-alert sweep right now, against live data. */
  runDiningSweep: adminProcedure.mutation(async () => ({ fired: await evaluateDiningAlerts() })),

  /** Run the real ride/Lightning-Lane sweep right now, against live data. */
  runRideSweep: adminProcedure.mutation(async () => ({ fired: await evaluateAlerts() })),

  /** Fire an arbitrary push notification at a user — tests delivery alone. */
  sendTestPush: adminProcedure
    .input(
      z.object({
        userId: z.string().min(1),
        title: z.string().min(1).max(200),
        body: z.string().min(1).max(500),
        url: z.string().max(500).optional(),
      }),
    )
    .mutation(async ({ input }) => {
      await getPushQueue().add("admin-test", {
        userId: input.userId,
        title: input.title,
        body: input.body,
        url: input.url,
      });
      return { ok: true };
    }),

  /** A user's active dining alerts, for the force-fire picker. */
  userDiningAlerts: adminProcedure
    .input(z.object({ userId: z.string().min(1) }))
    .query(async ({ input }) => {
      const result = await db.execute<{
        id: string;
        facility_id: string;
        facility_name: string | null;
        party_size: number;
      }>(sql`
        SELECT da.id, da.facility_id, rd.name AS facility_name, da.party_size
        FROM dining_alert da
        LEFT JOIN restaurant_dim rd ON rd.facility_id = da.facility_id
        WHERE da.user_id = ${input.userId} AND da.active = true
        ORDER BY da.id DESC
      `);
      return result.rows.map((r) => ({
        id: Number(r.id),
        facilityId: r.facility_id,
        restaurantName: r.facility_id ? (r.facility_name ?? "a restaurant") : "Any restaurant",
        partySize: Number(r.party_size),
      }));
    }),

  /**
   * Force-fire a real dining alert's full delivery (push + email, including
   * the mdx deep link) with an admin-supplied "matched" offer — exercises the
   * exact same `dispatchDiningFire` path a live sweep would, without waiting
   * for real availability. Does not touch the alert's armed/cooldown state.
   */
  forceFireDiningAlert: adminProcedure
    .input(
      z.object({
        alertId: z.number().int().positive(),
        // Required when the alert watches "any restaurant" (facility_id = '').
        matchedFacilityId: z.string().min(1).optional(),
        matchedDate: isoDate.optional(),
        matchedOfferTime: isoTime.optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const alertResult = await db.execute<{
        id: string;
        user_id: string;
        facility_id: string;
        party_size: number;
        service_date: string | null;
        window_days: number | null;
        email_opt_out: boolean | null;
      }>(sql`
        SELECT da.id, da.user_id, da.facility_id, da.party_size,
               da.service_date, da.window_days,
               ao.dining_email_opt_out AS email_opt_out
        FROM dining_alert da
        LEFT JOIN alert_optout ao ON ao.user_id = da.user_id
        WHERE da.id = ${input.alertId}
      `);
      const alert = alertResult.rows[0];
      if (!alert) throw new TRPCError({ code: "NOT_FOUND", message: "Alert not found" });

      const matchedFacilityId = input.matchedFacilityId || alert.facility_id || null;
      if (!matchedFacilityId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: 'This alert watches "any restaurant" — supply a facility id to fire it.',
        });
      }
      const matchedDate = input.matchedDate ?? new Date().toISOString().slice(0, 10);
      const matchedOfferTime =
        (input.matchedOfferTime?.length === 5
          ? `${input.matchedOfferTime}:00`
          : input.matchedOfferTime) ?? "18:00:00";

      const payload = await fireDiningAlertRow(
        {
          id: Number(alert.id),
          userId: alert.user_id,
          facilityId: alert.facility_id,
          partySize: Number(alert.party_size),
          serviceDate: alert.service_date ? String(alert.service_date).slice(0, 10) : null,
          windowDays: alert.window_days == null ? null : Number(alert.window_days),
          emailOptOut: alert.email_opt_out ?? false,
        },
        matchedFacilityId,
        matchedDate,
        matchedOfferTime,
      );
      return { ok: true, payload };
    }),

  /** Send myself a test push — the floating dev panel's one-click trigger. */
  sendTestPushToMe: adminProcedure.mutation(async ({ ctx }) => {
    await getPushQueue().add("admin-test", {
      userId: ctx.userId,
      title: "Test notification",
      body: "This is a test push from the debug panel.",
      url: "/dining",
    });
    return { ok: true };
  }),

  /**
   * Force-fire my own most-recent specific-restaurant dining alert (today,
   * 6pm) — the floating dev panel's one-click trigger for the full
   * push+email+deep-link pipeline, no picker needed.
   */
  fireMyDiningAlert: adminProcedure.mutation(async ({ ctx }) => {
    const result = await db.execute<{
      id: string;
      facility_id: string;
      party_size: number;
      service_date: string | null;
      window_days: number | null;
      email_opt_out: boolean | null;
    }>(sql`
      SELECT da.id, da.facility_id, da.party_size, da.service_date, da.window_days,
             ao.dining_email_opt_out AS email_opt_out
      FROM dining_alert da
      LEFT JOIN alert_optout ao ON ao.user_id = da.user_id
      WHERE da.user_id = ${ctx.userId} AND da.active = true AND da.facility_id <> ''
      ORDER BY da.id DESC
      LIMIT 1
    `);
    const alert = result.rows[0];
    if (!alert) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "No specific-restaurant dining alert found — set one on a restaurant page first.",
      });
    }
    const payload = await fireDiningAlertRow(
      {
        id: Number(alert.id),
        userId: ctx.userId,
        facilityId: alert.facility_id,
        partySize: Number(alert.party_size),
        serviceDate: alert.service_date ? String(alert.service_date).slice(0, 10) : null,
        windowDays: alert.window_days == null ? null : Number(alert.window_days),
        emailOptOut: alert.email_opt_out ?? false,
      },
      alert.facility_id,
      new Date().toISOString().slice(0, 10),
      "18:00:00",
    );
    return { ok: true, payload };
  }),
} satisfies TRPCRouterRecord;
