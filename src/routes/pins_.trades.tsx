import { Link, createFileRoute } from "@tanstack/react-router";

import { AppInset } from "#/components/app-inset.tsx";
import { AppSidebar } from "#/components/app-sidebar.tsx";
import { PinTradeBoard } from "#/components/pins/pin-trade-board.tsx";
import { SiteHeader } from "#/components/site-header.tsx";
import { Button } from "#/components/ui/button.tsx";
import { SidebarProvider } from "#/components/ui/sidebar.tsx";
import { seo } from "#/lib/seo.ts";

export const Route = createFileRoute("/pins_/trades")({
  component: PinTradesPage,
  head: () =>
    seo({
      title: "Pin Trades — ParkFi",
      description: "Find trade matches for your Disney pins and manage your trade offers.",
      path: "/pins/trades",
      noindex: true,
    }),
});

function PinTradesPage() {
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
        <SiteHeader title="Pin trades" />
        <div className="flex flex-1 flex-col">
          <div className="@container/main flex flex-1 flex-col gap-2">
            <div className="mx-auto w-full max-w-3xl space-y-5 px-4 py-8">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <h1 className="text-xl font-semibold">Pin trades</h1>
                  <p className="text-muted-foreground text-sm">
                    Trade matches and your open offers.
                  </p>
                </div>
                <Button variant="outline" size="sm" render={<Link to="/pins/collection" />}>
                  My collection
                </Button>
              </div>
              <PinTradeBoard />
            </div>
          </div>
        </div>
      </AppInset>
    </SidebarProvider>
  );
}
