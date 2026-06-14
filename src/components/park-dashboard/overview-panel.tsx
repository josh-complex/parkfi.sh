"use client";

import * as React from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ActivityIcon, ClockIcon, FlameIcon, MapPinnedIcon } from "lucide-react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "#/components/ui/card.tsx";
import { NotificationPrompt } from "#/components/notifications/notification-prompt.tsx";
import { Skeleton } from "#/components/ui/skeleton.tsx";
import { useTRPC } from "#/integrations/trpc/react.ts";
import { cn } from "#/lib/utils.ts";

function Stat({
  icon,
  label,
  value,
  sub,
}: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
}) {
  return (
    <Card className="@container/card">
      <CardHeader>
        <CardDescription className="flex items-center gap-1.5">
          {icon}
          {label}
        </CardDescription>
        <CardTitle className="text-2xl font-semibold tabular-nums">{value}</CardTitle>
      </CardHeader>
      {sub && <CardContent className="-mt-2 text-sm text-muted-foreground">{sub}</CardContent>}
    </Card>
  );
}

export function OverviewPanel() {
  const trpc = useTRPC();
  const overviewQ = useQuery(trpc.parks.overview.queryOptions());
  const overview = overviewQ.data;

  if (overviewQ.isLoading || !overview) {
    return (
      <div className="flex flex-col gap-4 p-4 lg:p-6">
        <div className="grid grid-cols-1 gap-4 @xl/main:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-28 w-full" />
          ))}
        </div>
        <div className="grid grid-cols-1 gap-4 @xl/main:grid-cols-2">
          {Array.from({ length: 2 }).map((_, i) => (
            <Skeleton key={i} className="h-40 w-full" />
          ))}
        </div>
      </div>
    );
  }

  const { global, resorts, parks } = overview;

  return (
    <div
      className="flex flex-col gap-4 p-4 lg:gap-6 lg:p-6"
      style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 1.5rem)" }}
    >
      <div className="flex flex-col gap-1">
        <h2 className="text-xl font-semibold tracking-tight text-foreground">
          Orlando Theme Parks
        </h2>
        <p className="text-sm text-muted-foreground">
          Live across {global.parkCount} parks at Walt Disney World &amp; Universal Orlando. Pick a
          park on the map to dive in.
        </p>
      </div>

      <NotificationPrompt />

      {/* Global headline — the busiest park leads full-width; the wait/rides
          pair sits in a row beside the map on desktop, stacking on the narrow
          full-width mobile panel. Keyed to the viewport (lg) rather than the
          container, since the side panel is only ~40% wide and never trips the
          @xl container breakpoint. */}
      <div className="flex flex-col gap-4">
        <Stat
          icon={<FlameIcon className="size-4" />}
          label="Busiest park"
          value={global.busiestParkName ?? "—"}
          sub={
            global.busiestParkWait != null
              ? `${global.busiestParkWait} min average wait`
              : "No data"
          }
        />
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Stat
            icon={<ClockIcon className="size-4" />}
            label="All-parks average wait"
            value={global.avgWait != null ? `${global.avgWait} min` : "—"}
            sub="Across every operating ride"
          />
          <Stat
            icon={<ActivityIcon className="size-4" />}
            label="Rides operating"
            value={
              <>
                {global.operating}
                <span className="text-base font-normal text-muted-foreground">
                  {" "}
                  / {global.totalRides}
                </span>
              </>
            }
            sub={
              global.totalRides > 0
                ? `${Math.round((global.operating / global.totalRides) * 100)}% operational`
                : "No data"
            }
          />
        </div>
      </div>

      {/* Disney vs Universal */}
      <div className="grid grid-cols-1 gap-4 @xl/main:grid-cols-2">
        {resorts.map((resort) => {
          const resortParks = parks.filter((p) => p.operatorSlug === resort.operatorSlug);
          return (
            <Card key={resort.operatorSlug}>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <MapPinnedIcon className="size-4 text-primary" />
                  {resort.operatorName ?? resort.operatorSlug}
                </CardTitle>
                <CardDescription>
                  {resort.parkCount} parks · {resort.operating}/{resort.totalRides} rides open ·{" "}
                  {resort.avgWait != null ? `${resort.avgWait} min avg` : "no waits"}
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-1">
                {resortParks.map((p) => (
                  <Link
                    key={p.slug}
                    to="/park/$slug"
                    params={{ slug: p.slug }}
                    className={cn(
                      "flex items-center justify-between rounded-md px-2 py-1.5 text-sm",
                      "transition-colors hover:bg-accent hover:text-accent-foreground",
                    )}
                  >
                    <span className="font-medium">{p.name}</span>
                    <span className="tabular-nums text-muted-foreground">
                      {p.avgWait != null ? `${p.avgWait} min` : "—"}
                      <span className="mx-1.5 text-border">|</span>
                      {p.operating}/{p.totalRides} open
                    </span>
                  </Link>
                ))}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
