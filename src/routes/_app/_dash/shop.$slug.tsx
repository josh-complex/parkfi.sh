import { createFileRoute, notFound } from "@tanstack/react-router";
import { isServer } from "@tanstack/react-query";

import { ShopDetail, titleizeSlug } from "#/components/park-dashboard/shop-detail.tsx";
import { discordComponentEmbed, linkButton, linkPreview } from "#/lib/discord-embed.ts";
import { seo } from "#/lib/seo.ts";

export const Route = createFileRoute("/_app/_dash/shop/$slug")({
  component: ShopPage,
  // SSR-prefetch the shop so the rendered HTML carries its name, location, and
  // categories — the indexable content that lets the page rank / deep-link.
  loader: async ({ context, params }) => {
    const options = context.trpc.parks.shop.queryOptions({ slug: params.slug });
    if (!isServer) {
      // Client: warm the cache and render immediately instead of freezing the
      // previous page on the fetch; the component renders a titleized-slug
      // fallback until data lands. Only the server hard-404s unknown slugs —
      // that's the path crawlers see.
      void context.queryClient.prefetchQuery(options);
      return;
    }
    const shop = await context.queryClient.ensureQueryData(options);
    if (!shop) throw notFound();
    return {
      name: shop.name,
      land: shop.land,
      parkResort: shop.parkResort,
      // For the Discord component embed. Shops have no generated OG card, so
      // the store photo is the lead image.
      imageUrl: shop.imageUrl,
      merchandise: shop.merchandise,
    };
  },
  head: ({ params, loaderData }) => {
    const name = loaderData?.name ?? titleizeSlug(params.slug);
    const where = loaderData?.parkResort ?? loaderData?.land ?? "Walt Disney World";
    const path = `/shop/${params.slug}`;
    const merch = loaderData?.merchandise?.slice(0, 4).join(" · ");
    return {
      ...seo({
        title: `${name} — Shopping at ${where} | ParkFi`,
        description: `${name} at ${where}. Location, merchandise categories, and store details for this Walt Disney World shop on ParkFi.`,
        path,
      }),
      scripts: discordComponentEmbed(
        linkPreview({
          title: name,
          url: path,
          subtitle: [loaderData?.land, loaderData?.parkResort].filter(Boolean).join(" · "),
          body: merch ? `-# ${merch}` : undefined,
          card: loaderData?.imageUrl,
          buttons: [linkButton("Live map", "/map")],
        }),
      ),
    };
  },
});

function ShopPage() {
  const { slug } = Route.useParams();
  return <ShopDetail slug={slug} />;
}
