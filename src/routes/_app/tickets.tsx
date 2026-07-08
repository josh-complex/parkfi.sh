import { createFileRoute } from "@tanstack/react-router";

import { MaintenanceGate } from "#/components/maintenance-gate.tsx";
import { PricingCalendar } from "#/components/ticket-pricing/pricing-calendar.tsx";
import { seo } from "#/lib/seo.ts";

export const Route = createFileRoute("/_app/tickets")({
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
    <MaintenanceGate feature="tickets" title="Ticket pricing is under maintenance">
      <div className="flex flex-1 flex-col">
        <div className="@container/main flex flex-1 flex-col gap-2">
          <PricingCalendar />
        </div>
      </div>
    </MaintenanceGate>
  );
}
