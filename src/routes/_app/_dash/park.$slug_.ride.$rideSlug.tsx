import { createFileRoute } from "@tanstack/react-router";
import { isServer, useQuery } from "@tanstack/react-query";

import { RideDetail } from "#/components/park-dashboard/ride-detail.tsx";
import { RIDE_CURVE_STEP } from "#/components/park-dashboard/today-curve.tsx";
import { JsonLd } from "#/components/seo/json-ld.tsx";
import { useTRPC } from "#/integrations/trpc/react.ts";
import { discordComponentEmbed, linkButton, linkPreview } from "#/lib/discord-embed.ts";
import {
  attractionJsonLd,
  breadcrumbJsonLd,
  liveCardVersion,
  seo,
  truncateMeta,
} from "#/lib/seo.ts";

/** "space-mountain" -> "Space Mountain" for a readable, indexable title. */
function titleizeSlug(slug: string): string {
  return slug
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

export const Route = createFileRoute("/_app/_dash/park/$slug_/ride/$rideSlug")({
  component: RidePage,
  // SSR-prefetch the ride so the rendered HTML carries live status/waits — the
  // indexable content. Without it crawlers (and the client refetch via the
  // robots-disallowed /api/trpc) see an empty shell.
  loader: async ({ context, params }) => {
    const options = context.trpc.parks.attraction.queryOptions({
      parkSlug: params.slug,
      rideSlug: params.rideSlug,
    });
    if (!isServer) {
      // Client: warm the cache and render immediately — RideDetail owns its own
      // skeleton, so don't freeze the previous page on the attraction fetch.
      // `head()` falls back to titleized slugs until data lands.
      void context.queryClient.prefetchQuery(options);
      return;
    }
    const ride = await context.queryClient.ensureQueryData(options);
    // The wash panel is the page's job block, and it draws this — so ship it in
    // the SSR'd markup rather than letting a grey slab sit under the ticket
    // until the client fetch lands (the venue page's hours prefetch, over a
    // ride's day). Not awaited: the page renders without it.
    if (ride?.id) {
      void context.queryClient.prefetchQuery(
        context.trpc.parks.rideCrowd.queryOptions({ attractionId: ride.id, step: RIDE_CURVE_STEP }),
      );
    }
    return {
      name: ride?.name ?? null,
      parkName: ride?.park.name ?? null,
      operatorSlug: ride?.park.operatorSlug ?? null,
      standbyWait: ride?.standbyWait ?? null,
      description: ride?.meta?.description ?? null,
      land: ride?.meta?.land ?? null,
      // Ride stills for the Discord component embed's photo grid. `head()`
      // can't reach into the query cache, so carry them through the loader.
      // Videos are dropped: a component embed can't play one.
      photos: (ride?.meta?.heroMedia ?? [])
        .filter((slide) => slide.kind === "image")
        .map((slide) => slide.url),
    };
  },
  head: ({ params, loaderData }) => {
    const name = loaderData?.name ?? titleizeSlug(params.rideSlug);
    const parkName = loaderData?.parkName ?? titleizeSlug(params.slug);
    // Universal rides have no Lightning Lane — only a free Virtual Line. Disney
    // rides advertise Lightning Lane. Keep that out of Universal copy.
    const isUniversal = loaderData?.operatorSlug === "universal";
    const lineLabel = isUniversal ? "Virtual Line" : "Lightning Lane";
    const wait = loaderData?.standbyWait;
    const waitLede = wait != null ? `Now ${wait} min standby. ` : "";
    // Official copy (plan item 2.3) beats the template blurb when we have it.
    const about = loaderData?.description ? ` ${truncateMeta(loaderData.description)}` : "";
    const path = `/park/${params.slug}/ride/${params.rideSlug}`;
    return {
      ...seo({
        title: `${name} Wait Times${isUniversal ? "" : " & Lightning Lane"} — ${parkName} — ParkFi`,
        description: `${waitLede}Live standby wait, ride status, and ${lineLabel} availability for ${name} at ${parkName}.${about}`,
        path,
        image: `/og/ride/${params.slug}/${params.rideSlug}/card.jpg?v=${liveCardVersion()}`,
        imageWidth: 1200,
        imageHeight: 630,
      }),
      // Discord component embed — see `lib/discord-embed.ts`. Purely additive:
      // the OG tags above still render whenever Discord rejects or ignores it.
      // No wait number in the copy on purpose — Discord caches a preview for
      // ~30 minutes keyed on the shared URL, so there's no version trick (the
      // way `og:image` has one) to keep a figure honest. The generated card
      // carries the live chips and re-renders when the cache turns over.
      scripts: discordComponentEmbed(
        linkPreview({
          title: name,
          url: path,
          subtitle: [loaderData?.land, parkName].filter(Boolean).join(" · "),
          body: `${lineLabel} status, standby history, and wait alerts.`,
          card: `/og/ride/${params.slug}/${params.rideSlug}/card.jpg?v=${liveCardVersion()}`,
          photos: loaderData?.photos,
          buttons: [
            linkButton(`All ${parkName} waits`, `/park/${params.slug}`),
            linkButton("Live map", "/map"),
          ],
        }),
      ),
    };
  },
});

function RidePage() {
  const { slug, rideSlug } = Route.useParams();
  const trpc = useTRPC();
  const { data: ride } = useQuery(trpc.parks.attraction.queryOptions({ parkSlug: slug, rideSlug }));

  return (
    <>
      {ride && (
        <>
          <JsonLd
            data={attractionJsonLd({
              parkSlug: slug,
              rideSlug,
              name: ride.name,
              description: ride.meta?.description ?? undefined,
              parkName: ride.park.name,
              latitude: ride.latitude,
              longitude: ride.longitude,
              image: ride.meta?.imageHeroUrl ?? ride.meta?.imageThumbUrl,
            })}
          />
          <JsonLd
            data={breadcrumbJsonLd([
              { name: "Home", path: "/" },
              { name: ride.park.name, path: `/park/${slug}` },
              { name: ride.name, path: `/park/${slug}/ride/${rideSlug}` },
            ])}
          />
        </>
      )}
      {/* `flex-1`, as the venue page's wrapper is: the hero runs up behind the
          desktop nav capsule, so the page body owns the column from the top of
          the viewport down. */}
      <div className="flex flex-1 flex-col">
        <RideDetail parkSlug={slug} rideSlug={rideSlug} />
      </div>
    </>
  );
}
