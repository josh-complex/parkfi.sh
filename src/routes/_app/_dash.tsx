import { Outlet, createFileRoute } from "@tanstack/react-router";

import { AchievementTracker } from "#/components/achievements/achievement-tracker.tsx";
import { load } from "#/lib/loader.ts";

/**
 * Dashboard-only layer, nested inside the persistent `_app` shell. The map-stage
 * machinery (and the selection/ride-filter providers it needs) now live on `_app`
 * so the singleton `ParkMap` survives hops to non-dashboard sections — see the
 * comment there. This layer's only remaining job is the parks prefetch loader
 * (so the dashboard hydrates instantly) plus the achievement tracker.
 */
function DashLayout() {
  return (
    <>
      <AchievementTracker />
      <Outlet />
    </>
  );
}

export const Route = createFileRoute("/_app/_dash")({
  component: DashLayout,
  // Prefetch the park list on the server so the dehydrated cache hydrates the
  // sidebar/header instantly and crawlers see real park names — not a spinner.
  // Stays on `_dash` (not `_app`) so non-dashboard routes never fetch parks.
  // `load` blocks only on the server: this loader re-runs on every dashboard
  // navigation, and a client-side await here would freeze every tab switch on a
  // `parks.list` round trip whenever the cache entry has gone stale.
  loader: async ({ context }) => {
    await load(context.queryClient, context.trpc.parks.list.queryOptions());
  },
});
