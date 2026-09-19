import * as React from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { AlertsManager } from "#/components/notifications/alerts-manager.tsx";
import { DiningAlertsManager } from "#/components/dining/dining-alerts-manager.tsx";
import { FilingWatchesManager } from "#/components/records/filing-watches-manager.tsx";
import { NotificationBell } from "#/components/notifications/notification-bell.tsx";
import { StayAlertsManager } from "#/components/stays/stay-alerts-manager.tsx";
import { DetailCard, WashPanel } from "#/components/detail/panels.tsx";
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
  const filingEmail = !(prefsQ.data?.filingEmailOptOut ?? false);

  return (
    <WashPanel title="How we reach you" meta="Push + email">
      <PrefRow
        title="Push notifications"
        note="Required for ride alerts to reach this device."
        control={<NotificationBell />}
      />

      {prefsQ.isLoading ? (
        <Skeleton className="h-16 w-full rounded-2xl" />
      ) : (
        <>
          <PrefRow
            as="label"
            title="Stay-alert email"
            note="Resort availability + price-drop emails."
            control={
              <Switch
                checked={stayEmail}
                disabled={setPrefs.isPending}
                onCheckedChange={(v) => setPrefs.mutate({ stayEmailOptOut: !v })}
              />
            }
          />
          <PrefRow
            as="label"
            title="Dining-alert email"
            note="Table-availability emails."
            control={
              <Switch
                checked={diningEmail}
                disabled={setPrefs.isPending}
                onCheckedChange={(v) => setPrefs.mutate({ diningEmailOptOut: !v })}
              />
            }
          />
          <PrefRow
            as="label"
            title="Filing-watch email"
            note="New permits, trademarks and airspace studies you watch."
            control={
              <Switch
                checked={filingEmail}
                disabled={setPrefs.isPending}
                onCheckedChange={(v) => setPrefs.mutate({ filingEmailOptOut: !v })}
              />
            }
          />
        </>
      )}
    </WashPanel>
  );
}

/**
 * One channel on the wash field. The row is a pale card *on* the field rather
 * than a `bg-muted` tile — muted grey on the wash reads as a disabled row.
 */
function PrefRow({
  as = "div",
  title,
  note,
  control,
}: {
  as?: "div" | "label";
  title: string;
  note: string;
  control: React.ReactNode;
}) {
  const Row = as;
  return (
    <Row className="flex items-center justify-between gap-3 rounded-2xl bg-background/70 px-3.5 py-3">
      <div className="min-w-0">
        <p className="text-sm font-semibold">{title}</p>
        <p className="text-xs text-muted-foreground">{note}</p>
      </div>
      <div className="shrink-0">{control}</div>
    </Row>
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
    <div className="flex flex-col gap-5">
      <PreferencesCard />

      <DetailCard title="Stay alerts" description="Resort availability for your dates — up to 3">
        <StayAlertsManager />
      </DetailCard>

      <DetailCard
        title="Dining alerts"
        description="Table availability at your restaurants — up to 3"
      >
        <DiningAlertsManager />
      </DetailCard>

      <DetailCard
        title="Filing watches"
        description="Permits, trademarks and FAA studies as they're filed — up to 3"
      >
        <FilingWatchesManager />
      </DetailCard>

      <DetailCard
        title="Ride alerts"
        description="Wait-time + Lightning Lane alerts — up to 3 per park"
      >
        <AlertsManager />
      </DetailCard>
    </div>
  );
}
