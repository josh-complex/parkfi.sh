import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { AlertsManager } from "#/components/notifications/alerts-manager.tsx";
import { DiningAlertsManager } from "#/components/dining/dining-alerts-manager.tsx";
import { NotificationBell } from "#/components/notifications/notification-bell.tsx";
import { StayAlertsManager } from "#/components/stays/stay-alerts-manager.tsx";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "#/components/ui/card.tsx";
import { Skeleton } from "#/components/ui/skeleton.tsx";
import { Switch } from "#/components/ui/switch.tsx";
import { useTRPC } from "#/integrations/trpc/react.ts";
import { authClient } from "#/lib/auth-client.ts";
import { seo } from "#/lib/seo.ts";

export const Route = createFileRoute("/_app/_dash/account/alerts")({
  component: AlertsPage,
  head: () =>
    seo({
      title: "Alerts — Account Settings — ParkFi",
      path: "/account/alerts",
      noindex: true,
    }),
});

// ---------------------------------------------------------------------------
// Notification preferences (push + per-domain email opt-out)
// ---------------------------------------------------------------------------

function PreferencesCard() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const prefsQ = useQuery(trpc.notifications.getPrefs.queryOptions());

  const setPrefs = useMutation(
    trpc.notifications.setPrefs.mutationOptions({
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: trpc.notifications.getPrefs.queryKey() });
      },
      onError: (err) => toast.error(err.message || "Could not update preferences"),
    }),
  );

  // The toggles read positively ("email me"), so they invert the opt-out flags.
  const stayEmail = !(prefsQ.data?.stayEmailOptOut ?? false);
  const diningEmail = !(prefsQ.data?.diningEmailOptOut ?? false);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Notification preferences</CardTitle>
        <CardDescription>Choose how ParkFi reaches you about your alerts</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between gap-3 rounded-2xl bg-muted/50 px-3 py-2.5">
          <div>
            <p className="text-sm font-medium">Push notifications</p>
            <p className="text-muted-foreground text-xs">
              Required for ride alerts to reach this device.
            </p>
          </div>
          <NotificationBell />
        </div>

        {prefsQ.isLoading ? (
          <Skeleton className="h-16 w-full rounded-2xl" />
        ) : (
          <>
            <label className="flex items-center justify-between gap-3 rounded-2xl bg-muted/50 px-3 py-2.5">
              <div>
                <p className="text-sm font-medium">Stay-alert email</p>
                <p className="text-muted-foreground text-xs">
                  Resort availability + price-drop emails.
                </p>
              </div>
              <Switch
                checked={stayEmail}
                disabled={setPrefs.isPending}
                onCheckedChange={(v) => setPrefs.mutate({ stayEmailOptOut: !v })}
              />
            </label>
            <label className="flex items-center justify-between gap-3 rounded-2xl bg-muted/50 px-3 py-2.5">
              <div>
                <p className="text-sm font-medium">Dining-alert email</p>
                <p className="text-muted-foreground text-xs">Table-availability emails.</p>
              </div>
              <Switch
                checked={diningEmail}
                disabled={setPrefs.isPending}
                onCheckedChange={(v) => setPrefs.mutate({ diningEmailOptOut: !v })}
              />
            </label>
          </>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

function AlertsPage() {
  const { data: session } = authClient.useSession();
  if (!session?.user) {
    return <p className="text-sm text-muted-foreground">You must be signed in to manage alerts.</p>;
  }

  return (
    <div className="space-y-4">
      <PreferencesCard />

      <Card>
        <CardHeader>
          <CardTitle>Stay alerts</CardTitle>
          <CardDescription>Resort availability for your dates — up to 3</CardDescription>
        </CardHeader>
        <CardContent>
          <StayAlertsManager />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Dining alerts</CardTitle>
          <CardDescription>Table availability at your restaurants — up to 3</CardDescription>
        </CardHeader>
        <CardContent>
          <DiningAlertsManager />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Ride alerts</CardTitle>
          <CardDescription>Wait-time + Lightning Lane alerts — up to 3 per park</CardDescription>
        </CardHeader>
        <CardContent>
          <AlertsManager />
        </CardContent>
      </Card>
    </div>
  );
}
