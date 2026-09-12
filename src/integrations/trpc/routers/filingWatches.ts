import { TRPCError } from "@trpc/server";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "#/db/index.ts";
import { parks, publicRecordWatch } from "#/db/schema.ts";
import { RECORD_KINDS } from "#/lib/records.ts";
import { protectedProcedure } from "../init.ts";

import type { TRPCRouterRecord } from "@trpc/server";

/**
 * Filing watches — the per-user half of the public-records feature
 * (docs/plans/public-records-intelligence.md §6.3). Kept OUT of `records.*`
 * because that router is entirely public and edge-cacheable (`lib/cache.ts`);
 * nothing here may ever be cached at the edge.
 *
 * The watch itself is only a subscription row. Delivery happens in the
 * public-records cron (`server/notifications/filingAlerts.ts`), which
 * edge-triggers per (watch, record) — so creating a watch never replays the
 * back catalog, it only starts the clock.
 */

/** Same ceiling as stay/dining alerts: three per user. */
const MAX_WATCHES = 3;
const MAX_KEYWORDS = 5;

const watchColumns = {
  id: publicRecordWatch.id,
  resortSlug: publicRecordWatch.resortSlug,
  parkId: publicRecordWatch.parkId,
  parkName: parks.name,
  entityKind: publicRecordWatch.entityKind,
  entityId: publicRecordWatch.entityId,
  kinds: publicRecordWatch.kinds,
  keywords: publicRecordWatch.keywords,
  channel: publicRecordWatch.channel,
  active: publicRecordWatch.active,
  lastFiredAt: publicRecordWatch.lastFiredAt,
  createdAt: publicRecordWatch.createdAt,
};

export const filingWatchesRouter = {
  list: protectedProcedure.query(async ({ ctx }) => {
    return db
      .select(watchColumns)
      .from(publicRecordWatch)
      .leftJoin(parks, eq(parks.id, publicRecordWatch.parkId))
      .where(eq(publicRecordWatch.userId, ctx.userId))
      .orderBy(publicRecordWatch.createdAt);
  }),

  create: protectedProcedure
    .input(
      z.object({
        resortSlug: z.string().min(1).max(64).optional(),
        parkId: z.number().int().positive().optional(),
        kinds: z.array(z.enum(RECORD_KINDS)).max(RECORD_KINDS.length).default([]),
        // Trimmed, de-duplicated below; a blank keyword would match everything.
        keywords: z.array(z.string().min(2).max(60)).max(MAX_KEYWORDS).default([]),
        channel: z.enum(["push", "email", "both"]).default("push"),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [{ n }] = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(publicRecordWatch)
        .where(eq(publicRecordWatch.userId, ctx.userId));
      if (n >= MAX_WATCHES) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `You can have up to ${MAX_WATCHES} filing watches. Delete one first.`,
        });
      }
      const keywords = [
        ...new Set(input.keywords.map((k) => k.trim()).filter((k) => k.length >= 2)),
      ];
      const [row] = await db
        .insert(publicRecordWatch)
        .values({
          userId: ctx.userId,
          resortSlug: input.resortSlug ?? null,
          parkId: input.parkId ?? null,
          kinds: input.kinds,
          keywords,
          channel: input.channel,
        })
        .returning({ id: publicRecordWatch.id });
      return { id: row!.id };
    }),

  setActive: protectedProcedure
    .input(z.object({ id: z.number().int().positive(), active: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const res = await db
        .update(publicRecordWatch)
        .set({ active: input.active })
        .where(and(eq(publicRecordWatch.id, input.id), eq(publicRecordWatch.userId, ctx.userId)))
        .returning({ id: publicRecordWatch.id });
      if (res.length === 0) throw new TRPCError({ code: "NOT_FOUND" });
      return { ok: true };
    }),

  remove: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const res = await db
        .delete(publicRecordWatch)
        .where(and(eq(publicRecordWatch.id, input.id), eq(publicRecordWatch.userId, ctx.userId)))
        .returning({ id: publicRecordWatch.id });
      if (res.length === 0) throw new TRPCError({ code: "NOT_FOUND" });
      return { ok: true };
    }),
} satisfies TRPCRouterRecord;
