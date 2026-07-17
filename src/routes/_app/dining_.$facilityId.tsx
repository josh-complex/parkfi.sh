import * as React from "react";
import { createFileRoute, useRouterState } from "@tanstack/react-router";
import { isServer, useQuery } from "@tanstack/react-query";

import { validateDiningSearch } from "#/components/dining/dining-search-params.ts";
import { DiningVenueDetail } from "#/components/dining/dining-venue-detail.tsx";
import { JsonLd } from "#/components/seo/json-ld.tsx";
import { useAchievementTrack } from "#/hooks/use-achievement-track.ts";
import { useTRPC } from "#/integrations/trpc/react.ts";
import { breadcrumbJsonLd, restaurantJsonLd, seo } from "#/lib/seo.ts";

export const Route = createFileRoute("/_app/dining_/$facilityId")({
  component: VenuePage,
  // Carries the dining search that led here (cuisine, park, …) so the breadcrumb
  // can show the full trail and link back to the filtered list.
  validateSearch: validateDiningSearch,
  // SSR-prefetch the venue header + its menu so the rendered HTML carries the
  // indexable content (and the menu deep-link target is present before JS runs).
  // Server: await the venue — it feeds `head()` and the SSR'd markup. Client:
  // fire-and-forget everything so tapping a restaurant card never freezes the
  // list on the venue fetch; DiningVenueDetail owns its loading skeleton.
  loader: async ({ context, params }) => {
    const venueOptions = context.trpc.dining.venue.queryOptions({
      facilityId: params.facilityId,
    });
    void context.queryClient.prefetchQuery(
      context.trpc.dining.menu.queryOptions({ facilityId: params.facilityId }),
    );
    // Today's operating hours back the SSR'd open-now chip (indexable, no flash).
    void context.queryClient.prefetchQuery(context.trpc.dining.hours.queryOptions({}));
    if (!isServer) {
      void context.queryClient.prefetchQuery(venueOptions);
      return;
    }
    const venue = await context.queryClient.ensureQueryData(venueOptions);
    return {
      name: venue?.name ?? null,
      cuisine: venue?.cuisine ?? null,
      parkResort: venue?.parkResort ?? null,
    };
  },
  head: ({ params, loaderData }) => {
    const name = loaderData?.name ?? "Restaurant";
    // Anchor the copy to the venue's actual location instead of the generic
    // "Walt Disney World and Universal Orlando".
    const at = loaderData?.parkResort ? ` at ${loaderData.parkResort}` : "";
    return seo({
      title: `${name} — Menu & Reservations — ParkFi`,
      description: `Full menu, pricing, and live reservation availability for ${name}${at} on ParkFi.`,
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

  const track = useAchievementTrack();
  const trackedFacilityRef = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (trackedFacilityRef.current === facilityId) return;
    trackedFacilityRef.current = facilityId;
    track("menu_view");
  }, [facilityId, track]);

  // Menu-item deep links arrive as `#menu-<slug>`; pass the slug through so the
  // detail page scrolls to and highlights that item. A bare `#menu` (recently
  // updated shelf) scrolls to the menu section itself.
  const hash = useRouterState({ select: (s) => s.location.hash });
  const targetItemSlug = hash?.startsWith("menu-") ? hash.slice("menu-".length) : null;
  const scrollToMenu = hash === "menu";

  return (
    <>
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
        <DiningVenueDetail
          facilityId={facilityId}
          targetItemSlug={targetItemSlug}
          scrollToMenu={scrollToMenu}
        />
      </div>
    </>
  );
}
