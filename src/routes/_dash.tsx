import { Outlet, createFileRoute, useParams } from "@tanstack/react-router";

import { AppSidebar } from "#/components/app-sidebar.tsx";
import { SelectionProvider } from "#/components/park-dashboard/selection-context.tsx";
import { MapStageProvider } from "#/components/park-map/map-stage.tsx";
import { SiteHeader } from "#/components/site-header.tsx";
import { SidebarInset, SidebarProvider } from "#/components/ui/sidebar.tsx";

export const Route = createFileRoute("/_dash")({ component: DashLayout });

function DashLayout() {
  // strict:false so this resolves on both `/` and `/park/$slug`.
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
      <SidebarInset>
        <SiteHeader title={activeSlug ? "Live Park Board" : "Live Park Map"} />
        {/* One ParkMap lives in the stage and is lent to whichever route mounts
            a <MapSlot>. It never remounts, so moving between the overview hero
            and the park card is a single smooth morph rather than a redraw. */}
        <SelectionProvider>
          <MapStageProvider activeSlug={activeSlug}>
            <Outlet />
          </MapStageProvider>
        </SelectionProvider>
      </SidebarInset>
    </SidebarProvider>
  );
}
