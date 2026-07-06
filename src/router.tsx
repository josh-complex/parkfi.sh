import { createRouter as createTanStackRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

import type { ReactNode } from "react";
import { setupRouterSsrQueryIntegration } from "@tanstack/react-router-ssr-query";
import TanstackQueryProvider, { getContext } from "./integrations/tanstack-query/root-provider";
import { RouteErrorFallback } from "./components/route-error-fallback";
import { reportError } from "./lib/report-error";
import { ErrorTestPanel } from "./components/dev/error-test-panel";

export function getRouter() {
  const context = getContext();

  const router = createTanStackRouter({
    routeTree,
    context,
    scrollRestoration: true,
    defaultPreload: "intent",
    defaultPreloadStaleTime: 0,

    // Fires for every error caught by a router error boundary — render errors
    // AND loader/`ensureQueryData` failures — so one capture point covers all
    // routes. `toast: false`: the error component below IS the surfacing.
    defaultOnCatch: (error) => {
      reportError(error, { source: "render", severity: "critical", toast: false });
    },
    defaultErrorComponent: RouteErrorFallback,

    Wrap: (props: { children: ReactNode }) => {
      return (
        <TanstackQueryProvider context={context}>
          {props.children}
          {/* Admin-only (nav-test-tools flag) QA panel for firing error states.
              Here inside the query/tRPC/PostHog contexts its triggers need. */}
          <ErrorTestPanel />
        </TanstackQueryProvider>
      );
    },
  });

  setupRouterSsrQueryIntegration({ router, queryClient: context.queryClient });

  return router;
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}
