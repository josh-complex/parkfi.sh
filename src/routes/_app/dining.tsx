import { createFileRoute } from "@tanstack/react-router";

import { MaintenanceGate } from "#/components/maintenance-gate.tsx";
import { DiningBoard } from "#/components/dining/dining-board.tsx";
import { validateDiningSearch } from "#/components/dining/dining-search-params.ts";
import { seo } from "#/lib/seo.ts";

export const Route = createFileRoute("/_app/dining")({
  component: DiningPage,
  validateSearch: validateDiningSearch,
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
    <MaintenanceGate feature="dining" title="Dining is under maintenance">
      <div className="flex flex-1 flex-col">
        <div className="@container/main flex flex-1 flex-col gap-2">
          <DiningBoard />
        </div>
      </div>
    </MaintenanceGate>
  );
}
