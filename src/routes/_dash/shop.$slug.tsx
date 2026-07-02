import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowUpRightIcon, MapPinIcon, ShoppingBagIcon } from "lucide-react";

import { useTRPC } from "#/integrations/trpc/react.ts";
import { seo } from "#/lib/seo.ts";

/** "gateway-gifts" -> "Gateway Gifts" for a readable, indexable fallback title. */
function titleizeSlug(slug: string): string {
  return slug
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

/** "apparel-accessories" -> "Apparel Accessories" for the merchandise chips. */
function humanizeFacet(facet: string): string {
  return facet
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export const Route = createFileRoute("/_dash/shop/$slug")({
  component: ShopPage,
  // SSR-prefetch the shop so the rendered HTML carries its name, location, and
  // categories — the indexable content that lets the page rank / deep-link.
  loader: async ({ context, params }) => {
    const shop = await context.queryClient.ensureQueryData(
      context.trpc.parks.shop.queryOptions({ slug: params.slug }),
    );
    if (!shop) throw notFound();
    return { name: shop.name, land: shop.land, parkResort: shop.parkResort };
  },
  head: ({ params, loaderData }) => {
    const name = loaderData?.name ?? titleizeSlug(params.slug);
    const where = loaderData?.parkResort ?? loaderData?.land ?? "Walt Disney World";
    return seo({
      title: `${name} — Shopping at ${where} | ParkFi`,
      description: `${name} at ${where}. Location, merchandise categories, and hours for this Walt Disney World shop on ParkFi.`,
      path: `/shop/${params.slug}`,
    });
  },
});

function ShopPage() {
  const { slug } = Route.useParams();
  const trpc = useTRPC();
  const { data: shop } = useQuery(trpc.parks.shop.queryOptions({ slug }));

  const name = shop?.name ?? titleizeSlug(slug);

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-6 max-md:text-sidebar-foreground">
      <div>
        <Link
          to="/map"
          className="text-muted-foreground hover:text-foreground max-md:text-sidebar-foreground/80 text-sm"
        >
          ← Back to map
        </Link>
        <h1 className="mt-2 flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <ShoppingBagIcon className="text-muted-foreground size-6 shrink-0" />
          {name}
        </h1>
        {(shop?.land || shop?.parkResort) && (
          <p className="text-muted-foreground mt-1 flex items-center gap-1 text-sm max-md:text-sidebar-foreground/80">
            <MapPinIcon className="size-4 shrink-0" />
            {[shop?.land, shop?.parkResort].filter(Boolean).join(" · ")}
          </p>
        )}
      </div>

      {shop?.imageUrl && (
        <img
          src={shop.imageUrl}
          alt={name}
          className="aspect-[16/9] w-full rounded-2xl object-cover shadow-sm"
          loading="lazy"
        />
      )}

      {shop && shop.merchandise.length > 0 && (
        <div className="rounded-lg border bg-card text-card-foreground p-4">
          <p className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
            Merchandise
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {shop.merchandise.map((m) => (
              <span
                key={m}
                className="bg-muted text-muted-foreground rounded-full px-2.5 py-1 text-xs font-medium"
              >
                {humanizeFacet(m)}
              </span>
            ))}
          </div>
        </div>
      )}

      {shop?.detailUrl && (
        <a
          href={shop.detailUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="btn-3d-outline border-3d shadow-3d inline-flex items-center gap-1.5 rounded-full bg-background px-4 py-2 text-sm font-medium transition active:scale-95 dark:border-border"
        >
          Official page
          <ArrowUpRightIcon className="text-muted-foreground size-4" />
        </a>
      )}
    </div>
  );
}
