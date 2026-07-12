import * as React from "react";
import { Outlet, createFileRoute, useParams } from "@tanstack/react-router";

import { AppInset } from "#/components/app-inset.tsx";
import { AppSidebar } from "#/components/app-sidebar.tsx";
import { SelectionProvider } from "#/components/park-dashboard/selection-context.tsx";
import { MapStageProvider } from "#/components/park-map/map-stage.tsx";
import { RideFilterProvider } from "#/components/rides/ride-filter.tsx";
import { SiteHeader } from "#/components/site-header.tsx";
import { SidebarProvider } from "#/components/ui/sidebar.tsx";

/**
 * The one persistent app shell. Every in-app route nests under this pathless
 * layout so the sidebar, blue toolbar, and mobile bottom-nav mount once and
 * survive cross-section navigation — no more tearing the whole shell down and
 * rebuilding it on every dining → stays → pins hop.
 *
 * The map stage lives here too (not on `_dash`), so the singleton `ParkMap` —
 * its WebGL context, markers, and camera — survives hops to non-dashboard
 * sections like tickets/dining/stays that sit *outside* `_dash`. Otherwise
 * leaving `/map` for a bottom-nav sibling tore the map down, and returning
 * remounted + re-zoomed it from scratch. The stage self-defers: it doesn't load
 * the map libraries or mount a renderer until the first `<MapSlot>` claims it,
 * so entry points like `/privacy` still pay nothing for the map.
 *
 * Because the shell lives above the `<Outlet>`, a child route's pending state
 * (the router's `defaultPendingComponent` skeleton) renders *inside* the shell
 * rather than replacing it — so the bottom nav stays put while a page loads
 * instead of vanishing behind the skeleton.
 */
function AppShell() {
  // strict:false so this resolves on any route — the slug is only present on
  // `/park/$slug` (and its ride child); elsewhere the map runs in free-roam.
  const params = useParams({ strict: false }) as { slug?: string };
  const activeSlug = params.slug ?? null;

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
        <SelectionProvider>
          <RideFilterProvider>
            <MapStageProvider activeSlug={activeSlug}>
              <Outlet />
            </MapStageProvider>
          </RideFilterProvider>
        </SelectionProvider>
      </AppInset>
    </SidebarProvider>
  );
}

export const Route = createFileRoute("/_app")({
  component: AppShell,
});
