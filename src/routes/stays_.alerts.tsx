import { Link, createFileRoute } from "@tanstack/react-router";

import { AppSidebar } from "#/components/app-sidebar.tsx";
import { SiteHeader } from "#/components/site-header.tsx";
import { StayAlertsManager } from "#/components/stays/stay-alerts-manager.tsx";
import { Button } from "#/components/ui/button.tsx";
import { SidebarInset, SidebarProvider } from "#/components/ui/sidebar.tsx";
import { seo } from "#/lib/seo.ts";

export const Route = createFileRoute("/stays_/alerts")({
  component: StayAlertsPage,
  head: () =>
    seo({
      title: "Stay Alerts — ParkFi",
      description: "Manage your Walt Disney World resort-availability email alerts.",
      path: "/stays/alerts",
      noindex: true,
    }),
});

function StayAlertsPage() {
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
        <SiteHeader title="Stay alerts" />
        <div className="flex flex-1 flex-col">
          <div className="@container/main flex flex-1 flex-col gap-2">
            <div className="mx-auto w-full max-w-2xl space-y-5 px-4 py-8">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <h1 className="text-xl font-semibold">Stay alerts</h1>
                  <p className="text-muted-foreground text-sm">
                    We'll email you when a resort opens up or drops below your price.
                  </p>
                </div>
                <Button variant="outline" size="sm" render={<Link to="/stays" />}>
                  Find a resort
                </Button>
              </div>
              <StayAlertsManager />
            </div>
          </div>
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
