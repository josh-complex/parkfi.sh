import { createFileRoute } from "@tanstack/react-router";
import { motion } from "motion/react";

import { ParkDashboard } from "#/components/park-dashboard/park-dashboard.tsx";

export const Route = createFileRoute("/_dash/park/$slug")({ component: ParkPage });

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
