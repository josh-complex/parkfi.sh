import * as React from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";

import { AppInset } from "#/components/app-inset.tsx";
import { AppSidebar } from "#/components/app-sidebar.tsx";
import { MenuItemDetail } from "#/components/dining/menu-item-detail.tsx";
import { SiteHeader } from "#/components/site-header.tsx";
import { SidebarProvider } from "#/components/ui/sidebar.tsx";
import { useTRPC } from "#/integrations/trpc/react.ts";
import { seo } from "#/lib/seo.ts";

export const Route = createFileRoute("/dining_/$facilityId_/item/$slug")({
  component: MenuItemPage,
  // SSR-prefetch the item + its venue so the rendered HTML carries the indexable
  // price/history content and the head can name the item and restaurant.
  loader: async ({ context, params }) => {
    const [item, venue] = await Promise.all([
      context.queryClient.ensureQueryData(
        context.trpc.dining.menuItem.queryOptions({
          facilityId: params.facilityId,
          slug: params.slug,
        }),
      ),
      context.queryClient.ensureQueryData(
        context.trpc.dining.venue.queryOptions({ facilityId: params.facilityId }),
      ),
    ]);
    return { itemTitle: item?.title ?? null, venueName: venue?.name ?? null };
  },
  head: ({ params, loaderData }) => {
    const item = loaderData?.itemTitle ?? "Menu item";
    const at = loaderData?.venueName ? ` at ${loaderData.venueName}` : "";
    return seo({
      title: `${item} — Price History${at ? ` —${at}` : ""} — ParkFi`,
      description: `Price history and menu tracking for ${item}${at} on ParkFi.`,
      path: `/dining/${params.facilityId}/item/${params.slug}`,
    });
  },
});

function MenuItemPage() {
  const { facilityId, slug } = Route.useParams();
  const trpc = useTRPC();
  const { data: item } = useQuery(trpc.dining.menuItem.queryOptions({ facilityId, slug }));

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
        <SiteHeader title="Dining" mobileTitle={item?.title ?? undefined} />
        <div className="flex flex-1 flex-col">
          <MenuItemDetail facilityId={facilityId} slug={slug} />
        </div>
      </AppInset>
    </SidebarProvider>
  );
}
