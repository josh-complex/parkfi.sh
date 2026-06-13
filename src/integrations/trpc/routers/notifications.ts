import { eq } from "drizzle-orm";
import { z } from "zod";
import { createTRPCRouter, protectedProcedure, publicProcedure } from "../init";
import { db } from "#/db/index.ts";
import { alertOptout } from "#/db/schema.ts";
import { addSub, removeSub } from "#/server/notifications/subscriptions.ts";
import { getPushQueue } from "#/server/notifications/queue.ts";

const pushSubSchema = z.object({
  endpoint: z.string().url(),
  p256dh: z.string(),
  auth: z.string(),
});

export const notificationsRouter = createTRPCRouter({
  subscribe: publicProcedure.input(pushSubSchema).mutation(async ({ input, ctx }) => {
    const userId = ctx.userId ?? "anonymous";
    try {
      await addSub(userId, input);
      console.log(
        `[notifications.subscribe] userId=${userId} endpoint=${input.endpoint.slice(0, 40)}…`,
      );
    } catch (err) {
      console.error("[notifications.subscribe]", err);
      throw err;
    }
    return { ok: true };
  }),

  unsubscribe: publicProcedure
    .input(z.object({ endpoint: z.string().url() }))
    .mutation(async ({ input, ctx }) => {
      const userId = ctx.userId ?? "anonymous";
      await removeSub(userId, input.endpoint);
      return { ok: true };
    }),

  sendTest: publicProcedure.mutation(async ({ ctx }) => {
    if (process.env.NODE_ENV === "production") {
      throw new Error("sendTest is dev-only");
    }
    const userId = ctx.userId ?? "anonymous";
    try {
      const q = getPushQueue();
      await q.add("test", {
        userId,
        title: "ParkFi test notification",
        body: "Push notifications are working!",
        url: "/",
      });
    } catch (err) {
      console.error("[notifications.sendTest]", err);
      throw err;
    }
    return { ok: true };
  }),

  /** The current user's per-domain email-alert opt-out flags. */
  getPrefs: protectedProcedure.query(async ({ ctx }) => {
    const [row] = await db
      .select({
        stayEmailOptOut: alertOptout.stayEmailOptOut,
        diningEmailOptOut: alertOptout.diningEmailOptOut,
      })
      .from(alertOptout)
      .where(eq(alertOptout.userId, ctx.userId))
      .limit(1);
    return {
      stayEmailOptOut: row?.stayEmailOptOut ?? false,
      diningEmailOptOut: row?.diningEmailOptOut ?? false,
    };
  }),

  /** Update one or both email-alert opt-out flags (upsert). */
  setPrefs: protectedProcedure
    .input(
      z.object({
        stayEmailOptOut: z.boolean().optional(),
        diningEmailOptOut: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await db
        .insert(alertOptout)
        .values({
          userId: ctx.userId,
          stayEmailOptOut: input.stayEmailOptOut ?? false,
          diningEmailOptOut: input.diningEmailOptOut ?? false,
        })
        .onConflictDoUpdate({
          target: alertOptout.userId,
          set: {
            ...(input.stayEmailOptOut !== undefined
              ? { stayEmailOptOut: input.stayEmailOptOut }
              : {}),
            ...(input.diningEmailOptOut !== undefined
              ? { diningEmailOptOut: input.diningEmailOptOut }
              : {}),
            updatedAt: new Date(),
          },
        });
      return { ok: true };
    }),
});
