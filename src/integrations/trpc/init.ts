import { TRPCError, initTRPC } from "@trpc/server";
import superjson from "superjson";

import { auth } from "#/lib/auth.ts";

export interface TRPCContext {
  userId?: string;
}

// Resolve the Better-auth session from the request cookies. `getSession`
// returns null for anonymous callers, so `userId` stays undefined and the
// public procedures keep working (they fall back to "anonymous").
export async function createTRPCContext(opts: { req: Request }): Promise<TRPCContext> {
  const session = await auth.api.getSession({ headers: opts.req.headers });
  return { userId: session?.user.id };
}

const t = initTRPC.context<TRPCContext>().create({
  transformer: superjson,
});

export const createTRPCRouter = t.router;
export const publicProcedure = t.procedure;

/** Requires an authenticated user; narrows `ctx.userId` to a string downstream. */
export const protectedProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.userId) throw new TRPCError({ code: "UNAUTHORIZED" });
  return next({ ctx: { userId: ctx.userId } });
});
