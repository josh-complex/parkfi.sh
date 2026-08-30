"use client";

import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BellIcon } from "lucide-react";
import { toast } from "sonner";

import { LoginLink } from "#/components/login-link.tsx";
import { Badge } from "#/components/ui/badge.tsx";
import { Button } from "#/components/ui/button.tsx";
import { Empty, EmptyDescription, EmptyTitle } from "#/components/ui/empty.tsx";
import { Skeleton } from "#/components/ui/skeleton.tsx";
import { useTRPC } from "#/integrations/trpc/react.ts";
import { authClient } from "#/lib/auth-client.ts";

const BECOMES_AVAILABLE = 1;

function ruleLabel(mode: number, priceBelow: number | null): string {
  if (mode === BECOMES_AVAILABLE) {
    return priceBelow != null
      ? `When a room opens under $${priceBelow.toLocaleString()}/night`
      : "When a room opens";
  }
  return `When under $${(priceBelow ?? 0).toLocaleString()}/night`;
}

function statusLabel(available: boolean | null, price: number | null): string {
  if (available == null) return "No data yet";
  if (!available) return "Currently sold out";
  return price != null ? `Available · from $${price.toLocaleString()}/night` : "Available";
}

export function StayAlertsManager() {
  const { data: session, isPending } = authClient.useSession();
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  const alertsQ = useQuery({
    ...trpc.stayAlerts.list.queryOptions(),
    enabled: !!session?.user,
  });

  const remove = useMutation(
    trpc.stayAlerts.remove.mutationOptions({
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: trpc.stayAlerts.list.queryKey() });
        toast.success("Alert removed");
      },
      onError: (err) => toast.error(err.message || "Could not remove alert"),
    }),
  );

  if (isPending) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-20 w-full rounded-xl" />
        <Skeleton className="h-20 w-full rounded-xl" />
      </div>
    );
  }

  if (!session?.user) {
    return (
      <Empty>
        <EmptyTitle>Sign in to manage alerts</EmptyTitle>
        <EmptyDescription>
          Resort-availability alerts are tied to your account so we know where to email you.
        </EmptyDescription>
        <Button className="mt-4" render={<LoginLink />}>
          Sign in
        </Button>
      </Empty>
    );
  }

  const alerts = alertsQ.data?.alerts ?? [];
  const limit = alertsQ.data?.limit ?? 3;

  return (
    <div className="space-y-3">
      <p className="text-muted-foreground text-sm">
        We'll email you when a resort opens up or drops below your price. {alerts.length} of {limit}{" "}
        used.
      </p>

      {alertsQ.isLoading ? (
        <div className="space-y-3">
          <Skeleton className="h-20 w-full rounded-xl" />
          <Skeleton className="h-20 w-full rounded-xl" />
        </div>
      ) : alerts.length === 0 ? (
        <Empty>
          <BellIcon className="text-muted-foreground size-6" />
          <EmptyTitle>No alerts yet</EmptyTitle>
          <EmptyDescription>
            Search a stay, then tap the bell on any resort to get an email when it opens up.
          </EmptyDescription>
          <Button className="mt-4" render={<Link to="/stays" />}>
            Search stays
          </Button>
        </Empty>
      ) : (
        <ul className="flex flex-col gap-3">
          {alerts.map((a) => (
            <li
              key={a.id}
              className="flex items-center justify-between gap-3 rounded-xl border p-4"
            >
              <div className="min-w-0 space-y-1">
                <div className="flex items-center gap-2">
                  <span className="truncate font-medium">{a.resortName}</span>
                  {!a.armed ? (
                    <Badge variant="secondary" className="shrink-0">
                      Notified
                    </Badge>
                  ) : null}
                </div>
                <p className="text-muted-foreground text-sm">
                  {a.dateRange} · {ruleLabel(a.mode, a.priceBelow)}
                </p>
                <p className="text-muted-foreground text-xs">
                  {statusLabel(a.currentAvailable, a.currentPrice)}
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                disabled={remove.isPending}
                onClick={() => remove.mutate({ id: a.id })}
              >
                Remove
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
