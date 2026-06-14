import { createFileRoute } from "@tanstack/react-router";
import { motion } from "motion/react";

import { OverviewPanel } from "#/components/park-dashboard/overview-panel.tsx";
import { MapSlot } from "#/components/park-map/map-stage.tsx";
import { seo } from "#/lib/seo.ts";

export const Route = createFileRoute("/_dash/")({
  component: Overview,
  // SSR-prefetch the cross-park overview so the landing page ships real stats
  // (busiest park, waits, per-resort park links) in its HTML for crawlers.
  loader: async ({ context }) => {
    await context.queryClient.ensureQueryData(context.trpc.parks.overview.queryOptions());
  },
  head: () =>
    seo({
      title: "Live Park Map — Theme Park Wait Times | ParkFi",
      description:
        "Explore an interactive map of Walt Disney World and Universal Orlando with live wait times, ride status, and resort context updated in real time.",
      path: "/",
    }),
});

function Overview() {
  return (
    // Opacity-only entrance: a translate would shift the MapSlot's measured rect
    // and throw off the shared-map morph.
    <motion.div
      // On desktop the map + panel are a fixed-height "app" surface: cap the row
      // to the viewport (minus the header, the h-14 blue toolbar, and the inset's
      // m-2 gutters) so the panel scrolls internally instead of the whole row —
      // and the stretched map with it — growing to the panel's content height.
      className="flex min-h-0 flex-1 flex-col lg:h-[calc(100svh-var(--header-height)-var(--toolbar-height)-0.5rem)] lg:flex-none lg:flex-row lg:overflow-hidden"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.25 }}
    >
      {/* Wide map hero next to the resort summary. */}
      {/* Mobile: a rounded, bordered card inset from the blue shell — matching
          the park page's map. Only on desktop does it become the edge-to-edge
          60%-width hero split from the panel by a divider. */}
      <MapSlot className="relative isolate mx-4 h-64 shrink-0 overflow-hidden rounded-2xl border shadow-md lg:mx-0 lg:h-auto lg:w-[60%] lg:rounded-none lg:border-0 lg:border-r lg:shadow-none" />
      <div className="min-w-0 flex-1 overflow-auto">
        <div className="@container/main flex flex-1 flex-col gap-2">
          <OverviewPanel />
        </div>
      </div>
    </motion.div>
  );
}
