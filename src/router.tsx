import { createRouter as createTanStackRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

import type { ReactNode } from "react";
import { setupRouterSsrQueryIntegration } from "@tanstack/react-router-ssr-query";
import TanstackQueryProvider, { getContext } from "./integrations/tanstack-query/root-provider";
import { RouteErrorFallback } from "./components/route-error-fallback";
import { RouteSkeleton } from "./components/skeletons";
import { reportError } from "./lib/report-error";
import { ErrorTestPanel } from "./components/dev/error-test-panel";

export function getRouter() {
  const context = getContext();

  const router = createTanStackRouter({
    routeTree,
    context,
    scrollRestoration: true,
    defaultPreload: "intent",
    // Let hover-preloaded data survive the click: with the query staleTime now
    // at 30s, a `0` here would mark every preload immediately stale and the
    // click would refetch from scratch — paying for the preload, getting none of
    // it. Match the window so `ensureQueryData` in loaders reads from cache.
    defaultPreloadStaleTime: 30_000,

    // When a loader does have to wait (cold cache), show a skeleton instead of
    // freezing the old page. `defaultPendingMs: 150` keeps warm-cache/preloaded
    // navigations (which resolve in <150ms) from ever flashing a skeleton;
    // `defaultPendingMinMs` holds it long enough not to flicker once shown.
    defaultPendingComponent: RouteSkeleton,
    defaultPendingMs: 150,
    defaultPendingMinMs: 300,

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
