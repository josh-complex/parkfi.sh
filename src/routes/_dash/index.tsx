import { createFileRoute } from "@tanstack/react-router";
import { motion } from "motion/react";

import { OverviewPanel } from "#/components/park-dashboard/overview-panel.tsx";
import { MapSlot } from "#/components/park-map/map-stage.tsx";

export const Route = createFileRoute("/_dash/")({ component: Overview });

function Overview() {
  return (
    // Opacity-only entrance: a translate would shift the MapSlot's measured rect
    // and throw off the shared-map morph.
    <motion.div
      className="flex min-h-0 flex-1 flex-col lg:flex-row"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.25 }}
    >
      {/* Wide map hero next to the resort summary. */}
      <MapSlot className="relative h-64 shrink-0 overflow-hidden border-b lg:h-auto lg:w-[60%] lg:border-b-0 lg:border-r" />
      <div className="min-w-0 flex-1 overflow-auto">
        <div className="@container/main flex flex-1 flex-col gap-2">
          <OverviewPanel />
        </div>
      </div>
    </motion.div>
  );
}
