import { Link, createFileRoute } from "@tanstack/react-router";

import { PageBody, PageMasthead } from "#/components/site-chrome/page-masthead.tsx";
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
    <>
      <PageMasthead
        kicker="Watching for you"
        title="Stay alerts"
        description="We sweep the resorts you're watching and email you the moment one opens up for your dates — or drops below your price."
        actions={
          <Button variant="yellow" size="sm" render={<Link to="/stays" />}>
            Find a resort
          </Button>
        }
      />
      <PageBody size="form">
        <StayAlertsManager />
      </PageBody>
    </>
  );
}
