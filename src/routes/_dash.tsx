import { Outlet, createFileRoute, useParams, useRouterState } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";

import { AppInset } from "#/components/app-inset.tsx";
import { AppSidebar } from "#/components/app-sidebar.tsx";
import { SelectionProvider } from "#/components/park-dashboard/selection-context.tsx";
import { MapStageProvider } from "#/components/park-map/map-stage.tsx";
import { RideFilterProvider } from "#/components/rides/ride-filter.tsx";
import { SiteHeader } from "#/components/site-header.tsx";
import { SidebarProvider } from "#/components/ui/sidebar.tsx";
import { useTRPC } from "#/integrations/trpc/react.ts";

/** "magic-kingdom" -> "Magic Kingdom" for a readable title while the park loads. */
function titleizeSlug(slug: string): string {
  return slug
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function DashLayout() {
  // strict:false so this resolves on both `/` and `/park/$slug`.
  const params = useParams({ strict: false }) as { slug?: string };
  const activeSlug = params.slug ?? null;

  // Static dashboard pages set their own header title; the map views keep the
  // default and surface the park name as the mobile title.
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const title = pathname === "/alerts" ? "Alerts" : "Live Park Map";

  const trpc = useTRPC();
  const parksQ = useQuery(trpc.parks.list.queryOptions());
  const parkName = activeSlug
    ? (parksQ.data?.find((p) => p.slug === activeSlug)?.name ?? titleizeSlug(activeSlug))
    : null;

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
        <SiteHeader title={title} mobileTitle={parkName ?? undefined} />
        {/* One ParkMap lives in the stage and is lent to whichever route mounts
            a <MapSlot>. It never remounts, so moving between the overview hero
            and the park card is a single smooth morph rather than a redraw. */}
        <SelectionProvider>
          <RideFilterProvider>
            <MapStageProvider activeSlug={activeSlug}>
              <Outlet />
            </MapStageProvider>
          </RideFilterProvider>
        </SelectionProvider>
      </AppInset>
    </SidebarProvider>
  );
}

export const Route = createFileRoute("/_dash")({
  component: DashLayout,
  // Prefetch the park list on the server so the dehydrated cache hydrates the
  // sidebar/header instantly and crawlers see real park names — not a spinner.
  loader: async ({ context }) => {
    await context.queryClient.ensureQueryData(context.trpc.parks.list.queryOptions());
  },
});
