import { createFileRoute, useRouterState } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";

import { AppInset } from "#/components/app-inset.tsx";
import { AppSidebar } from "#/components/app-sidebar.tsx";
import { DiningVenueDetail } from "#/components/dining/dining-venue-detail.tsx";
import { JsonLd } from "#/components/seo/json-ld.tsx";
import { SiteHeader } from "#/components/site-header.tsx";
import { SidebarProvider } from "#/components/ui/sidebar.tsx";
import { useTRPC } from "#/integrations/trpc/react.ts";
import { breadcrumbJsonLd, restaurantJsonLd, seo } from "#/lib/seo.ts";

export const Route = createFileRoute("/dining_/$facilityId")({
  component: VenuePage,
  // SSR-prefetch the venue header + its menu so the rendered HTML carries the
  // indexable content (and the menu deep-link target is present before JS runs).
  loader: async ({ context, params }) => {
    const venue = await context.queryClient.ensureQueryData(
      context.trpc.dining.venue.queryOptions({ facilityId: params.facilityId }),
    );
    void context.queryClient.prefetchQuery(
      context.trpc.dining.menu.queryOptions({ facilityId: params.facilityId }),
    );
    return { name: venue?.name ?? null, cuisine: venue?.cuisine ?? null };
  },
  head: ({ params, loaderData }) => {
    const name = loaderData?.name ?? "Restaurant";
    return seo({
      title: `${name} — Menu & Reservations — ParkFi`,
      description: `Full menu, pricing, and live reservation availability for ${name} at Walt Disney World and Universal Orlando on ParkFi.`,
      path: `/dining/${params.facilityId}`,
      image: `/og/dining/${params.facilityId}/card.png`,
      imageWidth: 1200,
      imageHeight: 630,
    });
  },
});

function VenuePage() {
  const { facilityId } = Route.useParams();
  const trpc = useTRPC();
  const { data: venue } = useQuery(trpc.dining.venue.queryOptions({ facilityId }));

  // Menu-item deep links arrive as `#menu-<slug>`; pass the slug through so the
  // detail page scrolls to and highlights that item.
  const hash = useRouterState({ select: (s) => s.location.hash });
  const targetItemSlug = hash?.startsWith("menu-") ? hash.slice("menu-".length) : null;

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
        <SiteHeader title="Dining" mobileTitle={venue?.name ?? undefined} />
        {venue && (
          <>
            <JsonLd
              data={restaurantJsonLd({
                facilityId,
                name: venue.name,
                cuisine: venue.cuisine,
                priceRange: venue.priceRange,
                image: venue.imageUrl,
              })}
            />
            <JsonLd
              data={breadcrumbJsonLd([
                { name: "Dining", path: "/dining" },
                { name: venue.name, path: `/dining/${facilityId}` },
              ])}
            />
          </>
        )}
        <div className="flex flex-1 flex-col">
          <DiningVenueDetail facilityId={facilityId} targetItemSlug={targetItemSlug} />
        </div>
      </AppInset>
    </SidebarProvider>
  );
}
