"use client";

import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Bell, BellOff, ChevronRightIcon, Trash2Icon } from "lucide-react";
import { toast } from "sonner";

import { LoginLink } from "#/components/login-link.tsx";
import { Badge } from "#/components/ui/badge.tsx";
import { Button } from "#/components/ui/button.tsx";
import { Popover, PopoverContent, PopoverTrigger } from "#/components/ui/popover.tsx";
import { Skeleton } from "#/components/ui/skeleton.tsx";
import { usePushNotifications } from "#/hooks/use-push-notifications.ts";
import { useTRPC } from "#/integrations/trpc/react.ts";
import { authClient } from "#/lib/auth-client.ts";
import { cn } from "#/lib/utils.ts";

type AlertItem = {
  id: number;
  attractionName: string;
  mode: number;
  thresholdMin: number | null;
  changeDelta: number | null;
  currentWait: number | null;
  status: string | null;
};

/** Short, single-line rule summary for the compact popover row. */
function ruleLabel(a: AlertItem): string {
  return a.mode === 1 ? `≤ ${a.thresholdMin} min` : `Δ ${a.changeDelta} min / status`;
}

function CompactRow({ alert }: { alert: AlertItem }) {
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
    <div className="flex items-center gap-2 px-4 py-2">
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
      <Button
        variant="ghost"
        size="icon"
        className="text-muted-foreground hover:text-destructive h-7 w-7 shrink-0"
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
 * Nav notification center: a bell with a live count of the signed-in user's
 * active ride alerts. The popover shows each alert grouped by park with its
 * current wait/status and a quick remove, folds in the device push toggle (push
 * must be on for alerts to reach you), and links to /alerts for full management.
 */
export function NotificationCenter() {
  const trpc = useTRPC();
  const [open, setOpen] = useState(false);
  const { data: session } = authClient.useSession();
  const loggedIn = !!session?.user;
  const push = usePushNotifications();

  // Drives the badge count, so keep it enabled whenever signed in (not just when
  // the popover is open). It's a single query; the live wait/status comes free.
  const listQ = useQuery({ ...trpc.rideAlerts.list.queryOptions(), enabled: loggedIn });
  const parks = listQ.data?.parks ?? [];
  const total = parks.reduce((n, p) => n + p.alerts.length, 0);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            className="relative h-7 w-7"
            aria-label={total > 0 ? `Alerts (${total} active)` : "Alerts"}
          />
        }
      >
        <Bell className="h-4 w-4" />
        {loggedIn && total > 0 ? (
          <span className="bg-primary text-primary-foreground absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-semibold tabular-nums">
            {total > 9 ? "9+" : total}
          </span>
        ) : null}
      </PopoverTrigger>

      <PopoverContent align="end" className="w-80 gap-0 p-0">
        <div className="flex items-center justify-between px-4 py-3">
          <p className="text-base font-medium">Alerts</p>
          {push.supported ? (
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground -mr-2 h-7 gap-1.5 px-2 text-xs"
              disabled={push.pending}
              onClick={() => void (push.subscribed ? push.unsubscribe() : push.subscribe())}
            >
              {push.subscribed ? (
                <>
                  <Bell className="size-3.5 fill-current" /> Push on
                </>
              ) : (
                <>
                  <BellOff className="size-3.5" /> Enable push
                </>
              )}
            </Button>
          ) : null}
        </div>

        {push.supported && !push.subscribed && loggedIn ? (
          <p className="bg-muted/40 text-muted-foreground border-y px-4 py-2 text-xs">
            Turn on push so these alerts reach this device.
          </p>
        ) : (
          <div className="border-t" />
        )}

        <Body
          loggedIn={loggedIn}
          loading={listQ.isLoading}
          parks={parks}
          onClose={() => setOpen(false)}
        />

        <div className="border-t p-2">
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-between"
            render={<Link to="/alerts" />}
            onClick={() => setOpen(false)}
          >
            Manage all alerts
            <ChevronRightIcon className="size-4" />
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function Body({
  loggedIn,
  loading,
  parks,
  onClose,
}: {
  loggedIn: boolean;
  loading: boolean;
  parks: Array<{
    parkId: number;
    parkSlug: string;
    parkName: string;
    used: number;
    limit: number;
    alerts: AlertItem[];
  }>;
  onClose: () => void;
}) {
  if (!loggedIn) {
    return (
      <div className="px-4 py-6 text-center">
        <p className="text-sm font-medium">Sign in to track rides</p>
        <p className="text-muted-foreground mt-1 text-xs">
          Get a push when a ride’s wait drops or changes.
        </p>
        <Button size="sm" className="mt-3" render={<LoginLink />} onClick={onClose}>
          Sign in
        </Button>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="space-y-2 p-4">
        <Skeleton className="h-10 w-full rounded-md" />
        <Skeleton className="h-10 w-full rounded-md" />
      </div>
    );
  }

  if (parks.length === 0) {
    return (
      <div className="px-4 py-6 text-center">
        <p className="text-sm font-medium">No ride alerts yet</p>
        <p className="text-muted-foreground mt-1 text-xs">
          Open a park and tap the bell on any ride to start tracking it.
        </p>
      </div>
    );
  }

  return (
    <div className="max-h-96 overflow-y-auto">
      {parks.map((park) => (
        <div key={park.parkId}>
          <Link
            to="/park/$slug"
            params={{ slug: park.parkSlug }}
            onClick={onClose}
            className={cn(
              "bg-muted/40 flex items-center justify-between px-4 py-1.5",
              "text-muted-foreground text-xs font-medium hover:underline",
            )}
          >
            <span className="truncate">{park.parkName}</span>
            <Badge variant={park.used >= park.limit ? "destructive" : "secondary"}>
              {park.used}/{park.limit}
            </Badge>
          </Link>
          <div className="divide-y">
            {park.alerts.map((alert) => (
              <CompactRow key={alert.id} alert={alert} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
