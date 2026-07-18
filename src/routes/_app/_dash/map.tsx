import * as React from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";

import { MapSlot } from "#/components/park-map/map-stage.tsx";
import { requestNavDirections } from "#/components/park-map/nav-store.ts";
import { useTRPC } from "#/integrations/trpc/react.ts";
import { load } from "#/lib/loader.ts";
import { seo } from "#/lib/seo.ts";

export const Route = createFileRoute("/_app/_dash/map")({
  component: MapPage,
  // Walking-nav deep link (§4.2): `/map?nav=<attractionId>` opens the map
  // already routing to that attraction — shareable, and a target for
  // notifications. Anything non-numeric just drops.
  validateSearch: (search: Record<string, unknown>): { nav?: number } => {
    const nav = Number(search.nav);
    return Number.isInteger(nav) && nav > 0 ? { nav } : {};
  },
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
  const { nav } = Route.useSearch();
  const navigate = useNavigate();
  const trpc = useTRPC();
  // Resolve the deep-linked attraction id to a destination, park the trip in
  // the shared nav store (the map stage handles locating + preview from there),
  // then strip the param so refresh/back doesn't restart the trip.
  const destQ = useQuery({
    ...trpc.parks.attractionById.queryOptions({ id: nav ?? 0 }),
    enabled: nav != null,
  });
  React.useEffect(() => {
    if (nav == null || !destQ.isSuccess) return;
    const d = destQ.data;
    if (d && d.latitude != null && d.longitude != null) {
      requestNavDirections({ id: d.id, name: d.name, coords: [d.longitude, d.latitude] }, null);
    }
    // Unknown id / no coordinates: nothing to route to — just clean the URL.
    void navigate({ to: "/map", search: {}, replace: true });
  }, [nav, destQ.isSuccess, destQ.data, navigate]);

  return (
    // The map IS the page on mobile: a full-viewport fixed layer behind the
    // floating top bar (z-30) and bottom nav (z-40), so both bars show the map
    // through their transparent areas. On desktop it's a fixed-height card.
    <>
      <MapSlot
        pinnedFullBleed
        className="roam-map fixed inset-0 z-0 md:static md:z-auto md:h-[calc(100svh-var(--toolbar-height)-0.5rem)] md:rounded-2xl"
      />
    </>
  );
}
