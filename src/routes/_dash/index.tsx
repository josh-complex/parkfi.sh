import { createFileRoute } from "@tanstack/react-router";

import { CrossParkWaits } from "#/components/rides/cross-park-waits.tsx";
import { load } from "#/lib/loader.ts";
import { seo } from "#/lib/seo.ts";

export const Route = createFileRoute("/_dash/")({
  component: Waits,
  // SSR-prefetch the cross-park ride list so the page ships real ride names +
  // live waits in its HTML (good for crawlers and instant first paint). `load`
  // blocks server-side; on the client it warms the cache and lets CrossParkWaits
  // render its own loading state immediately.
  loader: async ({ context }) => {
    await load(context.queryClient, context.trpc.parks.allRides.queryOptions());
  },
  head: () =>
    seo({
      title: "Live Theme Park Wait Times — Disney World & Universal Orlando | ParkFi",
      description:
        "Live standby wait times for every ride across Walt Disney World and Universal Orlando in one filterable list, updated in real time. Sort by wait, filter by type, and plan your day.",
      path: "/",
    }),
});

function Waits() {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <CrossParkWaits />
    </div>
  );
}
