import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { motion } from "motion/react";

import { RideDetail } from "#/components/park-dashboard/ride-detail.tsx";
import { JsonLd } from "#/components/seo/json-ld.tsx";
import { useTRPC } from "#/integrations/trpc/react.ts";
import { attractionJsonLd, breadcrumbJsonLd, seo } from "#/lib/seo.ts";

/** "space-mountain" -> "Space Mountain" for a readable, indexable title. */
function titleizeSlug(slug: string): string {
  return slug
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

export const Route = createFileRoute("/_dash/park/$slug_/ride/$rideSlug")({
  component: RidePage,
  // SSR-prefetch the ride so the rendered HTML carries live status/waits — the
  // indexable content. Without it crawlers (and the client refetch via the
  // robots-disallowed /api/trpc) see an empty shell.
  loader: async ({ context, params }) => {
    const ride = await context.queryClient.ensureQueryData(
      context.trpc.parks.attraction.queryOptions({
        parkSlug: params.slug,
        rideSlug: params.rideSlug,
      }),
    );
    return {
      name: ride?.name ?? null,
      parkName: ride?.park.name ?? null,
      operatorSlug: ride?.park.operatorSlug ?? null,
      standbyWait: ride?.standbyWait ?? null,
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
    return seo({
      title: `${name} Wait Times${isUniversal ? "" : " & Lightning Lane"} — ${parkName} — ParkFi`,
      description: `${waitLede}Live standby wait, ride status, and ${lineLabel} availability for ${name} at ${parkName}. Track it in real time on ParkFi.`,
      path: `/park/${params.slug}/ride/${params.rideSlug}`,
      image: `/og/ride/${params.slug}/${params.rideSlug}/card.png`,
      imageWidth: 1200,
      imageHeight: 630,
    });
  },
});

function RidePage() {
  const { slug, rideSlug } = Route.useParams();
  const trpc = useTRPC();
  const { data: ride } = useQuery(trpc.parks.attraction.queryOptions({ parkSlug: slug, rideSlug }));

  return (
    <motion.div
      key={`${slug}/${rideSlug}`}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.25 }}
    >
      {ride && (
        <>
          <JsonLd
            data={attractionJsonLd({
              parkSlug: slug,
              rideSlug,
              name: ride.name,
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
      <RideDetail parkSlug={slug} rideSlug={rideSlug} />
    </motion.div>
  );
}
