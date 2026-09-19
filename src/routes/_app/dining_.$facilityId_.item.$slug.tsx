import { createFileRoute } from "@tanstack/react-router";
import { isServer } from "@tanstack/react-query";

import { MenuItemDetail } from "#/components/dining/menu-item-detail.tsx";
import { discordComponentEmbed, linkButton, linkPreview } from "#/lib/discord-embed.ts";
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
    return {
      itemTitle: item?.title ?? null,
      venueName: venue?.name ?? null,
      // For the Discord component embed's body line. No dish photography exists
      // in any menu feed, so the price is the only concrete thing to show.
      price: item?.current?.price ?? null,
      currency: item?.current?.currency ?? null,
      priceChanges: item?.priceHistory?.length ?? 0,
    };
  },
  head: ({ params, loaderData }) => {
    const item = loaderData?.itemTitle ?? "Menu item";
    const at = loaderData?.venueName ? ` at ${loaderData.venueName}` : "";
    const path = `/dining/${params.facilityId}/item/${params.slug}`;
    const price =
      loaderData?.price != null
        ? `${loaderData.currency === "USD" || !loaderData.currency ? "$" : `${loaderData.currency} `}${loaderData.price.toFixed(2)}`
        : null;
    return {
      ...seo({
        title: `${item} — Price History${at ? ` —${at}` : ""} — ParkFi`,
        description: `Price history and menu tracking for ${item}${at} on ParkFi.`,
        path,
      }),
      scripts: discordComponentEmbed(
        linkPreview({
          title: item,
          url: path,
          subtitle: loaderData?.venueName,
          // The venue's card, since no menu feed carries dish photography — it
          // gives the embed the right visual anchor even if not the dish itself.
          card: `/og/dining/${params.facilityId}/card.jpg`,
          body: price
            ? `**${price}**${loaderData && loaderData.priceChanges > 1 ? ` · ${loaderData.priceChanges} price changes tracked` : ""}`
            : "Price history and menu tracking.",
          buttons: [linkButton("Full menu", `/dining/${params.facilityId}`)],
        }),
      ),
    };
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
