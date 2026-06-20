/**
 * Living Layer — public tRPC router (M3).
 *
 * The real (non-dev) API surface: read the realms + active marks for a park
 * (so the play map can render the Dimming spawns the worker already produces),
 * and the user-defined discovery-pin loop (create + react), gated by login and
 * a lightweight in-park presence check.
 *
 * SAFETY: additive. No existing router/page calls these procedures, and the UI
 * that does is itself behind the PostHog `living-layer` flag. Reads/writes only
 * the new Living Layer tables (+ existing parks/attractions for context).
 */
import { TRPCError, type TRPCRouterRecord } from "@trpc/server";
import { sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "#/db/index.ts";
import { MarkReactionKind, MarkState, MarkType } from "#/server/living/codes.ts";
import { pointInPolygon, type LngLat } from "#/server/living/geofence.ts";

import { protectedProcedure, publicProcedure } from "../init.ts";

import type { GeoPolygon, LiveStateSnapshot } from "#/db/schema.ts";

/** Max discovery marks a user may create per rolling window (anti-spam). */
const MAX_DISCOVERY_PER_HOUR = 20;
/** Auto-hide a mark once this many distinct users report it. */
const REPORT_HIDE_THRESHOLD = 3;

async function parkBySlug(slug: string): Promise<{
  id: number;
  boundary: GeoPolygon | null;
} | null> {
  const r = await db.execute<{ id: number; boundary: GeoPolygon | null }>(
    sql`SELECT id, boundary FROM parks WHERE slug = ${slug} AND active = true LIMIT 1`,
  );
  const row = r.rows[0];
  return row ? { id: Number(row.id), boundary: row.boundary } : null;
}

export const livingRouter = {
  /** Realm catalog + boundaries for a park (for the map overlay). */
  realms: publicProcedure.input(z.object({ parkSlug: z.string() })).query(async ({ input }) => {
    const r = await db.execute<{
      id: number;
      name: string;
      slug: string;
      boundary: GeoPolygon | null;
      theme_color: string | null;
    }>(sql`
        SELECT rl.id, rl.name, rl.slug, rl.boundary, rl.theme_color
        FROM realm rl
        JOIN parks p ON p.id = rl.park_id
        WHERE p.slug = ${input.parkSlug}
        ORDER BY rl.name
      `);
    return r.rows.map((x) => ({
      id: Number(x.id),
      name: x.name,
      slug: x.slug,
      boundary: x.boundary,
      themeColor: x.theme_color,
    }));
  }),

  /** Active marks in a park — the Dimming spawns + user discovery pins. */
  marks: publicProcedure
    .input(
      z.object({
        parkSlug: z.string(),
        types: z.array(z.string()).optional(),
      }),
    )
    .query(async ({ input }) => {
      const typeFilter = input.types?.length
        ? sql`AND m.type = ANY(${sql`ARRAY[${sql.join(
            input.types.map((t) => sql`${t}`),
            sql`, `,
          )}]::text[]`})`
        : sql``;
      const r = await db.execute<{
        id: number;
        type: string;
        is_system: boolean;
        attraction_id: number | null;
        attraction_name: string | null;
        latitude: number | null;
        longitude: number | null;
        payload: Record<string, unknown>;
        live_state_snapshot: LiveStateSnapshot | null;
        find_count: number;
        upvote_count: number;
        created_at: string;
      }>(sql`
        SELECT m.id, m.type, m.is_system, m.attraction_id, a.name AS attraction_name,
               m.latitude, m.longitude, m.payload, m.live_state_snapshot,
               m.find_count, m.upvote_count, m.created_at
        FROM mark m
        JOIN parks p ON p.id = m.park_id
        LEFT JOIN attractions a ON a.id = m.attraction_id
        WHERE p.slug = ${input.parkSlug}
          AND m.state = ${MarkState.ACTIVE}
          ${typeFilter}
        ORDER BY m.created_at DESC
        LIMIT 500
      `);
      return r.rows.map((x) => ({
        id: Number(x.id),
        type: x.type,
        isSystem: x.is_system,
        attractionId: x.attraction_id != null ? Number(x.attraction_id) : null,
        attractionName: x.attraction_name,
        latitude: x.latitude,
        longitude: x.longitude,
        payload: x.payload,
        liveState: x.live_state_snapshot,
        findCount: Number(x.find_count),
        upvoteCount: Number(x.upvote_count),
        createdAt: x.created_at,
      }));
    }),

  /**
   * Drop a user-defined discovery pin. Gated by login + a lightweight in-park
   * presence check (the point must fall inside the park boundary). Full sensor-
   * fusion presence verification is M5; this is the M3 floor that still blocks
   * dropping pins in places you clearly aren't.
   */
  leaveMark: protectedProcedure
    .input(
      z.object({
        parkSlug: z.string(),
        lat: z.number().min(-90).max(90),
        lng: z.number().min(-180).max(180),
        note: z.string().trim().min(1).max(280),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const park = await parkBySlug(input.parkSlug);
      if (!park) throw new TRPCError({ code: "NOT_FOUND", message: "Unknown park" });

      // Presence floor: must be within the park boundary (when we have one).
      const point: LngLat = [input.lng, input.lat];
      if (park.boundary && !pointInPolygon(point, park.boundary)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "You must be inside the park to leave a mark here.",
        });
      }

      // Rate limit: cap discovery marks per user per hour.
      const recent = await db.execute<{ n: number }>(sql`
        SELECT count(*)::int AS n FROM mark
        WHERE author_user_id = ${ctx.userId}
          AND type = ${MarkType.DISCOVERY}
          AND created_at > now() - interval '1 hour'
      `);
      if (Number(recent.rows[0]?.n ?? 0) >= MAX_DISCOVERY_PER_HOUR) {
        throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "Slow down a moment." });
      }

      const inserted = await db.execute<{ id: number }>(sql`
        INSERT INTO mark (type, author_user_id, is_system, park_id, latitude, longitude, payload, state)
        VALUES (${MarkType.DISCOVERY}, ${ctx.userId}, false, ${park.id}, ${input.lat}, ${input.lng},
                ${JSON.stringify({ note: input.note })}::jsonb, ${MarkState.ACTIVE})
        RETURNING id
      `);
      return { id: Number(inserted.rows[0].id) };
    }),

  /** React to a mark — found / upvote / report (dedup per user+kind). */
  reactMark: protectedProcedure
    .input(
      z.object({
        markId: z.number().int().positive(),
        kind: z.enum([MarkReactionKind.FOUND, MarkReactionKind.UPVOTE, MarkReactionKind.REPORT]),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Idempotent per (mark, user, kind): a second identical reaction is a no-op.
      const ins = await db.execute(sql`
        INSERT INTO mark_reaction (mark_id, user_id, kind)
        VALUES (${input.markId}, ${ctx.userId}, ${input.kind})
        ON CONFLICT (mark_id, user_id, kind) DO NOTHING
      `);
      if ((ins.rowCount ?? 0) === 0) return { ok: true, counted: false };

      // Maintain the denormalized counters + auto-hide heavily-reported marks.
      if (input.kind === MarkReactionKind.REPORT) {
        await db.execute(sql`
          UPDATE mark SET report_count = report_count + 1 WHERE id = ${input.markId}
        `);
        await db.execute(sql`
          UPDATE mark SET state = ${MarkState.FADED}
          WHERE id = ${input.markId}
            AND is_system = false
            AND report_count >= ${REPORT_HIDE_THRESHOLD}
        `);
      } else {
        const col = input.kind === MarkReactionKind.FOUND ? sql`find_count` : sql`upvote_count`;
        await db.execute(sql`
          UPDATE mark SET ${col} = ${col} + 1 WHERE id = ${input.markId}
        `);
      }
      return { ok: true, counted: true };
    }),
} satisfies TRPCRouterRecord;
