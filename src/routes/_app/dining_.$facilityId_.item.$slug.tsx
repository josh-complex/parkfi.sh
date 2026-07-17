import { createFileRoute } from "@tanstack/react-router";
import { isServer } from "@tanstack/react-query";

import { MenuItemDetail } from "#/components/dining/menu-item-detail.tsx";
import { seo } from "#/lib/seo.ts";

export const Route = createFileRoute("/_app/dining_/$facilityId_/item/$slug")({
  component: MenuItemPage,
  // SSR-prefetch the item + its venue so the rendered HTML carries the indexable
  // price/history content and the head can name the item and restaurant.
  loader: async ({ context, params }) => {
    const itemOptions = context.trpc.dining.menuItem.queryOptions({
      facilityId: params.facilityId,
      slug: params.slug,
    });
    const venueOptions = context.trpc.dining.venue.queryOptions({
      facilityId: params.facilityId,
    });
    const elsewhereOptions = context.trpc.dining.menuItemElsewhere.queryOptions({
      facilityId: params.facilityId,
      slug: params.slug,
    });
    if (!isServer) {
      // Client: warm all three caches and render immediately — MenuItemDetail
      // owns its loading state, so don't freeze the menu on the fetches.
      void context.queryClient.prefetchQuery(itemOptions);
      void context.queryClient.prefetchQuery(venueOptions);
      void context.queryClient.prefetchQuery(elsewhereOptions);
      return;
    }
    const [item, venue] = await Promise.all([
      context.queryClient.ensureQueryData(itemOptions),
      context.queryClient.ensureQueryData(venueOptions),
      context.queryClient.ensureQueryData(elsewhereOptions),
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

  return (
    <div className="flex flex-1 flex-col">
      <MenuItemDetail facilityId={facilityId} slug={slug} />
    </div>
  );
}
