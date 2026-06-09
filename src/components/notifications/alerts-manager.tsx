"use client";

import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronRightIcon, Trash2Icon } from "lucide-react";
import { toast } from "sonner";

import { RideAlertButton } from "#/components/notifications/ride-alert-button.tsx";
import { Badge } from "#/components/ui/badge.tsx";
import { Button } from "#/components/ui/button.tsx";
import { Skeleton } from "#/components/ui/skeleton.tsx";
import { useTRPC } from "#/integrations/trpc/react.ts";
import { authClient } from "#/lib/auth-client.ts";

type AlertItem = {
  id: number;
  attractionId: number;
  attractionName: string;
  mode: number;
  thresholdMin: number | null;
  changeDelta: number | null;
  currentWait: number | null;
  status: string | null;
};

/** Human description of an alert's rule for the management list. */
function ruleLabel(a: AlertItem): string {
  if (a.mode === 1) return `When standby ≤ ${a.thresholdMin} min`;
  return `When standby changes by ${a.changeDelta} min or it opens/closes`;
}

function AlertRow({ alert }: { alert: AlertItem }) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const remove = useMutation(
    trpc.rideAlerts.remove.mutationOptions({
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: trpc.rideAlerts.list.queryKey() });
        toast.success(`Stopped tracking ${alert.attractionName}`);
      },
      onError: (err) => toast.error(err.message || "Could not remove alert"),
    }),
  );

  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{alert.attractionName}</p>
        <p className="text-muted-foreground truncate text-xs">{ruleLabel(alert)}</p>
      </div>
      <div className="text-right">
        <p className="text-sm tabular-nums">
          {alert.currentWait != null ? `${alert.currentWait} min` : "—"}
        </p>
        {alert.status ? (
          <p className="text-muted-foreground text-xs lowercase">{alert.status}</p>
        ) : null}
      </div>
      <RideAlertButton
        attractionId={alert.attractionId}
        attractionName={alert.attractionName}
        alert={{
          id: alert.id,
          mode: alert.mode,
          thresholdMin: alert.thresholdMin,
          changeDelta: alert.changeDelta,
        }}
        loggedIn
      />
      <Button
        variant="ghost"
        size="icon"
        className="text-muted-foreground hover:text-destructive h-7 w-7"
        aria-label={`Remove alert for ${alert.attractionName}`}
        disabled={remove.isPending}
        onClick={() => remove.mutate({ id: alert.id })}
      >
        <Trash2Icon className="size-4" />
      </Button>
    </div>
  );
}

/**
 * Lists the signed-in user's ride alerts grouped by park, with per-park capacity
 * and inline edit/remove. Alerts are created from a park's ride board; this is
 * the place to review and manage them.
 */
export function AlertsManager() {
  const trpc = useTRPC();
  const { data: session, isPending } = authClient.useSession();
  const loggedIn = !!session?.user;
  const listQ = useQuery({ ...trpc.rideAlerts.list.queryOptions(), enabled: loggedIn });

  if (isPending) {
    return <Skeleton className="h-24 w-full rounded-lg" />;
  }

  if (!loggedIn) {
    return (
      <div className="rounded-lg border bg-card text-card-foreground p-6 text-center">
        <p className="text-sm font-medium">Sign in to track rides</p>
        <p className="text-muted-foreground mt-1 text-xs">
          Get a push notification when a ride’s wait drops or changes.
        </p>
        <Button size="sm" className="mt-3" render={<Link to="/login" />}>
          Sign in
        </Button>
      </div>
    );
  }

  if (listQ.isLoading) {
    return <Skeleton className="h-24 w-full rounded-lg" />;
  }

  const parks = listQ.data?.parks ?? [];
  if (parks.length === 0) {
    return (
      <div className="rounded-lg border bg-card text-card-foreground p-6 text-center">
        <p className="text-sm font-medium">No ride alerts yet</p>
        <p className="text-muted-foreground mt-1 text-xs">
          Open a park and tap the bell on any ride to start tracking its wait time.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {parks.map((park) => (
        <div
          key={park.parkId}
          className="overflow-hidden rounded-lg border bg-card text-card-foreground"
        >
          <div className="bg-muted/40 flex items-center justify-between px-4 py-2.5">
            <Link
              to="/park/$slug"
              params={{ slug: park.parkSlug }}
              className="group inline-flex items-center gap-1 text-sm font-medium hover:underline"
            >
              {park.parkName}
              <ChevronRightIcon className="text-muted-foreground size-3.5" />
            </Link>
            <Badge variant={park.used >= park.limit ? "destructive" : "secondary"}>
              {park.used}/{park.limit}
            </Badge>
          </div>
          <div className="divide-y">
            {park.alerts.map((alert) => (
              <AlertRow key={alert.id} alert={alert} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
