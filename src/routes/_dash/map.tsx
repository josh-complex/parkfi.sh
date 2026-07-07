import { createFileRoute } from "@tanstack/react-router";

import { MapSlot } from "#/components/park-map/map-stage.tsx";
import { load } from "#/lib/loader.ts";
import { seo } from "#/lib/seo.ts";

export const Route = createFileRoute("/_dash/map")({
  component: MapPage,
  // The cross-park markers come from the overview query — prefetch it so the
  // fullscreen map paints with parks immediately. `load` blocks server-side; on
  // the client the map paints right away and the markers stream in.
  loader: async ({ context }) => {
    await load(context.queryClient, context.trpc.parks.overview.queryOptions());
  },
  head: () =>
    seo({
      title: "Live Park Map — Disney World & Universal Orlando | ParkFi",
      description:
        "Explore an interactive live map of Walt Disney World and Universal Orlando — tap a park to dive into real-time wait times, and route to any attraction from where you stand.",
      path: "/map",
    }),
});

function MapPage() {
  return (
    // The map IS the page on mobile: a full-viewport fixed layer behind the
    // floating top bar (z-30) and bottom nav (z-40), so both bars show the map
    // through their transparent areas. On desktop it's a fixed-height card.
    <>
      <MapSlot className="roam-map fixed inset-0 z-0 md:static md:z-auto md:h-[calc(100svh-var(--header-height)-var(--toolbar-height)-0.5rem)]" />
    </>
  );
}
