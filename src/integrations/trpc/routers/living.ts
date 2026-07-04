/**
 * Living Layer — public tRPC router (M3).
 *
 * The real (non-dev) API surface: read the worlds + active marks for a park
 * (so the play map can render the Darkness spawns the worker already produces),
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
import { heartlessSpec } from "#/server/living/battle.ts";
import { HeartlessType, MarkReactionKind, MarkState, MarkType } from "#/server/living/codes.ts";
import { pointInPolygon, type LngLat } from "#/server/living/geofence.ts";

import { protectedProcedure, publicProcedure } from "../init.ts";

import type { HeartlessTypeCode } from "#/server/living/codes.ts";
import type { GeoPolygon, LiveStateSnapshot } from "#/db/schema.ts";

/** An active system encounter mark, loaded for battle start/resolve. */
type EncounterMarkRow = {
  id: number;
  park_id: number;
  attraction_id: number | null;
  payload: { heartlessType?: string; rarity?: number } | null;
  live_state_snapshot: LiveStateSnapshot | null;
};

async function activeEncounterMark(markId: number): Promise<EncounterMarkRow | null> {
  const r = await db.execute<EncounterMarkRow>(sql`
    SELECT id, park_id, attraction_id, payload, live_state_snapshot
    FROM mark
    WHERE id = ${markId}
      AND type = ${MarkType.ENCOUNTER}
      AND is_system = true
      AND state = ${MarkState.ACTIVE}
    LIMIT 1
  `);
  return r.rows[0] ?? null;
}

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
  /** World catalog + boundaries for a park (for the map overlay). */
  worlds: publicProcedure.input(z.object({ parkSlug: z.string() })).query(async ({ input }) => {
    const r = await db.execute<{
      id: number;
      name: string;
      slug: string;
      boundary: GeoPolygon | null;
      theme_color: string | null;
    }>(sql`
        SELECT rl.id, rl.name, rl.slug, rl.boundary, rl.theme_color
        FROM world rl
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

  /** Active marks in a park — the Darkness spawns + user discovery pins. */
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

  /**
   * Begin a battle against a Darkness spawn. Returns the deterministic Heartless spec
   * the client plays out. Server-derived from the mark's payload so the client
   * can't pick an easier enemy.
   */
  startEncounter: protectedProcedure
    .input(z.object({ markId: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      const mk = await activeEncounterMark(input.markId);
      if (!mk) throw new TRPCError({ code: "NOT_FOUND", message: "That Darkness has cleared." });
      const heartlessType = (mk.payload?.heartlessType as HeartlessTypeCode) ?? HeartlessType.SHADE;
      const rarity = Number(mk.payload?.rarity ?? 1);
      return { markId: mk.id, ...heartlessSpec(heartlessType, rarity) };
    }),

  /**
   * Record a battle outcome. On a win the spawn is sealed (`claimed`) so it
   * leaves the map. Server-authoritative over mark state; full anti-cheat
   * (verifying the fight was real) is M5.
   */
  resolveEncounter: protectedProcedure
    .input(
      z.object({
        markId: z.number().int().positive(),
        outcome: z.enum(["win", "loss", "flee"]),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const mk = await activeEncounterMark(input.markId);
      if (!mk) return { ok: true, alreadyResolved: true };

      const heartlessType = (mk.payload?.heartlessType as HeartlessTypeCode) ?? HeartlessType.SHADE;
      await db.execute(sql`
        INSERT INTO encounter_log (user_id, mark_id, park_id, attraction_id, heartless_type, outcome, live_state_snapshot)
        VALUES (${ctx.userId}, ${mk.id}, ${mk.park_id}, ${mk.attraction_id}, ${heartlessType},
                ${input.outcome}, ${JSON.stringify(mk.live_state_snapshot)}::jsonb)
      `);

      if (input.outcome === "win") {
        await db.execute(sql`
          UPDATE mark SET state = ${MarkState.CLAIMED}
          WHERE id = ${mk.id} AND state = ${MarkState.ACTIVE}
        `);
        // Award the Wielder XP for the seal (creates the profile on first win).
        await grantWielderXp(ctx.userId, 10);
      }
      return { ok: true, outcome: input.outcome };
    }),

  /** The Wielder's profile — rank, xp, and recruited roster (M5). */
  profile: protectedProcedure.query(async ({ ctx }) => {
    await db.execute(
      sql`INSERT INTO wielder (user_id) VALUES (${ctx.userId}) ON CONFLICT (user_id) DO NOTHING`,
    );
    const w = await db.execute<{ rank: number; xp: number; display_name: string | null }>(
      sql`SELECT rank, xp, display_name FROM wielder WHERE user_id = ${ctx.userId}`,
    );
    const roster = await db.execute<{
      id: number;
      name: string;
      slug: string;
      element: string | null;
      level: number;
      world_name: string | null;
    }>(sql`
      SELECT c.id, c.name, c.slug, c.element, wc.level, r.name AS world_name
      FROM wielder_companion wc
      JOIN companion c ON c.id = wc.companion_id
      LEFT JOIN world r ON r.id = c.home_world_id
      WHERE wc.user_id = ${ctx.userId}
      ORDER BY wc.recruited_at
    `);
    const row = w.rows[0];
    return {
      rank: Number(row?.rank ?? 1),
      xp: Number(row?.xp ?? 0),
      displayName: row?.display_name ?? null,
      roster: roster.rows.map((c) => ({
        id: Number(c.id),
        name: c.name,
        slug: c.slug,
        element: c.element,
        level: Number(c.level),
        worldName: c.world_name,
      })),
    };
  }),

  /** Companion catalog for a park, with recruited/recruitable status (M5). */
  companions: protectedProcedure
    .input(z.object({ parkSlug: z.string() }))
    .query(async ({ ctx, input }) => {
      const r = await db.execute<{
        id: number;
        name: string;
        slug: string;
        element: string | null;
        role: string | null;
        world_name: string | null;
        signature_name: string | null;
        recruited: boolean;
        recruitable: boolean;
      }>(sql`
        SELECT c.id, c.name, c.slug, c.element, c.role,
               r.name AS world_name, sa.name AS signature_name,
               (wc.user_id IS NOT NULL) AS recruited,
               EXISTS(
                 SELECT 1 FROM encounter_log el
                 WHERE el.user_id = ${ctx.userId} AND el.outcome = 'win'
                   AND el.attraction_id = c.signature_attraction_id
               ) AS recruitable
        FROM companion c
        JOIN world r ON r.id = c.home_world_id
        JOIN parks p ON p.id = r.park_id
        LEFT JOIN attractions sa ON sa.id = c.signature_attraction_id
        LEFT JOIN wielder_companion wc ON wc.companion_id = c.id AND wc.user_id = ${ctx.userId}
        WHERE p.slug = ${input.parkSlug}
        ORDER BY r.name, c.name
      `);
      return r.rows.map((c) => ({
        id: Number(c.id),
        name: c.name,
        slug: c.slug,
        element: c.element,
        role: c.role,
        worldName: c.world_name,
        signatureName: c.signature_name,
        recruited: c.recruited,
        recruitable: c.recruitable,
      }));
    }),

  /**
   * Recruit a companion. Requires having defeated the Darkness at its signature
   * ride (a real win in `encounter_log`) — the collection hook tied to the
   * battle loop. Presence-gating of that win is hardened later (M5b).
   */
  recruit: protectedProcedure
    .input(z.object({ companionId: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const ok = await db.execute<{ ok: boolean }>(sql`
        SELECT EXISTS(
          SELECT 1 FROM encounter_log el
          JOIN companion c ON c.id = ${input.companionId}
          WHERE el.user_id = ${ctx.userId} AND el.outcome = 'win'
            AND el.attraction_id = c.signature_attraction_id
        ) AS ok
      `);
      if (!ok.rows[0]?.ok) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Defeat the Darkness at this companion's signature ride first.",
        });
      }
      await db.execute(sql`
        INSERT INTO wielder_companion (user_id, companion_id)
        VALUES (${ctx.userId}, ${input.companionId})
        ON CONFLICT (user_id, companion_id) DO NOTHING
      `);
      await grantWielderXp(ctx.userId, 50);
      return { ok: true };
    }),
} satisfies TRPCRouterRecord;

/** Upsert the Wielder profile and add XP, recomputing rank (100 xp / rank). */
async function grantWielderXp(userId: string, gain: number): Promise<void> {
  await db.execute(sql`
    INSERT INTO wielder (user_id, xp, rank) VALUES (${userId}, ${gain}, 1)
    ON CONFLICT (user_id) DO UPDATE
      SET xp = wielder.xp + ${gain},
          rank = floor((wielder.xp + ${gain}) / 100) + 1
  `);
}
