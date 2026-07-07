import { TRPCError, type TRPCRouterRecord } from "@trpc/server";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "#/db/index.ts";
import { contentSuppression, removalRequest } from "#/db/schema.ts";
import { notifyAdminsOfRemovalRequest } from "#/server/notifications/removalMailer.ts";
import { adminProcedure, castMemberProcedure, isAdminEmail, publicProcedure } from "../init.ts";

/**
 * Feature keys that can be put into maintenance mode. Stored in
 * `content_suppression` as (entity_type="feature", entity_id=<key>, field="*"),
 * so a maintenance entry is just a whole-listing suppression scoped to a
 * feature. The client `MaintenanceGate` reads `features` and swaps the page for
 * a construction overlay when its key is present.
 */
export const MAINTENANCE_FEATURES = ["dining", "tickets", "stays", "predictions", "pins"] as const;
export type MaintenanceFeature = (typeof MAINTENANCE_FEATURES)[number];

const ENTITY_TYPES = ["park", "attraction", "restaurant", "shop", "resort"] as const;
const REASONS = ["inaccurate", "unauthorized_media", "confidential", "other"] as const;
// UI scope → what the request targets. "listing" maps to the "*" suppression
// field (whole listing); the others map to that field name directly.
const SCOPES = ["listing", "image", "menu"] as const;
const STATUSES = ["open", "acknowledged", "actioned", "declined"] as const;

const submitInput = z.object({
  entityType: z.enum(ENTITY_TYPES),
  entityId: z.string().min(1).max(128),
  scope: z.enum(SCOPES),
  reason: z.enum(REASONS),
  note: z.string().max(2000).optional(),
});

export const removalRouter = {
  /** A verified cast member files a removal / correction request. */
  submit: castMemberProcedure.input(submitInput).mutation(async ({ ctx, input }) => {
    const [row] = await db
      .insert(removalRequest)
      .values({
        requesterId: ctx.userId,
        orgTenantId: ctx.orgTenantId ?? null,
        entityType: input.entityType,
        entityId: input.entityId,
        targetField: input.scope,
        reason: input.reason,
        note: input.note?.trim() || null,
        status: "open",
      })
      .returning({ id: removalRequest.id });

    // Best-effort admin notification — a mail failure must not fail the submit.
    void notifyAdminsOfRemovalRequest({
      id: row!.id,
      entityType: input.entityType,
      entityId: input.entityId,
      scope: input.scope,
      reason: input.reason,
      note: input.note?.trim() || null,
      requesterEmail: ctx.userEmail ?? null,
    }).catch(() => {});

    return { ok: true, id: row!.id };
  }),

  /** The caller's own requests, so a page can show "you already reported this." */
  myRequests: castMemberProcedure.query(async ({ ctx }) => {
    return db
      .select({
        id: removalRequest.id,
        entityType: removalRequest.entityType,
        entityId: removalRequest.entityId,
        targetField: removalRequest.targetField,
        reason: removalRequest.reason,
        status: removalRequest.status,
        createdAt: removalRequest.createdAt,
      })
      .from(removalRequest)
      .where(eq(removalRequest.requesterId, ctx.userId))
      .orderBy(desc(removalRequest.createdAt));
  }),

  /** Admin triage queue, optionally filtered by status. */
  list: adminProcedure
    .input(z.object({ status: z.enum(STATUSES).optional() }).optional())
    .query(async ({ input }) => {
      return db
        .select()
        .from(removalRequest)
        .where(input?.status ? eq(removalRequest.status, input.status) : undefined)
        .orderBy(desc(removalRequest.createdAt))
        .limit(200);
    }),

  /**
   * Admin transitions a request and, when actioning it, optionally hides a field
   * via the reversible `content_suppression` overlay.
   */
  resolve: adminProcedure
    .input(
      z.object({
        id: z.number().int().positive(),
        status: z.enum(["acknowledged", "actioned", "declined"]),
        resolutionNote: z.string().max(2000).optional(),
        // Field to suppress when actioning: "*" = whole listing, else e.g. "image".
        suppressField: z.string().min(1).max(64).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [req] = await db
        .update(removalRequest)
        .set({
          status: input.status,
          resolvedById: ctx.userId,
          resolvedAt: new Date(),
          resolutionNote: input.resolutionNote?.trim() || null,
          updatedAt: new Date(),
        })
        .where(eq(removalRequest.id, input.id))
        .returning();
      if (!req) throw new TRPCError({ code: "NOT_FOUND" });

      if (input.status === "actioned" && input.suppressField) {
        await db
          .insert(contentSuppression)
          .values({
            entityType: req.entityType,
            entityId: req.entityId,
            field: input.suppressField,
            active: true,
            sourceRequestId: req.id,
          })
          .onConflictDoUpdate({
            target: [
              contentSuppression.entityType,
              contentSuppression.entityId,
              contentSuppression.field,
            ],
            set: { active: true, sourceRequestId: req.id, updatedAt: new Date() },
          });
      }
      return { ok: true };
    }),

  /**
   * Whether the current caller is an owner. Public (returns false for anyone
   * not on the allowlist) so the client `MaintenanceGate` can let admins
   * preview a page that's toggled into maintenance for everyone else.
   */
  isAdmin: publicProcedure.query(({ ctx }) => isAdminEmail(ctx.userEmail)),

  /** Feature keys currently in maintenance mode. Public — drives the overlay. */
  features: publicProcedure.query(async () => {
    const rows = await db
      .select({ feature: contentSuppression.entityId })
      .from(contentSuppression)
      .where(
        and(
          eq(contentSuppression.entityType, "feature"),
          eq(contentSuppression.field, "*"),
          eq(contentSuppression.active, true),
        ),
      );
    return rows.map((r) => r.feature);
  }),

  /** Admin: toggle a whole feature/page into or out of maintenance mode. */
  setFeatureMaintenance: adminProcedure
    .input(z.object({ feature: z.enum(MAINTENANCE_FEATURES), on: z.boolean() }))
    .mutation(async ({ input }) => {
      if (input.on) {
        await db
          .insert(contentSuppression)
          .values({ entityType: "feature", entityId: input.feature, field: "*", active: true })
          .onConflictDoUpdate({
            target: [
              contentSuppression.entityType,
              contentSuppression.entityId,
              contentSuppression.field,
            ],
            set: { active: true, updatedAt: new Date() },
          });
      } else {
        await db
          .update(contentSuppression)
          .set({ active: false, updatedAt: new Date() })
          .where(
            and(
              eq(contentSuppression.entityType, "feature"),
              eq(contentSuppression.entityId, input.feature),
              eq(contentSuppression.field, "*"),
            ),
          );
      }
      return { ok: true };
    }),

  /** Reverse a suppression — the hidden content reappears on the next read. */
  liftSuppression: adminProcedure
    .input(z.object({ entityType: z.string(), entityId: z.string(), field: z.string() }))
    .mutation(async ({ input }) => {
      await db
        .update(contentSuppression)
        .set({ active: false, updatedAt: new Date() })
        .where(
          and(
            eq(contentSuppression.entityType, input.entityType),
            eq(contentSuppression.entityId, input.entityId),
            eq(contentSuppression.field, input.field),
          ),
        );
      return { ok: true };
    }),
} satisfies TRPCRouterRecord;
