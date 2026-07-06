import { createFileRoute } from "@tanstack/react-router";

import { AppInset } from "#/components/app-inset.tsx";
import { AppSidebar } from "#/components/app-sidebar.tsx";
import { MaintenanceGate } from "#/components/maintenance-gate.tsx";
import { PredictionsDashboard } from "#/components/predictions/predictions-dashboard.tsx";
import { SiteHeader } from "#/components/site-header.tsx";
import { SidebarProvider } from "#/components/ui/sidebar.tsx";
import { seo } from "#/lib/seo.ts";

export const Route = createFileRoute("/predictions")({
  component: PredictionsPage,
  head: () =>
    seo({
      title: "Theme Park Wait-Time Forecasts & Crowd Calendar — ParkFi",
      description:
        "Predicted ride wait times and a daily crowd index for Walt Disney World and Universal Orlando, backtested against real waits for honest accuracy.",
      keywords:
        "Disney World crowd calendar, theme park wait time prediction, Universal Orlando crowd forecast, ride wait forecast",
      path: "/predictions",
    }),
});

function PredictionsPage() {
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
        <SiteHeader title="Forecasts" />
        <MaintenanceGate feature="predictions" title="Forecasts are under maintenance">
          <div className="flex flex-1 flex-col">
            <div className="@container/main flex flex-1 flex-col gap-2">
              <PredictionsDashboard />
            </div>
          </div>
        </MaintenanceGate>
      </AppInset>
    </SidebarProvider>
  );
}
