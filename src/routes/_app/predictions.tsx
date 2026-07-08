import * as React from "react";
import { createFileRoute } from "@tanstack/react-router";

import { MaintenanceGate } from "#/components/maintenance-gate.tsx";
import { PredictionsDashboard } from "#/components/predictions/predictions-dashboard.tsx";
import { useAchievementTrack } from "#/hooks/use-achievement-track.ts";
import { seo } from "#/lib/seo.ts";

export const Route = createFileRoute("/_app/predictions")({
  component: PredictionsPage,
  head: () =>
    seo({
      title: "Theme Park Wait-Time Forecasts & Crowd Calendar — ParkFi",
      description:
        "Predicted ride wait times and a daily crowd index for Walt Disney World and Universal Orlando, backtested against real waits for honest accuracy.",
      keywords:
        "Disney World crowd calendar, theme park wait time prediction, Universal Orlando crowd forecast, ride wait forecast",
      path: "/predictions",
    }),
});

function PredictionsPage() {
  const track = useAchievementTrack();
  const trackedRef = React.useRef(false);
  React.useEffect(() => {
    if (trackedRef.current) return;
    trackedRef.current = true;
    track("forecast_view");
  }, [track]);

  return (
    <MaintenanceGate feature="predictions" title="Forecasts are under maintenance">
      <div className="flex flex-1 flex-col">
        <div className="@container/main flex flex-1 flex-col gap-2">
          <PredictionsDashboard />
        </div>
      </div>
    </MaintenanceGate>
  );
}
