import { randomUUID } from "node:crypto";

import { TRPCError, type TRPCRouterRecord } from "@trpc/server";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "#/db/index.ts";
import { pinImage, pinScan } from "#/db/schema.ts";
import { getPinEmbedQueue, getPinScanQueue } from "#/server/notifications/queue.ts";
import {
  dataUriToBuffer,
  pinPublicUrl,
  putReferenceImage,
  putScanPhoto,
} from "#/server/pins/storage.ts";
import { protectedProcedure, publicProcedure } from "../init.ts";

/** Per-user scan cap (anti-abuse; cascade has a real per-call cost at the tail). */
const MAX_SCANS_PER_HOUR = Number(process.env.PIN_MAX_SCANS_PER_HOUR ?? 60);

type CandidateRow = {
  pin_id: string;
  name: string;
  series: string | null;
  year: number | null;
  edition_type: string | null;
  est_value_cents: number | null;
  r2_key: string | null;
};

export const pinIdentifyRouter = {
  /**
   * Upload a scan photo, create the `pin_scan` row, and enqueue the cascade.
   * Returns the scan id immediately; the client polls `result`. Photo is stored
   * before the row so a queued job always has its image.
   */
  scan: publicProcedure
    .input(z.object({ dataUri: z.string().startsWith("data:image/") }))
    .mutation(async ({ input, ctx }) => {
      if (ctx.userId) {
        const { rows } = await db.execute<{ n: number }>(sql`
          SELECT count(*) AS n FROM pin_scan
          WHERE user_id = ${ctx.userId} AND created_at >= now() - INTERVAL '1 hour'
        `);
        if (Number(rows[0]?.n ?? 0) >= MAX_SCANS_PER_HOUR) {
          throw new TRPCError({
            code: "TOO_MANY_REQUESTS",
            message: "You've hit the scan limit for now — try again in a bit.",
          });
        }
      }

      const scanId = randomUUID();
      const raw = dataUriToBuffer(input.dataUri);
      const r2Key = await putScanPhoto(scanId, raw);

      await db.insert(pinScan).values({
        id: scanId,
        userId: ctx.userId ?? null,
        photoR2Key: r2Key,
        status: "queued",
      });

      await getPinScanQueue().add("scan", { scanId });
      return { scanId, photoUrl: pinPublicUrl(r2Key) };
    }),

  /**
   * Poll a scan's result. Hydrates the stored candidate ids into pin cards in
   * the cascade's ranked order. Unguessable uuid id gates access.
   */
  result: publicProcedure
    .input(z.object({ scanId: z.string().uuid() }))
    .query(async ({ input }) => {
      const scan = await db
        .select()
        .from(pinScan)
        .where(eq(pinScan.id, input.scanId))
        .limit(1)
        .then((r) => r[0]);
      if (!scan) throw new TRPCError({ code: "NOT_FOUND", message: "Scan not found" });

      const candidates = (scan.candidates ?? []) as Array<{
        pinId: string;
        score: number;
        stage: number;
      }>;

      let cards: Array<{
        pinId: string;
        score: number;
        stage: number;
        name: string;
        series: string | null;
        year: number | null;
        editionType: string | null;
        estValueCents: number | null;
        imageUrl: string | null;
      }> = [];

      if (candidates.length > 0) {
        const ids = candidates.map((c) => c.pinId);
        const { rows } = await db.execute<CandidateRow>(sql`
          SELECT p.id AS pin_id, p.name, p.series, p.year, p.edition_type, p.est_value_cents,
                 (SELECT r2_key FROM pin_image i WHERE i.pin_id = p.id
                  ORDER BY i.is_primary DESC, i.created_at LIMIT 1) AS r2_key
          FROM pin p
          WHERE p.id = ANY(${sql`ARRAY[${sql.join(
            ids.map((id) => sql`${id}::uuid`),
            sql`, `,
          )}]`})
        `);
        const byId = new Map(rows.map((r) => [r.pin_id, r]));
        cards = candidates.flatMap((c) => {
          const r = byId.get(c.pinId);
          if (!r) return [];
          return [
            {
              pinId: c.pinId,
              score: c.score,
              stage: c.stage,
              name: r.name,
              series: r.series,
              year: r.year,
              editionType: r.edition_type,
              estValueCents: r.est_value_cents,
              imageUrl: r.r2_key ? pinPublicUrl(r.r2_key) : null,
            },
          ];
        });
      }

      return {
        status: scan.status,
        photoUrl: pinPublicUrl(scan.photoR2Key),
        candidates: cards,
        topConfidence: scan.topConfidence,
        stageResolved: scan.stageResolved,
        chosenPinId: scan.chosenPinId,
        error: scan.error,
      };
    }),

  /**
   * Stage 4 — the user confirms (or rejects) the pick. Records the label, and on
   * a positive confirm promotes the scan photo into the reference set (a new
   * community `pin_image` + an embed job) so every confirmation compounds the
   * dataset. This is the flywheel.
   */
  confirm: protectedProcedure
    .input(
      z.object({
        scanId: z.string().uuid(),
        // null = "none of these / not listed" — still a useful negative label.
        chosenPinId: z.string().uuid().nullable(),
        // Whether to contribute the photo to the reference set (default yes).
        contribute: z.boolean().default(true),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const scan = await db
        .select()
        .from(pinScan)
        .where(and(eq(pinScan.id, input.scanId)))
        .limit(1)
        .then((r) => r[0]);
      if (!scan) throw new TRPCError({ code: "NOT_FOUND", message: "Scan not found" });
      // Only the scan's owner may confirm it (anonymous scans can't be claimed).
      if (scan.userId && scan.userId !== ctx.userId) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }

      const chosen = (scan.candidates as Array<{ pinId: string; stage: number }>).find(
        (c) => c.pinId === input.chosenPinId,
      );

      await db
        .update(pinScan)
        .set({
          chosenPinId: input.chosenPinId,
          stageResolved: input.chosenPinId ? (chosen?.stage ?? scan.stageResolved) : 4,
          resolvedAt: new Date(),
          // Claim an anonymous scan for the confirming user.
          userId: scan.userId ?? ctx.userId,
        })
        .where(eq(pinScan.id, input.scanId));

      // Flywheel: promote the confirmed photo into the reference set.
      if (input.chosenPinId && input.contribute) {
        const imageId = randomUUID();
        // Copy the scan photo to a stable reference key (already a webp in R2).
        try {
          const res = await fetch(pinPublicUrl(scan.photoR2Key), {
            signal: AbortSignal.timeout(15_000),
          });
          if (res.ok) {
            const buf = Buffer.from(await res.arrayBuffer());
            const r2Key = await putReferenceImage(imageId, buf);
            await db.insert(pinImage).values({
              id: imageId,
              pinId: input.chosenPinId,
              r2Key,
              isPrimary: false,
              source: "community",
            });
            await getPinEmbedQueue().add("embed", { pinImageId: imageId });
          }
        } catch (err) {
          // A failed contribution must not fail the confirm — the label is saved.
          console.error("[pinIdentify] contribute failed:", (err as Error)?.message ?? err);
        }
      }

      return { ok: true };
    }),
} satisfies TRPCRouterRecord;
