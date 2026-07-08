import { createFileRoute } from "@tanstack/react-router";

import { MaintenanceGate } from "#/components/maintenance-gate.tsx";
import { StaysBoard } from "#/components/stays/stays-board.tsx";
import { seo } from "#/lib/seo.ts";

export const Route = createFileRoute("/_app/stays")({
  component: StaysPage,
  head: () =>
    seo({
      title: "Disney Resort Availability & Prices — ParkFi",
      description:
        "Search live room availability and nightly rates across every Walt Disney World Resort hotel — Value, Moderate, Deluxe, and Disney Vacation Club Villas — by date and party size.",
      keywords:
        "Disney resort availability, Walt Disney World hotels, Disney room rates, Disney Vacation Club, resort booking",
      path: "/stays",
    }),
});

function StaysPage() {
  return (
    <MaintenanceGate feature="stays" title="Stays is under maintenance">
      <div className="flex flex-1 flex-col">
        <div className="@container/main flex flex-1 flex-col gap-2">
          <StaysBoard />
        </div>
      </div>
    </MaintenanceGate>
  );
}
