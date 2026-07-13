"use client";

import { toast } from "sonner";

import { formatRideRecap } from "#/lib/ride-recap.ts";
import type { RideMetrics } from "#/lib/ride-metrics.ts";

/**
 * Post-ride summary toast (B6). Fired when the native recorder detects a ride
 * and the server accepts it — before any achievement-unlock toasts, which the
 * tracker funnels separately through `showUnlockToasts`.
 */
export function showRideRecapToast(metrics: RideMetrics): void {
  toast("🎢 Ride recorded", {
    id: `ride-recap:${metrics.startedAt}`,
    description: formatRideRecap(metrics),
    duration: 6000,
  });
}
