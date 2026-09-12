import { TRPCError } from "@trpc/server";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "#/db/index.ts";
import {
  attractions,
  parks,
  publicRecordWatch,
  resorts,
  restaurantDim,
  shopDim,
} from "#/db/schema.ts";
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
 *
 * Scope is resort × park × entity, narrowing cumulatively. An entity-scoped
 * watch (a ride, a restaurant, a shop) is what the "Watch filings" button on
 * those pages creates; it also pins the park/resort so the evaluator's cheap
 * scope checks run before the link lookup.
 */

/** Same ceiling as stay/dining alerts: three per user. */
const MAX_WATCHES = 3;
const MAX_KEYWORDS = 5;

/** Entity kinds a watch may scope to — the ones the linker emits links for. */
const WATCH_ENTITY_KINDS = ["attraction", "facility", "shop"] as const;
export type WatchEntityKind = (typeof WATCH_ENTITY_KINDS)[number];

/** The scoped entity's display name, per kind — for the manager list. */
const entityName = sql<string | null>`case ${publicRecordWatch.entityKind}
  when 'attraction' then (select a.name from ${attractions} a where a.id::text = ${publicRecordWatch.entityId})
  when 'facility' then (select r.name from ${restaurantDim} r where r.facility_id = ${publicRecordWatch.entityId})
  when 'shop' then (select s.name from ${shopDim} s where s.facility_id = ${publicRecordWatch.entityId})
  else null end`;

const watchColumns = {
  id: publicRecordWatch.id,
  resortSlug: publicRecordWatch.resortSlug,
  parkId: publicRecordWatch.parkId,
  parkName: parks.name,
  entityKind: publicRecordWatch.entityKind,
  entityId: publicRecordWatch.entityId,
  entityName,
  kinds: publicRecordWatch.kinds,
  keywords: publicRecordWatch.keywords,
  channel: publicRecordWatch.channel,
  active: publicRecordWatch.active,
  lastFiredAt: publicRecordWatch.lastFiredAt,
  createdAt: publicRecordWatch.createdAt,
};

/**
 * Resolve an entity to the park/resort it sits in, so the watch row carries
 * every scope level the evaluator checks. Throws when the entity is unknown —
 * a watch on nothing would never fire and the user would not know why.
 */
async function scopeForEntity(
  kind: WatchEntityKind,
  id: string,
): Promise<{ parkId: number | null; resortSlug: string | null }> {
  if (kind === "attraction") {
    const n = Number(id);
    if (!Number.isInteger(n)) throw new TRPCError({ code: "BAD_REQUEST" });
    const [row] = await db
      .select({ parkId: attractions.parkId, resortSlug: resorts.slug })
      .from(attractions)
      .innerJoin(parks, eq(parks.id, attractions.parkId))
      .leftJoin(resorts, eq(resorts.id, parks.resortId))
      .where(eq(attractions.id, n))
      .limit(1);
    if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Unknown attraction" });
    return { parkId: row.parkId, resortSlug: row.resortSlug };
  }
  const table = kind === "facility" ? restaurantDim : shopDim;
  const [row] = await db
    .select({ parkResortId: table.parkResortId })
    .from(table)
    .where(eq(table.facilityId, id))
    .limit(1);
  if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Unknown venue" });
  // Universal venues carry `uor.<park>`; Disney ones the finder park id (see
  // `loadVenues` in server/records/link.ts). Only the resort is pinned here —
  // park scope on a venue watch would exclude resort-level venues' records.
  const resortSlug = row.parkResortId?.startsWith("uor.")
    ? "universal-orlando"
    : row.parkResortId
      ? "walt-disney-world"
      : null;
  return { parkId: null, resortSlug };
}

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
        /** Ride / restaurant / shop scope; pins its park and resort too. */
        entity: z
          .object({ kind: z.enum(WATCH_ENTITY_KINDS), id: z.string().min(1).max(120) })
          .optional(),
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
      let parkId = input.parkId ?? null;
      let resortSlug = input.resortSlug ?? null;
      if (input.entity) {
        const scope = await scopeForEntity(input.entity.kind, input.entity.id);
        parkId ??= scope.parkId;
        resortSlug ??= scope.resortSlug;
        // One watch per entity per user — a second click means "already watching".
        const [existing] = await db
          .select({ id: publicRecordWatch.id })
          .from(publicRecordWatch)
          .where(
            and(
              eq(publicRecordWatch.userId, ctx.userId),
              eq(publicRecordWatch.entityKind, input.entity.kind),
              eq(publicRecordWatch.entityId, input.entity.id),
            ),
          )
          .limit(1);
        if (existing) return { id: existing.id, existed: true };
      }
      const keywords = [
        ...new Set(input.keywords.map((k) => k.trim()).filter((k) => k.length >= 2)),
      ];
      const [row] = await db
        .insert(publicRecordWatch)
        .values({
          userId: ctx.userId,
          resortSlug,
          parkId,
          entityKind: input.entity?.kind ?? null,
          entityId: input.entity?.id ?? null,
          kinds: input.kinds,
          keywords,
          channel: input.channel,
        })
        .returning({ id: publicRecordWatch.id });
      return { id: row!.id, existed: false };
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
