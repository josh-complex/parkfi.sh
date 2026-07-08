import * as React from "react";
import { Outlet, createFileRoute } from "@tanstack/react-router";

import { AppInset } from "#/components/app-inset.tsx";
import { AppSidebar } from "#/components/app-sidebar.tsx";
import { SiteHeader } from "#/components/site-header.tsx";
import { SidebarProvider } from "#/components/ui/sidebar.tsx";

/**
 * The one persistent app shell. Every in-app route nests under this pathless
 * layout so the sidebar, blue toolbar, and mobile bottom-nav mount once and
 * survive cross-section navigation — no more tearing the whole shell down and
 * rebuilding it on every dining → stays → pins hop.
 *
 * Because the shell lives above the `<Outlet>`, a child route's pending state
 * (the router's `defaultPendingComponent` skeleton) renders *inside* the shell
 * rather than replacing it — so the bottom nav stays put while a page loads
 * instead of vanishing behind the skeleton.
 *
 * No loader here: the sidebar's `parks.list` query is `enabled: isDashboard`
 * only, so its prefetch belongs on `_dash` (which just the dashboard routes
 * nest under), not on this app-wide layout — `/privacy` should never fetch
 * parks.
 */
function AppShell() {
  return (
    <SidebarProvider
      style={
        {
          "--sidebar-width": "calc(var(--spacing) * 72)",
          "--header-height": "calc(var(--spacing) * 12)",
        } as React.CSSProperties
      }
    >
      <AppSidebar variant="inset" />
      <AppInset>
        <SiteHeader />
        <Outlet />
      </AppInset>
    </SidebarProvider>
  );
}

export const Route = createFileRoute("/_app")({
  component: AppShell,
});
