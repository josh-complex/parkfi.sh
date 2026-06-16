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

/** Muted placeholder for empty Stat values — reads as intentional, not broken. */
function NoData({ children = "No data yet" }: { children?: React.ReactNode }) {
  return <span className="text-base font-normal text-muted-foreground">{children}</span>;
}

function formatOpensAt(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

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

  // Closed-state for the global cards: only parks with schedule data count, so a
  // missing calendar never reads as "closed". When every scheduled park is shut
  // (overnight), surface that + the soonest reopening instead of empty "0 / —".
  const scheduled = parks.filter((p) => p.isOpen != null);
  const allClosed = scheduled.length > 0 && scheduled.every((p) => p.isOpen === false);
  const nextOpen = allClosed
    ? scheduled
        .map((p) => p.opensAt)
        .filter((x): x is string => !!x)
        .sort()[0]
    : null;
  const reopenSub = nextOpen ? `Opens ${formatOpensAt(nextOpen)}` : "Parks are currently closed";

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
          value={
            allClosed ? <NoData>All parks closed</NoData> : (global.busiestParkName ?? <NoData />)
          }
          sub={
            allClosed
              ? reopenSub
              : global.busiestParkWait != null
                ? `${global.busiestParkWait} min average wait`
                : "No data yet"
          }
        />
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Stat
            icon={<ClockIcon className="size-4" />}
            label="All-parks average wait"
            value={global.avgWait != null ? `${global.avgWait} min` : <NoData />}
            sub={allClosed ? reopenSub : "Across every operating ride"}
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
              allClosed
                ? "All parks closed"
                : global.totalRides > 0
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
                {resortParks.map((p) => {
                  const closed = p.isOpen === false;
                  return (
                    <Link
                      key={p.slug}
                      to="/park/$slug"
                      params={{ slug: p.slug }}
                      className={cn(
                        "group flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-sm",
                        "transition-colors hover:bg-primary hover:text-primary-foreground",
                        closed && "opacity-60",
                      )}
                    >
                      <span className="min-w-0 truncate font-medium">{p.name}</span>
                      <span className="flex shrink-0 items-center gap-2 tabular-nums">
                        {closed ? (
                          <span className="flex items-center gap-1.5 text-xs text-muted-foreground group-hover:text-primary-foreground/85">
                            <span className="rounded-full border px-1.5 py-0.5 font-medium group-hover:border-primary-foreground/40">
                              Closed
                            </span>
                            {p.opensAt && <span>Opens {formatOpensAt(p.opensAt)}</span>}
                          </span>
                        ) : (
                          <>
                            {p.avgWait != null && (
                              <span className="rounded-full bg-muted px-1.5 py-0.5 text-xs font-medium text-foreground group-hover:bg-primary-foreground/15 group-hover:text-primary-foreground">
                                {p.avgWait} min
                              </span>
                            )}
                            <span className="text-xs text-muted-foreground group-hover:text-primary-foreground/85">
                              {p.isOpen == null && p.operating === 0
                                ? "Hours unavailable"
                                : `${p.operating}/${p.totalRides} open`}
                            </span>
                          </>
                        )}
                      </span>
                    </Link>
                  );
                })}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
