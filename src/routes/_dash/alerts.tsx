import { createFileRoute } from "@tanstack/react-router";
import { AlertsManager } from "#/components/notifications/alerts-manager";
import { NotificationBell } from "#/components/notifications/notification-bell";
import { seo } from "#/lib/seo.ts";

export const Route = createFileRoute("/_dash/alerts")({
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
    <div className="p-6 max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Alerts</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Manage push notifications for wait times, Lightning Lane availability, and price drops.
        </p>
      </div>

      <div className="rounded-lg border p-4 flex items-center justify-between">
        <div>
          <p className="font-medium text-sm">Push notifications</p>
          <p className="text-muted-foreground text-xs mt-0.5">
            Receive alerts on this device even when the app is closed. Required for ride alerts to
            reach you.
          </p>
        </div>
        <NotificationBell />
      </div>

      <div className="space-y-3">
        <div>
          <h2 className="text-lg font-medium tracking-tight">Ride alerts</h2>
          <p className="text-muted-foreground text-xs mt-0.5">
            Track up to 3 rides per park. Add alerts from any park’s ride board.
          </p>
        </div>
        <AlertsManager />
      </div>
    </div>
  );
}
