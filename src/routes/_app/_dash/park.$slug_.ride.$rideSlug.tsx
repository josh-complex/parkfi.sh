import { createFileRoute } from "@tanstack/react-router";
import { isServer, useQuery } from "@tanstack/react-query";

import { paidLineInfo } from "#/components/park-dashboard/lightning-lane.ts";
import { RideDetail } from "#/components/park-dashboard/ride-detail.tsx";
import { RIDE_CURVE_STEP } from "#/components/park-dashboard/today-curve.tsx";
import { JsonLd } from "#/components/seo/json-ld.tsx";
import { useTRPC } from "#/integrations/trpc/react.ts";
import { discordComponentEmbed, linkButton, linkPreview } from "#/lib/discord-embed.ts";
import { heroLoopUrl } from "#/lib/hero-loops.ts";
import {
  attractionJsonLd,
  breadcrumbJsonLd,
  liveCardVersion,
  seo,
  truncateMeta,
} from "#/lib/seo.ts";

/**
 * Status in plain words for embed copy. Mirrors the hero pill's wording in
 * `ride-detail.tsx`, minus "Status unknown" — a shared link shouldn't lead with
 * a shrug, so an unknown status just drops out of the line.
 */
const EMBED_STATUS_LABEL: Record<string, string> = {
  OPERATING: "Open",
  DOWN: "Temporarily down",
  REFURBISHMENT: "Refurbishment",
  CLOSED: "Closed",
};

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
      // Facts the generated card would have carried. Rides with a hero loop
      // spend their card slot on the loop instead, so the embed's copy has to
      // say them in words — see the `loop` branch in `head()`.
      status: ride?.status ?? null,
      height: ride?.meta?.heightRequirement ?? null,
      lineProduct: ride ? (paidLineInfo(ride, ride.park.operatorSlug).product ?? null) : null,
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
    // The published hero loop, if this ride has one. Keyed on the slug alone so
    // it resolves before loader data lands.
    const loop = heroLoopUrl(params.rideSlug);
    // What the generated card draws, as words — bold on the wait because it's
    // the figure people share the link for.
    const meta = [
      wait != null ? `**${wait} min** standby now` : null,
      loaderData?.status ? EMBED_STATUS_LABEL[loaderData.status] : null,
      loaderData?.lineProduct,
      loaderData?.height,
    ].filter(Boolean);
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
      //
      // Rides with a published hero loop (15 of them) spend the card slot on
      // the loop rather than the generated card: video in a gallery never
      // autoplays, but animated WebP does, and a moving card is worth more than
      // a static one. The facts the card would have drawn move into the copy,
      // and the photo grid is dropped — a loop runs 1-2.5 MB against the same
      // 10s budget Discord measures the whole preview in, so it can't share the
      // embed with three more images.
      //
      // Either way the figures are as fresh as the fetch: Discord caches a
      // preview ~30 minutes keyed on the shared URL, so a number here goes
      // stale exactly as fast as one drawn into the card ever did.
      scripts: discordComponentEmbed(
        linkPreview({
          title: name,
          url: path,
          subtitle: [loaderData?.land, parkName].filter(Boolean).join(" · "),
          body: loop
            ? [meta.join(" · "), `${lineLabel} status, standby history, and wait alerts.`]
                .filter(Boolean)
                .join("\n")
            : `${lineLabel} status, standby history, and wait alerts.`,
          card:
            loop ?? `/og/ride/${params.slug}/${params.rideSlug}/card.jpg?v=${liveCardVersion()}`,
          photos: loop ? [] : loaderData?.photos,
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
