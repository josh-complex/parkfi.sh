import { createFileRoute } from "@tanstack/react-router";

import { AppInset } from "#/components/app-inset.tsx";
import { AppSidebar } from "#/components/app-sidebar.tsx";
import { SiteHeader } from "#/components/site-header.tsx";
import { StaysBoard } from "#/components/stays/stays-board.tsx";
import { SidebarProvider } from "#/components/ui/sidebar.tsx";
import { seo } from "#/lib/seo.ts";

interface StaysSearch {
  /** Selected resort-area key (see RESORT_AREAS), or undefined for all. */
  area?: string;
}

export const Route = createFileRoute("/stays")({
  component: StaysPage,
  validateSearch: (search: Record<string, unknown>): StaysSearch => ({
    area: typeof search.area === "string" ? search.area : undefined,
  }),
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
  const { area } = Route.useSearch();
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
        <SiteHeader title="Stays" />
        <div className="flex flex-1 flex-col">
          <div className="@container/main flex flex-1 flex-col gap-2">
            <StaysBoard areaKey={area ?? null} />
          </div>
        </div>
      </AppInset>
    </SidebarProvider>
  );
}
