import { type TRPCRouterRecord } from "@trpc/server";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "#/db/index.ts";
import { pinHave, pinWant } from "#/db/schema.ts";
import { pinPublicUrl } from "#/server/pins/storage.ts";
import { protectedProcedure } from "../init.ts";

/**
 * The signed-in user's collection: `have` (owned, optionally `for_trade`) and
 * `want` lists. Both are simple upsert-on-(user,pin) CRUD; `toggleForTrade` is
 * the one switch that feeds a pin into the trading board's match query.
 */

const conditionSchema = z.enum(["mint", "near_mint", "good", "worn"]);

/** Join a collection table to its pin card for display. */
const listSql = (table: "pin_have" | "pin_want", userId: string) => sql`
  SELECT t.id, t.pin_id, t.created_at,
         ${table === "pin_have" ? sql`t.quantity, t.condition, t.for_trade,` : sql`t.max_value_cents,`}
         p.name, p.series, p.year, p.edition_type, p.est_value_cents,
         (SELECT r2_key FROM pin_image i WHERE i.pin_id = p.id
          ORDER BY i.is_primary DESC, i.created_at LIMIT 1) AS r2_key
  FROM ${sql.raw(table)} t
  JOIN pin p ON p.id = t.pin_id
  WHERE t.user_id = ${userId}
  ORDER BY p.name
`;

export const pinCollectionRouter = {
  /** Both lists for the current user. */
  list: protectedProcedure.query(async ({ ctx }) => {
    const [have, want] = await Promise.all([
      db.execute<{
        id: string;
        pin_id: string;
        quantity: number;
        condition: string | null;
        for_trade: boolean;
        name: string;
        series: string | null;
        year: number | null;
        edition_type: string | null;
        est_value_cents: number | null;
        r2_key: string | null;
      }>(listSql("pin_have", ctx.userId)),
      db.execute<{
        id: string;
        pin_id: string;
        max_value_cents: number | null;
        name: string;
        series: string | null;
        year: number | null;
        edition_type: string | null;
        est_value_cents: number | null;
        r2_key: string | null;
      }>(listSql("pin_want", ctx.userId)),
    ]);

    return {
      have: have.rows.map((r) => ({
        id: r.id,
        pinId: r.pin_id,
        quantity: r.quantity,
        condition: r.condition,
        forTrade: r.for_trade,
        name: r.name,
        series: r.series,
        year: r.year,
        editionType: r.edition_type,
        estValueCents: r.est_value_cents,
        imageUrl: r.r2_key ? pinPublicUrl(r.r2_key) : null,
      })),
      want: want.rows.map((r) => ({
        id: r.id,
        pinId: r.pin_id,
        maxValueCents: r.max_value_cents,
        name: r.name,
        series: r.series,
        year: r.year,
        editionType: r.edition_type,
        estValueCents: r.est_value_cents,
        imageUrl: r.r2_key ? pinPublicUrl(r.r2_key) : null,
      })),
    };
  }),

  /** Add or update a pin in the HAVE list (upsert on user+pin). */
  addHave: protectedProcedure
    .input(
      z.object({
        pinId: z.string().uuid(),
        quantity: z.number().int().min(1).max(999).default(1),
        condition: conditionSchema.optional(),
        forTrade: z.boolean().default(false),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await db
        .insert(pinHave)
        .values({
          userId: ctx.userId,
          pinId: input.pinId,
          quantity: input.quantity,
          condition: input.condition ?? null,
          forTrade: input.forTrade,
        })
        .onConflictDoUpdate({
          target: [pinHave.userId, pinHave.pinId],
          set: {
            quantity: input.quantity,
            condition: input.condition ?? null,
            forTrade: input.forTrade,
          },
        });
      return { ok: true };
    }),

  /** Add a pin to the WANT list (upsert on user+pin). */
  addWant: protectedProcedure
    .input(
      z.object({
        pinId: z.string().uuid(),
        maxValueCents: z.number().int().nonnegative().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await db
        .insert(pinWant)
        .values({
          userId: ctx.userId,
          pinId: input.pinId,
          maxValueCents: input.maxValueCents ?? null,
        })
        .onConflictDoUpdate({
          target: [pinWant.userId, pinWant.pinId],
          set: { maxValueCents: input.maxValueCents ?? null },
        });
      return { ok: true };
    }),

  /** Flip the for-trade flag on a HAVE row (drives the match query). */
  toggleForTrade: protectedProcedure
    .input(z.object({ pinId: z.string().uuid(), forTrade: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      await db
        .update(pinHave)
        .set({ forTrade: input.forTrade })
        .where(and(eq(pinHave.userId, ctx.userId), eq(pinHave.pinId, input.pinId)));
      return { ok: true };
    }),

  /** Remove a pin from a list. */
  remove: protectedProcedure
    .input(z.object({ pinId: z.string().uuid(), list: z.enum(["have", "want"]) }))
    .mutation(async ({ ctx, input }) => {
      const table = input.list === "have" ? pinHave : pinWant;
      await db.delete(table).where(and(eq(table.userId, ctx.userId), eq(table.pinId, input.pinId)));
      return { ok: true };
    }),
} satisfies TRPCRouterRecord;
