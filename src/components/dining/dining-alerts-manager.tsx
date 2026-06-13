"use client";

import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BellIcon } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "#/components/ui/badge.tsx";
import { Button } from "#/components/ui/button.tsx";
import { Empty, EmptyDescription, EmptyTitle } from "#/components/ui/empty.tsx";
import { Skeleton } from "#/components/ui/skeleton.tsx";
import { useTRPC } from "#/integrations/trpc/react.ts";
import { authClient } from "#/lib/auth-client.ts";

function statusLabel(available: boolean, nextDate: string | null): string {
  if (!available) return "No tables yet";
  if (nextDate) {
    const d = new Date(`${nextDate}T00:00:00Z`).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    });
    return `Table available · ${d}`;
  }
  return "Table available";
}

/** Lists the user's dining alerts. Mirrors `StayAlertsManager`. */
export function DiningAlertsManager() {
  const { data: session, isPending } = authClient.useSession();
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  const alertsQ = useQuery({
    ...trpc.diningAlerts.list.queryOptions(),
    enabled: !!session?.user,
  });

  const remove = useMutation(
    trpc.diningAlerts.remove.mutationOptions({
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: trpc.diningAlerts.list.queryKey() });
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
          Dining-availability alerts are tied to your account so we know where to email you.
        </EmptyDescription>
        <Button className="mt-4" render={<Link to="/login" />}>
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
        We'll email you when a table opens for your party. {alerts.length} of {limit} used.
      </p>

      {alertsQ.isLoading ? (
        <div className="space-y-3">
          <Skeleton className="h-20 w-full rounded-xl" />
          <Skeleton className="h-20 w-full rounded-xl" />
        </div>
      ) : alerts.length === 0 ? (
        <Empty>
          <BellIcon className="text-muted-foreground size-6" />
          <EmptyTitle>No dining alerts yet</EmptyTitle>
          <EmptyDescription>
            Tap the bell on any restaurant to get an email when a table opens.
          </EmptyDescription>
          <Button className="mt-4" render={<Link to="/dining" />}>
            Find a table
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
                  <span className="truncate font-medium">{a.restaurantName}</span>
                  {!a.armed ? (
                    <Badge variant="secondary" className="shrink-0">
                      Notified
                    </Badge>
                  ) : null}
                </div>
                <p className="text-muted-foreground text-sm">
                  Party of {a.partySize} · {a.dateLabel}
                </p>
                <p className="text-muted-foreground text-xs">
                  {statusLabel(a.currentAvailable, a.nextDate)}
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
