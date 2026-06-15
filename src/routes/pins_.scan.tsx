import { Link, createFileRoute } from "@tanstack/react-router";

import { AppInset } from "#/components/app-inset.tsx";
import { AppSidebar } from "#/components/app-sidebar.tsx";
import { PinScanner } from "#/components/pins/pin-scanner.tsx";
import { SiteHeader } from "#/components/site-header.tsx";
import { Button } from "#/components/ui/button.tsx";
import { SidebarProvider } from "#/components/ui/sidebar.tsx";
import { seo } from "#/lib/seo.ts";

export const Route = createFileRoute("/pins_/scan")({
  component: PinScanPage,
  head: () =>
    seo({
      title: "Scan a Pin — ParkFi",
      description: "Snap a photo to identify a Disney trading pin and see its estimated value.",
      path: "/pins/scan",
      noindex: true,
    }),
});

function PinScanPage() {
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
        <SiteHeader title="Scan a pin" />
        <div className="flex flex-1 flex-col">
          <div className="@container/main flex flex-1 flex-col gap-2">
            <div className="mx-auto w-full max-w-2xl space-y-5 px-4 py-8">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <h1 className="text-xl font-semibold">Scan a pin</h1>
                  <p className="text-muted-foreground text-sm">
                    Snap a photo and we'll find the closest matches.
                  </p>
                </div>
                <Button variant="outline" size="sm" render={<Link to="/pins" />}>
                  Catalog
                </Button>
              </div>
              <PinScanner />
            </div>
          </div>
        </div>
      </AppInset>
    </SidebarProvider>
  );
}
