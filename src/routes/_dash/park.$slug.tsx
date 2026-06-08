import { createFileRoute } from "@tanstack/react-router";
import { motion } from "motion/react";

import { ParkDashboard } from "#/components/park-dashboard/park-dashboard.tsx";

export const Route = createFileRoute("/_dash/park/$slug")({ component: ParkPage });

function ParkPage() {
  const { slug } = Route.useParams();
  return (
    <motion.div
      key={slug}
      initial={{ opacity: 0, x: 16 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ type: "spring", stiffness: 220, damping: 28 }}
    >
      <ParkDashboard parkSlug={slug} />
    </motion.div>
  );
}
