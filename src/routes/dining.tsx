import { createFileRoute } from "@tanstack/react-router";

import { AppSidebar } from "#/components/app-sidebar.tsx";
import { DiningBoard } from "#/components/dining/dining-board.tsx";
import { SiteHeader } from "#/components/site-header.tsx";
import { SidebarInset, SidebarProvider } from "#/components/ui/sidebar.tsx";
import { seo } from "#/lib/seo.ts";

export const Route = createFileRoute("/dining")({
  component: DiningPage,
  head: () =>
    seo({
      title: "Dining Reservations & Availability — ParkFi",
      description:
        "Find open table-service dining reservations at Walt Disney World and Universal Orlando with live availability across dates, parties, and restaurants.",
      keywords:
        "Disney dining reservations, Walt Disney World restaurants, dining availability, theme park dining",
      path: "/dining",
    }),
});

function DiningPage() {
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
        <SiteHeader title="Dining Reservations" />
        <div className="flex flex-1 flex-col">
          <div className="@container/main flex flex-1 flex-col gap-2">
            <DiningBoard />
          </div>
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
