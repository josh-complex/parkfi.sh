import { Outlet, createFileRoute, useParams } from "@tanstack/react-router";

import { AppSidebar } from "#/components/app-sidebar.tsx";
import { SelectionProvider, useSelection } from "#/components/park-dashboard/selection-context.tsx";
import { ParkMap } from "#/components/park-map/park-map.tsx";
import { SiteHeader } from "#/components/site-header.tsx";
import { SidebarInset, SidebarProvider } from "#/components/ui/sidebar.tsx";
import { cn } from "#/lib/utils.ts";

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
        {/* The map is a single persistent layout element: it stays mounted as we
            move between the overview and a park, so the camera flies between
            views instead of the whole map tearing down and redrawing. The active
            route only swaps the Outlet content beside it. */}
        <SelectionProvider>
          <DashBody activeSlug={activeSlug} />
        </SelectionProvider>
      </SidebarInset>
    </SidebarProvider>
  );
}

function DashBody({ activeSlug }: { activeSlug: string | null }) {
  const { selected, setSelected } = useSelection();

  return (
    <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
      <div
        className={cn(
          "relative h-64 shrink-0 overflow-hidden border-b lg:h-auto lg:border-b-0 lg:border-r",
          // A wider hero on the overview; narrower on a park so the board table
          // has room. Only the wrapper width changes — the map never remounts.
          activeSlug ? "lg:w-[45%]" : "lg:w-[60%]",
        )}
      >
        <ParkMap
          activeSlug={activeSlug}
          selectedId={selected?.id ?? null}
          onSelectAttraction={setSelected}
        />
      </div>
      <div className="min-w-0 flex-1 overflow-auto">
        <div className="@container/main flex flex-1 flex-col gap-2">
          <Outlet />
        </div>
      </div>
    </div>
  );
}
