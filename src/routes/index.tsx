import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { AppSidebar } from "#/components/app-sidebar.tsx";
import { ParkDashboard } from "#/components/park-dashboard/park-dashboard.tsx";
import { SiteHeader } from "#/components/site-header.tsx";
import { SidebarInset, SidebarProvider } from "#/components/ui/sidebar.tsx";

export const Route = createFileRoute("/")({
  validateSearch: z.object({ park: z.string().optional() }),
  component: Home,
});

function Home() {
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
        <SiteHeader title="Live Park Board" />
        <div className="flex flex-1 flex-col">
          <div className="@container/main flex flex-1 flex-col gap-2">
            <ParkDashboard />
          </div>
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
