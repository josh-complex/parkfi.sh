import { initTRPC } from "@trpc/server";
import superjson from "superjson";

export interface TRPCContext {
  userId?: string;
}

// No auth wired yet — procedures fall back to "anonymous". Returning an object
// (rather than letting ctx be undefined) is what keeps `ctx.userId` from throwing.
export function createTRPCContext(_opts: { req: Request }): TRPCContext {
  return {};
}

const t = initTRPC.context<TRPCContext>().create({
  transformer: superjson,
});

export const createTRPCRouter = t.router;
export const publicProcedure = t.procedure;
