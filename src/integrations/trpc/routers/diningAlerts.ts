import { TRPCError, type TRPCRouterRecord } from "@trpc/server";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "#/db/index.ts";
import { diningAlert } from "#/db/schema.ts";
import { diningDateLabel } from "#/server/notifications/diningFormat.ts";
import { protectedProcedure } from "../init.ts";

/** Max active dining alerts a user may keep, total (no park axis). */
const MAX_PER_USER = 3;

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD");

// The date axis is exactly one of: a single service date, or a rolling window of
// the next N days. The client sends one; a refine rejects "both" / "neither".
const dateAxis = {
  serviceDate: isoDate.optional(),
  windowDays: z.number().int().min(1).max(90).optional(),
};
const oneDate = (v: { serviceDate?: string; windowDays?: number }) =>
  (v.serviceDate != null) !== (v.windowDays != null);
const dateError = {
  message: "Set exactly one of serviceDate or windowDays",
  path: ["serviceDate"],
};

const createInput = z
  .object({
    // '' = any priority restaurant; otherwise a restaurant_dim facility id.
    facilityId: z.string().default(""),
    partySize: z.number().int().min(1).max(10),
    ...dateAxis,
  })
  .refine(oneDate, dateError);

// Latest-generation availability + soonest matching date + restaurant name for an
// alert — mirrors the dining evaluator so list reflects what would fire.
const latestMatch = sql`
  LEFT JOIN LATERAL (
    SELECT o.service_date AS matched_date, r.name AS matched_name
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
  ) m ON true`;

export const diningAlertsRouter = {
  /** The current user's active dining alerts, with each one's current status. */
  list: protectedProcedure.query(async ({ ctx }) => {
    const result = await db.execute<{
      id: string;
      facility_id: string;
      facility_name: string | null;
      party_size: number;
      service_date: string | null;
      window_days: number | null;
      armed: boolean;
      last_fired_at: string | null;
      matched_date: string | null;
      matched_name: string | null;
    }>(sql`
      SELECT da.id, da.facility_id, rd.name AS facility_name, da.party_size,
             da.service_date, da.window_days, da.armed, da.last_fired_at,
             m.matched_date, m.matched_name
      FROM dining_alert da
      LEFT JOIN restaurant_dim rd ON rd.facility_id = da.facility_id
      ${latestMatch}
      WHERE da.user_id = ${ctx.userId} AND da.active = true
      ORDER BY da.last_fired_at DESC NULLS LAST, da.id DESC
    `);

    const alerts = result.rows.map((r) => {
      const serviceDate = r.service_date ? String(r.service_date).slice(0, 10) : null;
      const windowDays = r.window_days == null ? null : Number(r.window_days);
      return {
        id: Number(r.id),
        facilityId: r.facility_id,
        restaurantName: r.facility_id ? (r.facility_name ?? "a restaurant") : "Any restaurant",
        partySize: Number(r.party_size),
        serviceDate,
        windowDays,
        dateLabel: diningDateLabel(serviceDate, windowDays),
        armed: r.armed,
        lastFiredAt: r.last_fired_at,
        currentAvailable: r.matched_date != null,
        nextDate: r.matched_date ? String(r.matched_date).slice(0, 10) : null,
      };
    });
    return { alerts, limit: MAX_PER_USER };
  }),

  /** Create or re-arm a dining alert (reconfigure in place if it already exists). */
  create: protectedProcedure.input(createInput).mutation(async ({ ctx, input }) => {
    if (input.facilityId) {
      const ok = await db.execute<{ ok: boolean }>(sql`
        SELECT true AS ok FROM restaurant_dim
        WHERE facility_id = ${input.facilityId}
          AND priority = true AND active = true AND bookable = true
        LIMIT 1
      `);
      if (ok.rows.length === 0) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Unknown restaurant" });
      }
    }

    const serviceDate = input.serviceDate ?? null;
    const windowDays = input.windowDays ?? null;

    // Identity = (user, facility, party, date-axis). Equality with NULL-safe
    // operators so re-creating the same alert re-arms it rather than duplicating
    // (the partial unique index treats NULLs as distinct).
    const existing = await db.execute<{ id: string }>(sql`
      SELECT id FROM dining_alert
      WHERE user_id = ${ctx.userId} AND active = true
        AND facility_id = ${input.facilityId}
        AND party_size = ${input.partySize}
        AND service_date IS NOT DISTINCT FROM ${serviceDate}
        AND window_days IS NOT DISTINCT FROM ${windowDays}
      LIMIT 1
    `);
    if (existing.rows[0]) {
      await db.execute(sql`
        UPDATE dining_alert
        SET armed = true, last_fired_at = NULL, last_available = NULL
        WHERE id = ${Number(existing.rows[0].id)}
      `);
      return { ok: true };
    }

    const cap = await db.execute<{ used: number }>(sql`
      SELECT count(*) FILTER (WHERE active) AS used FROM dining_alert WHERE user_id = ${ctx.userId}
    `);
    if (Number(cap.rows[0]?.used ?? 0) >= MAX_PER_USER) {
      throw new TRPCError({
        code: "CONFLICT",
        message: `You can keep at most ${MAX_PER_USER} dining alerts. Remove one to add another.`,
      });
    }

    await db.insert(diningAlert).values({
      userId: ctx.userId,
      facilityId: input.facilityId,
      partySize: input.partySize,
      serviceDate,
      windowDays,
      armed: true,
      active: true,
    });
    return { ok: true };
  }),

  /** Soft-delete an alert. */
  remove: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      await db
        .update(diningAlert)
        .set({ active: false })
        .where(and(eq(diningAlert.id, input.id), eq(diningAlert.userId, ctx.userId)));
      return { ok: true };
    }),
} satisfies TRPCRouterRecord;
