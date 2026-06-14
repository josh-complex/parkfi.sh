import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { motion } from "motion/react";

import { ParkDashboard } from "#/components/park-dashboard/park-dashboard.tsx";
import { JsonLd } from "#/components/seo/json-ld.tsx";
import { useTRPC } from "#/integrations/trpc/react.ts";
import { amusementParkJsonLd, breadcrumbJsonLd, seo } from "#/lib/seo.ts";

/** "magic-kingdom" -> "Magic Kingdom" for a readable, indexable title. */
function titleizeSlug(slug: string): string {
  return slug
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

export const Route = createFileRoute("/_dash/park/$slug")({
  component: ParkPage,
  // SSR-prefetch this park's board so the rendered HTML carries the full ride
  // list, live waits, and status — the indexable content that makes a park page
  // rank. Without this the server ships an empty "Loading park…" shell, and the
  // client refetch hits /api/trpc which robots.txt disallows, so crawlers see
  // nothing either way.
  loader: async ({ context, params }) => {
    await context.queryClient.ensureQueryData(
      context.trpc.parks.board.queryOptions({ parkSlug: params.slug }),
    );
  },
  head: ({ params }) => {
    const name = titleizeSlug(params.slug);
    return seo({
      title: `${name} Wait Times & Live Map — ParkFi`,
      description: `Live wait times, ride status, and Lightning Lane availability for ${name}. Plan your day with real-time queue data on ParkFi.`,
      path: `/park/${params.slug}`,
      image: `/og/park/${params.slug}/card.png`,
      imageWidth: 1200,
      imageHeight: 630,
    });
  },
});

function ParkPage() {
  const { slug } = Route.useParams();
  const trpc = useTRPC();
  // Cache hit — `parks.list` is prefetched by the `_dash` loader, so this reads
  // synchronously at SSR and lets the structured data ship in the initial HTML.
  const { data: parks } = useQuery(trpc.parks.list.queryOptions());
  const park = parks?.find((p) => p.slug === slug);
  const name = park?.name ?? titleizeSlug(slug);

  return (
    <motion.div
      key={slug}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.25 }}
    >
      <JsonLd
        data={amusementParkJsonLd({
          name,
          slug,
          description: `Live wait times, ride status, and Lightning Lane availability for ${name}.`,
          latitude: park?.latitude,
          longitude: park?.longitude,
        })}
      />
      <JsonLd
        data={breadcrumbJsonLd([
          { name: "Home", path: "/" },
          { name, path: `/park/${slug}` },
        ])}
      />
      <ParkDashboard parkSlug={slug} />
    </motion.div>
  );
}
