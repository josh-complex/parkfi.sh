/**
 * Living Layer — dev/armchair-mode tRPC router (M0).
 *
 * SAFETY: every procedure calls `assertDevEnabled()` first, which throws unless
 * LIVING_DEV=1. On a production deployment these are inert. Registered in
 * router.ts but reachable only in dev — it adds no surface to the live app.
 */
import { z } from "zod";

import { AttractionStatus } from "#/server/parks/codes.ts";
import { activeMarkCount, injectStatus, reconcileNow } from "#/server/living/dev.ts";

import { publicProcedure } from "../init.ts";

import type { TRPCRouterRecord } from "@trpc/server";

export const livingDevRouter = {
  /** Write a synthetic ride status (e.g. DOWN) to drive the Darkness engine. */
  injectStatus: publicProcedure
    .input(
      z.object({
        attractionId: z.number().int().positive(),
        status: z.number().int().min(0).max(4).default(AttractionStatus.DOWN),
      }),
    )
    .mutation(async ({ input }) => {
      await injectStatus(input.attractionId, input.status);
      return { ok: true };
    }),

  /** Run a Darkness reconcile immediately instead of waiting for the worker. */
  reconcile: publicProcedure.mutation(async () => {
    return reconcileNow();
  }),

  /** Count active marks in a park — a quick dev assertion of the loop. */
  activeMarks: publicProcedure
    .input(z.object({ parkId: z.number().int().positive() }))
    .query(async ({ input }) => {
      return { count: await activeMarkCount(input.parkId) };
    }),
} satisfies TRPCRouterRecord;
