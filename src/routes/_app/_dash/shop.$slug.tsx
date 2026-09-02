import { createFileRoute, notFound } from "@tanstack/react-router";
import { isServer, useQuery } from "@tanstack/react-query";
import { useEffect, useLayoutEffect } from "react";
import { ExternalLinkIcon, ShoppingBagIcon } from "lucide-react";

import { DetailHero, HERO_OVERLAY_TOP } from "#/components/detail-hero.tsx";
import {
  heroFlightKey,
  launchHeroReturn,
  releaseHeroFlight,
  useHeroFlight,
} from "#/components/park-map/card-flight.ts";
import { WalkThereButton } from "#/components/park-map/walk-there-button.tsx";
import { RemovalRequestDialog } from "#/components/removal-request-dialog.tsx";
import { Badge } from "#/components/ui/badge.tsx";
import { useTRPC } from "#/integrations/trpc/react.ts";
import { seo } from "#/lib/seo.ts";
import { cn } from "#/lib/utils.ts";

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
  // Set when this page was opened by tapping a map POI card: the card's own
  // name, subtitle and photo, plus whether its flown clones are still in the
  // air (see `card-flight.ts`).
  const heroKey = heroFlightKey("shop", slug);
  const flight = useHeroFlight(heroKey);
  // Heading back to a map view, pop the hero down into its marker — a layout
  // effect so the cleanup can still measure the hero (see the ride page).
  useLayoutEffect(() => () => launchHeroReturn(heroKey), [heroKey]);
  useEffect(() => () => releaseHeroFlight(heroKey), [heroKey]);

  // Data → seed → titleized slug: the seeded values keep a map-launched hero
  // painted (and the flown clones honest) while the query is still in flight.
  const name = shop?.name ?? flight?.seed.name ?? titleizeSlug(slug);
  const subtitle = shop
    ? [shop.parkResort, shop.land && shop.land !== shop.parkResort ? shop.land : null]
        .filter(Boolean)
        .join(" · ")
    : (flight?.seed.subtitle ?? null);

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-4 lg:p-6">
      {/* Cast-member-only; renders nothing for everyone else, so it adds no gap. */}
      {shop && (
        <RemovalRequestDialog
          entityType="shop"
          entityId={shop.id}
          entityName={shop.name}
          className="hidden self-end md:inline-flex"
        />
      )}

      <header className="flex flex-col gap-4">
        {/* Identity hero, matching the ride/dining pages: the shop's photo (or
            a neutral gradient — many carts/kiosks publish no media), name +
            location overlaid, with a kind chip in place of live state. */}
        <DetailHero
          heroKey={heroKey}
          name={name}
          subtitle={subtitle}
          image={shop?.imageUrl ?? flight?.seed.imageUrl ?? null}
          // Identical across the seeded and loaded renders, so the underlay
          // <img> keeps its src (and stays decoded) across the query landing.
          underlay={flight ? (flight.seed.previewImageUrl ?? flight.seed.cardImageUrl) : null}
          thumbhash={shop?.imageThumbhash}
          flying={flight?.flying ?? false}
          entrance={!!flight}
          overlays={({ chipFx }) => (
            <span
              style={chipFx(0).style}
              className={cn(
                "absolute right-4 inline-flex items-center gap-1.5 rounded-full bg-black/70 px-2.5 py-1 text-xs font-semibold text-white backdrop-blur-sm",
                HERO_OVERLAY_TOP,
                chipFx(0).className,
              )}
            >
              <ShoppingBagIcon className="size-3.5" />
              Shop
            </span>
          )}
        />

        <div className="flex flex-col gap-3">
          {/* Official marketing copy (plan item 2.3). */}
          {shop?.description && (
            <p className="text-muted-foreground max-w-prose text-sm">{shop.description}</p>
          )}
          {shop && shop.merchandise.length > 0 && (
            <div className="flex flex-col gap-2">
              <h2 className="text-muted-foreground text-xs font-semibold uppercase tracking-wide">
                What you'll find
              </h2>
              <div className="flex flex-wrap items-center gap-1.5">
                {shop.merchandise.map((m) => (
                  <Badge key={m} variant="secondary">
                    {humanizeFacet(m)}
                  </Badge>
                ))}
              </div>
            </div>
          )}
          <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-2">
            {/* Walking-nav entry point (§4.2) — routes to this shop on the map. */}
            {shop && (
              <WalkThereButton
                name={shop.name}
                latitude={shop.latitude}
                longitude={shop.longitude}
              />
            )}
            {shop?.detailUrl && (
              <a
                href={shop.detailUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
              >
                View on the official site
                <ExternalLinkIcon className="size-3.5" />
              </a>
            )}
          </div>
        </div>
      </header>
    </div>
  );
}
