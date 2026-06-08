import { createFileRoute } from "@tanstack/react-router";
import { AnimatePresence, motion } from "motion/react";

import { OverviewPanel } from "#/components/park-dashboard/overview-panel.tsx";

export const Route = createFileRoute("/_dash/")({ component: Overview });

function Overview() {
  return (
    <AnimatePresence mode="wait">
      <motion.div
        key="overview"
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 8 }}
        transition={{ duration: 0.25 }}
      >
        <OverviewPanel />
      </motion.div>
    </AnimatePresence>
  );
}
