import { Outlet, createFileRoute, useParams } from "@tanstack/react-router";

import { AchievementTracker } from "#/components/achievements/achievement-tracker.tsx";
import { SelectionProvider } from "#/components/park-dashboard/selection-context.tsx";
import { MapStageProvider } from "#/components/park-map/map-stage.tsx";
import { RideFilterProvider } from "#/components/rides/ride-filter.tsx";

/**
 * Dashboard-only layer, nested inside the persistent `_app` shell. It adds just
 * the map-stage machinery the dashboard/map routes share — one `ParkMap` lives
 * in the stage and is lent to whichever route mounts a `<MapSlot>`, so moving
 * between the overview hero and a park card is a single smooth morph rather than
 * a redraw. The sidebar/header/nav shell is provided by `_app` one level up.
 */
function DashLayout() {
  // strict:false so this resolves on both `/` and `/park/$slug`.
  const params = useParams({ strict: false }) as { slug?: string };
  const activeSlug = params.slug ?? null;

  return (
    <>
      <AchievementTracker />
      <SelectionProvider>
        <RideFilterProvider>
          <MapStageProvider activeSlug={activeSlug}>
            <Outlet />
          </MapStageProvider>
        </RideFilterProvider>
      </SelectionProvider>
    </>
  );
}

export const Route = createFileRoute("/_app/_dash")({
  component: DashLayout,
  // Prefetch the park list on the server so the dehydrated cache hydrates the
  // sidebar/header instantly and crawlers see real park names — not a spinner.
  // Stays on `_dash` (not `_app`) so non-dashboard routes never fetch parks.
  loader: async ({ context }) => {
    await context.queryClient.ensureQueryData(context.trpc.parks.list.queryOptions());
  },
});
