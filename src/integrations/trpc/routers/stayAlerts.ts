import { TRPCError, type TRPCRouterRecord } from "@trpc/server";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "#/db/index.ts";
import { stayAlert, stayQuery } from "#/db/schema.ts";
import { formatDateRange, resortDisplayName } from "#/server/notifications/stayFormat.ts";
import { buildPartyKey } from "#/server/stays/availability.ts";
import { RESORT_BY_ID } from "#/server/stays/resort-catalog.generated.ts";
import { protectedProcedure } from "../init.ts";

/** Max active stay alerts a user may keep, total (stays have no park axis). */
const MAX_PER_USER = 3;

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD");
const modeSchema = z.union([z.literal(1), z.literal(2)]);

// mode 2 (price_below) requires a target price; mode 1 (becomes_available) doesn't.
const needsPrice = (v: { mode: number; priceBelow?: number }) =>
  v.mode !== 2 || v.priceBelow != null;
const priceError = {
  message: "A target price is required for price-drop alerts",
  path: ["priceBelow"],
};

// The search dims that define which (dates, party) the alert watches — same
// shape the stays search sends, so "Alert me" can pass its current query through.
const queryDims = {
  checkInDate: isoDate,
  checkOutDate: isoDate,
  adults: z.number().int().min(1).max(10).default(2),
  children: z.number().int().min(0).max(10).default(0),
  childAges: z.array(z.number().int().min(0).max(17)).max(10).default([]),
  accessible: z.boolean().default(false),
  floridaResident: z.boolean().default(false),
  postalCode: z
    .string()
    .regex(/^\d{5}$/, "expected a 5-digit ZIP")
    .optional(),
};

const createInput = z
  .object({
    ...queryDims,
    // '' = any resort; otherwise a catalog facility id.
    resortId: z.string().default(""),
    mode: modeSchema,
    priceBelow: z.number().int().positive().max(100_000).optional(),
  })
  .refine(needsPrice, priceError);

const updateInput = z
  .object({
    id: z.number().int().positive(),
    mode: modeSchema,
    priceBelow: z.number().int().positive().max(100_000).optional(),
  })
  .refine(needsPrice, priceError);

// Latest observed availability/price for an alert's query, resort-scoped — the
// same lateral the evaluator uses, so list mirrors what would fire.
const latestObs = sql`
  LEFT JOIN LATERAL (
    SELECT bool_or(o.available) AS available,
           min(o.price_per_night) FILTER (WHERE o.available) AS price
    FROM stay_obs o
    WHERE o.check_in = sq.check_in
      AND o.check_out = sq.check_out
      AND o.party_key = sq.party_key
      AND (sa.resort_id = '' OR o.resort_id = sa.resort_id)
      AND o.observed_at = (
        SELECT max(o2.observed_at) FROM stay_obs o2
        WHERE o2.check_in = sq.check_in
          AND o2.check_out = sq.check_out
          AND o2.party_key = sq.party_key
      )
  ) latest ON true`;

