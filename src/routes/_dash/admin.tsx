import { createServerFn } from "@tanstack/react-start";
import { getRequestHeaders } from "@tanstack/react-start/server";
import { Outlet, createFileRoute, redirect } from "@tanstack/react-router";

import { isAdminEmail } from "#/integrations/trpc/init.ts";
import { auth } from "#/lib/auth.ts";

// Runs on the server with the incoming request's cookies — during SSR it reads
// them from the request scope, and on a client navigation the server-fn call
// forwards them. This is why the guard can't just hit a tRPC query: the shared
// tRPC client doesn't forward the session cookie during SSR, so a hard load of
// /admin would look anonymous. Owner status keys on ADMIN_EMAILS, the same
// allowlist adminProcedure enforces on the tools themselves.
const checkIsAdmin = createServerFn({ method: "GET" }).handler(async () => {
  const session = await auth.api.getSession({ headers: getRequestHeaders() });
  return isAdminEmail(session?.user?.email);
});

export const Route = createFileRoute("/_dash/admin")({
  // Owner-only. Bounces everyone else — cast members, regular users, anonymous —
  // to the home page before any admin page renders.
  beforeLoad: async () => {
    if (!(await checkIsAdmin())) throw redirect({ to: "/" });
  },
  component: () => <Outlet />,
});
