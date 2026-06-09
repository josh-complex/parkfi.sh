import { createFileRoute } from "@tanstack/react-router";

import { AppSidebar } from "#/components/app-sidebar.tsx";
import { SiteHeader } from "#/components/site-header.tsx";
import { PricingCalendar } from "#/components/ticket-pricing/pricing-calendar.tsx";
import { SidebarInset, SidebarProvider } from "#/components/ui/sidebar.tsx";
import { seo } from "#/lib/seo.ts";

export const Route = createFileRoute("/tickets")({
  component: TicketsPage,
  head: () =>
    seo({
      title: "Theme Park Ticket Prices & Pricing Calendar — ParkFi",
      description:
        "Compare daily theme park ticket prices across the calendar for Walt Disney World and Universal Orlando, and find the cheapest days to visit.",
      keywords:
        "Disney World ticket prices, Universal Orlando tickets, theme park ticket calendar, cheapest park days",
      path: "/tickets",
    }),
});

function TicketsPage() {
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
        <SiteHeader title="Ticket Pricing" />
        <div className="flex flex-1 flex-col">
          <div className="@container/main flex flex-1 flex-col gap-2">
            <PricingCalendar />
          </div>
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
