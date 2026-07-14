import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeftIcon, ExternalLinkIcon, MapPinIcon, ShoppingBagIcon } from "lucide-react";

import { RemovalRequestDialog } from "#/components/removal-request-dialog.tsx";
import { Image } from "#/components/ui/image.tsx";
import { useTRPC } from "#/integrations/trpc/react.ts";
import { seo } from "#/lib/seo.ts";

/** "gateway-gifts" -> "Gateway Gifts" for a readable, indexable fallback title. */
function titleizeSlug(slug: string): string {
  return slug
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

/** "apparel-accessories" -> "Apparel & Accessories" for the merchandise chips. */
function humanizeFacet(facet: string): string {
  return facet
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ")
    .replace(/\band\b/gi, "&");
}

export const Route = createFileRoute("/_app/_dash/shop/$slug")({
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
      description: `${name} at ${where}. Location, merchandise categories, and store details for this Walt Disney World shop on ParkFi.`,
      path: `/shop/${params.slug}`,
    });
  },
});

function ShopPage() {
  const { slug } = Route.useParams();
  const trpc = useTRPC();
  const { data: shop } = useQuery(trpc.parks.shop.queryOptions({ slug }));

  const name = shop?.name ?? titleizeSlug(slug);
  const location = [shop?.land, shop?.parkResort].filter(Boolean).join(" · ");

  return (
    <div className="mx-auto w-full max-w-2xl p-4 sm:p-6">
      <div className="mb-3 flex items-center justify-between gap-3">
        <Link
          to="/map"
          className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 text-sm font-medium transition-colors max-md:text-white/90 max-md:hover:text-white"
        >
          <ArrowLeftIcon className="size-4" />
          Back to map
        </Link>
        {shop && (
          <RemovalRequestDialog entityType="shop" entityId={shop.id} entityName={shop.name} />
        )}
      </div>

      {/* Self-contained card so the page reads correctly on any inset surface
          (the mobile dashboard gutter is colored; bg-card owns its own contrast). */}
      <article className="overflow-hidden rounded-3xl border bg-card text-card-foreground shadow-sm">
        {/* Hero — the shop's photo, or a themed placeholder when the finder feed
            carries no media (many carts/kiosks and smaller shops don't). */}
        {shop?.imageUrl ? (
          <Image
            src={shop.imageUrl}
            alt={name}
            className="aspect-[16/9] w-full object-cover"
            loading="eager"
          />
        ) : (
          <div className="from-muted to-muted/40 flex aspect-[16/9] w-full items-center justify-center bg-gradient-to-br">
            <ShoppingBagIcon className="text-muted-foreground/40 size-16" />
          </div>
        )}

        <div className="space-y-5 p-5 sm:p-6">
          <div className="space-y-1.5">
            <span className="text-muted-foreground inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide">
              <ShoppingBagIcon className="size-3.5" />
              Shop
            </span>
            <h1 className="text-2xl font-semibold leading-tight tracking-tight sm:text-3xl">
              {name}
            </h1>
            {location && (
              <p className="text-muted-foreground flex items-center gap-1.5 text-sm">
                <MapPinIcon className="size-4 shrink-0" />
                {location}
              </p>
            )}
          </div>

          {shop && shop.merchandise.length > 0 && (
            <div className="space-y-2">
              <h2 className="text-muted-foreground text-xs font-semibold uppercase tracking-wide">
                What you'll find
              </h2>
              <div className="flex flex-wrap gap-2">
                {shop.merchandise.map((m) => (
                  <span key={m} className="bg-muted rounded-full px-3 py-1 text-xs font-medium">
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
              className="btn-3d-outline border-3d shadow-3d inline-flex items-center gap-2 rounded-full bg-background px-4 py-2.5 text-sm font-medium transition active:scale-95 dark:border-[color-mix(in_oklch,var(--border),white_25%)]"
            >
              <ExternalLinkIcon className="size-4" />
              View on the official site
            </a>
          )}
        </div>
      </article>
    </div>
  );
}
