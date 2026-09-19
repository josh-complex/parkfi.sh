import { Link, createFileRoute } from "@tanstack/react-router";

import { DetailCard, WashPanel } from "#/components/detail/panels.tsx";
import { AlertsManager } from "#/components/notifications/alerts-manager";
import { NotificationBell } from "#/components/notifications/notification-bell";
import { PageBody, PageMasthead } from "#/components/site-chrome/page-masthead.tsx";
import { Button } from "#/components/ui/button.tsx";
import { seo } from "#/lib/seo.ts";

export const Route = createFileRoute("/_app/_dash/alerts")({
  component: AlertsPage,
  head: () =>
    seo({
      title: "Alerts & Push Notifications — ParkFi",
      description:
        "Manage push notifications for wait times, Lightning Lane availability, and ticket price drops.",
      path: "/alerts",
      noindex: true,
    }),
});

function AlertsPage() {
  return (
    <>
      <PageMasthead
        kicker="Watching for you"
        title="Ride alerts"
        description="Tell us the wait you're holding out for and we'll buzz this device the moment a queue drops to it."
        actions={
          <Button variant="ticket" size="sm" render={<Link to="/account/alerts" />}>
            All alert settings
          </Button>
        }
      />

      <PageBody size="form">
        {/* The page's job block: nothing below it can reach anyone until this
            device has said yes, so the permission key leads. */}
        <WashPanel title="Push notifications" meta="This device">
          <div className="flex items-center justify-between gap-3 rounded-2xl bg-background/70 px-3.5 py-3">
            <p className="min-w-0 text-sm text-muted-foreground">
              Alerts arrive even when the app is closed. Ride alerts can&rsquo;t reach you without
              it.
            </p>
            <div className="shrink-0">
              <NotificationBell />
            </div>
          </div>
        </WashPanel>

        <DetailCard
          title="Ride alerts"
          description="Up to 3 rides per park. Add an alert from any park's ride board, or from a ride's own page."
        >
          <AlertsManager />
        </DetailCard>
      </PageBody>
    </>
  );
}
