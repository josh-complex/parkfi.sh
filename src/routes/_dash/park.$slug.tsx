import { createFileRoute } from "@tanstack/react-router";
import { motion } from "motion/react";

import { ParkDashboard } from "#/components/park-dashboard/park-dashboard.tsx";
import { seo } from "#/lib/seo.ts";

/** "magic-kingdom" -> "Magic Kingdom" for a readable, indexable title. */
function titleizeSlug(slug: string): string {
  return slug
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

export const Route = createFileRoute("/_dash/park/$slug")({
  component: ParkPage,
  head: ({ params }) => {
    const name = titleizeSlug(params.slug);
    return seo({
      title: `${name} Wait Times & Live Map — ParkFish`,
      description: `Live wait times, ride status, and Lightning Lane availability for ${name}. Plan your day with real-time queue data on ParkFish.`,
      path: `/park/${params.slug}`,
    });
  },
});

function ParkPage() {
  const { slug } = Route.useParams();
  return (
    <motion.div
      key={slug}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.25 }}
    >
      <ParkDashboard parkSlug={slug} />
    </motion.div>
  );
}
