import { TRPCError, initTRPC } from "@trpc/server";
import superjson from "superjson";

import { auth } from "#/lib/auth.ts";

export interface TRPCContext {
  userId?: string;
  userEmail?: string;
  userRole?: string;
  orgTenantId?: string;
}

// Resolve the Better-auth session from the request cookies. `getSession`
// returns null for anonymous callers, so `userId` stays undefined and the
// public procedures keep working (they fall back to "anonymous").
export async function createTRPCContext(opts: { req: Request }): Promise<TRPCContext> {
  const session = await auth.api.getSession({ headers: opts.req.headers });
  const user = session?.user as
    | { id: string; email: string; role?: string; orgTenantId?: string }
    | undefined;
  return {
    userId: user?.id,
    userEmail: user?.email,
    userRole: user?.role,
    orgTenantId: user?.orgTenantId,
  };
}

/**
 * Owner allowlist for admin-only procedures. Comma-separated emails in
 * ADMIN_EMAILS. Fail-closed: if it's unset, NO ONE is admin — so an
 * open-signup app can't have a random account manage the blog.
 */
const ADMIN_EMAILS = new Set(
  (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean),
);

/** True if `email` is on the owner allowlist. Fail-closed on missing email. */
export function isAdminEmail(email: string | undefined | null): boolean {
  return !!email && ADMIN_EMAILS.has(email.toLowerCase());
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

/** Requires the caller to be an owner (email in ADMIN_EMAILS). */
export const adminProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.userId) throw new TRPCError({ code: "UNAUTHORIZED" });
  if (!isAdminEmail(ctx.userEmail)) {
    throw new TRPCError({ code: "FORBIDDEN" });
  }
  return next({ ctx: { userId: ctx.userId } });
});

/**
 * Requires the caller to be a verified cast member (role granted server-side
 * from a Microsoft Entra tenant; see `src/server/auth/org-role.ts`). The role is
 * write-protected (`input: false`), so it can't be self-assigned via the API.
 */
export const castMemberProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.userId) throw new TRPCError({ code: "UNAUTHORIZED" });
  if (ctx.userRole !== "cast_member") throw new TRPCError({ code: "FORBIDDEN" });
  return next({
    ctx: { userId: ctx.userId, userEmail: ctx.userEmail, orgTenantId: ctx.orgTenantId },
  });
});