export const stayAlertsRouter = {
  /** The current user's active stay alerts, with each one's current status. */
  list: protectedProcedure.query(async ({ ctx }) => {
    const result = await db.execute<{
      id: string;
      resort_id: string;
      mode: number;
      price_below: number | null;
      armed: boolean;
      last_fired_at: string | null;
      check_in: string;
      check_out: string;
      available: boolean | null;
      price: number | null;
    }>(sql`
      SELECT sa.id, sa.resort_id, sa.mode, sa.price_below, sa.armed, sa.last_fired_at,
             sq.check_in, sq.check_out, latest.available, latest.price
      FROM stay_alert sa
      JOIN stay_query sq ON sq.id = sa.query_id
      ${latestObs}
      WHERE sa.user_id = ${ctx.userId} AND sa.active = true
      ORDER BY sa.last_fired_at DESC NULLS LAST, sa.id DESC
    `);

    const alerts = result.rows.map((r) => ({
      id: Number(r.id),
      resortId: r.resort_id,
      resortName: r.resort_id ? resortDisplayName(r.resort_id) : "Any resort",
      mode: Number(r.mode),
      priceBelow: r.price_below,
      armed: r.armed,
      lastFiredAt: r.last_fired_at,
      checkInDate: r.check_in,
      checkOutDate: r.check_out,
      dateRange: formatDateRange(r.check_in, r.check_out),
      currentAvailable: r.available,
      currentPrice: r.price == null ? null : Number(r.price),
    }));
    return { alerts, limit: MAX_PER_USER };
  }),

  /** Create or reconfigure an alert (upsert; seeds/links a warm `stay_query`). */
  create: protectedProcedure.input(createInput).mutation(async ({ ctx, input }) => {
    if (input.resortId && !RESORT_BY_ID.has(input.resortId)) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Unknown resort" });
    }
    const partyKey = buildPartyKey(input);
    const childAges = [...input.childAges].sort((a, b) => a - b).join(",");

    // Seed/link the sweep frontier so the sweeper immediately covers it, and pin
    // it past demand age-out (alert_backed).
    const [q] = await db
      .insert(stayQuery)
      .values({
        checkIn: input.checkInDate,
        checkOut: input.checkOutDate,
        partyKey,
        adults: input.adults,
        children: input.children,
        childAges,
        accessible: input.accessible,
        floridaResident: input.floridaResident,
        postalCode: input.postalCode ?? null,
        alertBacked: true,
      })
      .onConflictDoUpdate({
        target: [stayQuery.checkIn, stayQuery.checkOut, stayQuery.partyKey],
        set: {
          alertBacked: true,
          adults: input.adults,
          children: input.children,
          childAges,
          accessible: input.accessible,
          floridaResident: input.floridaResident,
          postalCode: input.postalCode ?? null,
        },
      })
      .returning({ id: stayQuery.id });
    const queryId = q.id;

    // Cap = 3 active per user total, but allow reconfiguring one already set.
    const cap = await db.execute<{ used: number; this_one: number }>(sql`
      SELECT count(*) FILTER (WHERE active) AS used,
             count(*) FILTER (WHERE active AND resort_id = ${input.resortId} AND query_id = ${queryId}) AS this_one
      FROM stay_alert
      WHERE user_id = ${ctx.userId}
    `);
    const { used, this_one } = cap.rows[0] ?? { used: 0, this_one: 0 };
    if (Number(used) >= MAX_PER_USER && Number(this_one) === 0) {
      throw new TRPCError({
        code: "CONFLICT",
        message: `You can keep at most ${MAX_PER_USER} stay alerts. Remove one to add another.`,
      });
    }

    const priceBelow = input.mode === 2 ? (input.priceBelow ?? null) : null;
    await db
      .insert(stayAlert)
      .values({
        userId: ctx.userId,
        queryId,
        resortId: input.resortId,
        mode: input.mode,
        priceBelow,
        armed: true,
        active: true,
      })
      .onConflictDoUpdate({
        target: [stayAlert.userId, stayAlert.resortId, stayAlert.queryId],
        targetWhere: sql`active`,
        set: {
          mode: input.mode,
          priceBelow,
          armed: true,
          lastFiredAt: null,
          lastAvailable: null,
          lastPrice: null,
          active: true,
        },
      });

    return { ok: true };
  }),

  /** Edit an existing alert's rule and re-arm it. */
  update: protectedProcedure.input(updateInput).mutation(async ({ ctx, input }) => {
    const priceBelow = input.mode === 2 ? (input.priceBelow ?? null) : null;
    const res = await db
      .update(stayAlert)
      .set({ mode: input.mode, priceBelow, armed: true, lastFiredAt: null })
      .where(
        and(
          eq(stayAlert.id, input.id),
          eq(stayAlert.userId, ctx.userId),
          eq(stayAlert.active, true),
        ),
      );
    if ((res.rowCount ?? 0) === 0) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Alert not found" });
    }
    return { ok: true };
  }),

  /** Soft-delete an alert; un-pin its query if nothing else references it. */
  remove: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const [row] = await db
        .update(stayAlert)
        .set({ active: false })
        .where(and(eq(stayAlert.id, input.id), eq(stayAlert.userId, ctx.userId)))
        .returning({ queryId: stayAlert.queryId });
      if (row) {
        // Drop the alert pin so the query can age out once demand goes cold.
        await db.execute(sql`
          UPDATE stay_query SET alert_backed = false
          WHERE id = ${row.queryId}
            AND NOT EXISTS (
              SELECT 1 FROM stay_alert WHERE query_id = ${row.queryId} AND active = true
            )
        `);
      }
      return { ok: true };
    }),
} satisfies TRPCRouterRecord;
