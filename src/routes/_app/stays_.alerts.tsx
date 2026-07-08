import { Link, createFileRoute } from "@tanstack/react-router";

import { StayAlertsManager } from "#/components/stays/stay-alerts-manager.tsx";
import { Button } from "#/components/ui/button.tsx";
import { seo } from "#/lib/seo.ts";

export const Route = createFileRoute("/_app/stays_/alerts")({
  component: StayAlertsPage,
  head: () =>
    seo({
      title: "Stay Alerts — ParkFi",
      description: "Manage your Walt Disney World resort-availability email alerts.",
      path: "/stays/alerts",
      noindex: true,
    }),
});

function StayAlertsPage() {
  return (
    <div className="flex flex-1 flex-col">
      <div className="@container/main flex flex-1 flex-col gap-2">
        <div className="mx-auto w-full max-w-2xl space-y-5 px-4 py-8">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h1 className="text-xl font-semibold">Stay alerts</h1>
              <p className="text-muted-foreground text-sm">
                We'll email you when a resort opens up or drops below your price.
              </p>
            </div>
            <Button variant="outline" size="sm" render={<Link to="/stays" />}>
              Find a resort
            </Button>
          </div>
          <StayAlertsManager />
        </div>
      </div>
    </div>
  );
}
