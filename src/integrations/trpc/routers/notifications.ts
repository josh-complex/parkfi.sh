import { z } from "zod";
import { createTRPCRouter, publicProcedure } from "../init";
import { addSub, removeSub } from "#/server/notifications/subscriptions.ts";
import { pushQueue } from "#/server/notifications/queue.ts";

const pushSubSchema = z.object({
  endpoint: z.string().url(),
  p256dh: z.string(),
  auth: z.string(),
});

export const notificationsRouter = createTRPCRouter({
  subscribe: publicProcedure.input(pushSubSchema).mutation(async ({ input, ctx }) => {
    const userId = (ctx as { userId?: string }).userId ?? "anonymous";
    await addSub(userId, input);
    return { ok: true };
  }),

  unsubscribe: publicProcedure
    .input(z.object({ endpoint: z.string().url() }))
    .mutation(async ({ input, ctx }) => {
      const userId = (ctx as { userId?: string }).userId ?? "anonymous";
      await removeSub(userId, input.endpoint);
      return { ok: true };
    }),

  sendTest: publicProcedure.mutation(async ({ ctx }) => {
    if (process.env.NODE_ENV === "production") {
      throw new Error("sendTest is dev-only");
    }
    const userId = (ctx as { userId?: string }).userId ?? "anonymous";
    await pushQueue.add("test", {
      userId,
      title: "ParkFish test notification",
      body: "Push notifications are working!",
      url: "/",
    });
    return { ok: true };
  }),
});
