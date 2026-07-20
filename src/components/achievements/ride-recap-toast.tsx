"use client";

import { toast } from "sonner";

import { shareContent } from "#/lib/native-share.ts";
import { formatRideRecap } from "#/lib/ride-recap.ts";
import type { RideMetrics } from "#/lib/ride-metrics.ts";

/**
 * Post-ride summary toast (B6). Fired when the native recorder detects a ride
 * and the server accepts it — before any achievement-unlock toasts, which the
 * tracker funnels separately through `showUnlockToasts`.
 *
 * A just-detected ride is a peak brag moment, so the toast carries a Share
 * action → the OS share sheet (native) / Web Share / clipboard (web). Free
 * acquisition loop with zero extra taps to earn it.
 */
export function showRideRecapToast(metrics: RideMetrics): void {
  const recap = formatRideRecap(metrics);
  toast("🎢 Ride recorded", {
    id: `ride-recap:${metrics.startedAt}`,
    description: recap,
    duration: 6000,
    action: {
      label: "Share",
      onClick: () => {
        void shareContent({
          title: "ParkFi",
          text: `🎢 Just rode it — ${recap}. Tracked automatically by ParkFi.`,
          url: "https://parkfi.sh",
          dialogTitle: "Share your ride",
        });
      },
    },
  });
}
