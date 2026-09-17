import { createFileRoute } from "@tanstack/react-router";
import { isServer, useQuery } from "@tanstack/react-query";

import { RideDetail } from "#/components/park-dashboard/ride-detail.tsx";
import { JsonLd } from "#/components/seo/json-ld.tsx";
import { useTRPC } from "#/integrations/trpc/react.ts";
import {
  actionRow,
  canEmbedMedia,
  container,
  discordComponentEmbed,
  linkButton,
  section,
  separator,
  text,
  thumbnail,
} from "#/lib/discord-embed.ts";
import {
  SITE_URL,
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
        context.trpc.parks.rideCrowd.queryOptions({ attractionId: ride.id }),
      );
    }
    return {
      name: ride?.name ?? null,
      parkName: ride?.park.name ?? null,
      operatorSlug: ride?.park.operatorSlug ?? null,
      standbyWait: ride?.standbyWait ?? null,
      description: ride?.meta?.description ?? null,
      // Thumbnail for the Discord component embed. Same source the page's
      // JSON-LD uses; `head()` can't reach into the query cache, so carry it.
      imageUrl: ride?.meta?.imageHeroUrl ?? ride?.meta?.imageThumbUrl ?? null,
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
      // First route to carry a Discord component embed — see `lib/discord-embed.ts`.
      // Purely additive: the OG tags above still render whenever Discord rejects
      // or ignores this. Deliberately no wait number in the headline — Discord
      // caches a preview for ~30 minutes and the shared URL is the cache key, so
      // there's no version trick (unlike `og:image`) to keep a figure honest.
      scripts: discordComponentEmbed(
        container([
          canEmbedMedia(loaderData?.imageUrl)
            ? section(
                [text(`## [${name}](${SITE_URL}${path})\n${parkName}`)],
                thumbnail(loaderData.imageUrl, name),
              )
            : text(`## [${name}](${SITE_URL}${path})\n${parkName}`),
          text(
            wait != null
              ? `**${wait} min** standby at last check · ${lineLabel} status and wait history on the ride page.`
              : `Live standby wait, ride status, and ${lineLabel} availability.`,
          ),
          separator(),
          actionRow(
            linkButton(`All ${parkName} waits`, `/park/${params.slug}`),
            linkButton("Crowd forecast", "/predictions"),
          ),
        ]),
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
