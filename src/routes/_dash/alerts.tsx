import { createFileRoute } from "@tanstack/react-router";
import { NotificationBell } from "#/components/notifications/notification-bell";

export const Route = createFileRoute("/_dash/alerts")({
  component: AlertsPage,
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
            Receive alerts on this device even when the app is closed.
          </p>
        </div>
        <NotificationBell />
      </div>

      <p className="text-muted-foreground text-xs">
        Per-attraction and per-park alert rules coming soon.
      </p>
    </div>
  );
}
