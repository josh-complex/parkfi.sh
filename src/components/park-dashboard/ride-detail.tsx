"use client";

import * as React from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeftIcon, ExternalLinkIcon } from "lucide-react";

import { getLastMapView } from "#/components/park-map/map-stage.tsx";
import { Badge } from "#/components/ui/badge.tsx";
import { Card, CardContent } from "#/components/ui/card.tsx";
import { Skeleton } from "#/components/ui/skeleton.tsx";
import { useTRPC } from "#/integrations/trpc/react.ts";
import { cn } from "#/lib/utils.ts";

import { formatPriceCents, isUniversal, paidLineInfo, paidLineProduct } from "./lightning-lane.ts";
import { RideAnalytics } from "./ride-analytics.tsx";
import { Sparkline } from "./sparkline.tsx";

const STATUS_BADGE: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  OPERATING: "secondary",
  DOWN: "destructive",
  REFURBISHMENT: "destructive",
  CLOSED: "outline",
  UNKNOWN: "outline",
};

function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div
      className={cn(
        // Mobile: label/value on one row, divider between stats.
        "flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0",
        "border-b border-border/60 last:border-b-0",
        // sm+: stacked cells in the 4-col grid, no dividers/padding.
        "sm:flex-col sm:items-start sm:gap-1 sm:border-b-0 sm:py-0",
      )}
    >
      <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <span className="text-right text-lg font-semibold tabular-nums sm:text-left">{children}</span>
    </div>
  );
}

/**
 * Standalone attraction detail page: live status + standby wait + paid-line
 * (Lightning Lane / Express) state for one ride, with a 24h standby trend and a
 * link back to the park board. Sourced from `parks.attraction`.
 */
export function RideDetail({ parkSlug, rideSlug }: { parkSlug: string; rideSlug: string }) {
  const trpc = useTRPC();
  const rideQ = useQuery(trpc.parks.attraction.queryOptions({ parkSlug, rideSlug }));
  const ride = rideQ.data;

  const historyQ = useQuery({
    ...trpc.parks.history.queryOptions({ attractionId: ride?.id ?? 0, queueType: 1, hours: 24 }),
    enabled: !!ride?.id,
  });
  const trend = React.useMemo(() => (historyQ.data ?? []).map((b) => b.avgWait), [historyQ.data]);

  if (rideQ.isLoading) {
    return (
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-4 px-4 py-6 lg:px-6">
        <Skeleton className="h-56 w-full rounded-2xl" />
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-32 w-full rounded-2xl" />
      </div>
    );
  }

  if (!ride) {
    return (
      <div className="mx-auto w-full max-w-4xl px-4 py-16 text-center lg:px-6">
        <p className="text-lg font-semibold">Ride not found</p>
        <p className="mt-1 text-sm text-muted-foreground">
          This attraction may no longer be listed.{" "}
          <Link to="/park/$slug" params={{ slug: parkSlug }} className="underline">
            Back to the park
          </Link>
          .
        </p>
      </div>
    );
  }

  const operatorSlug = ride.park.operatorSlug;
  const ll = paidLineInfo(ride, operatorSlug);
  const llPrice = formatPriceCents(ll.priceCents, ride.lightningLane.currency);
  const heroImage = ride.meta?.imageHeroUrl ?? ride.meta?.imageThumbUrl ?? null;
  const subtitleParts = [ride.park.name, ride.meta?.land].filter(Boolean);
  const status = ride.status ?? "UNKNOWN";

  // Return to wherever the user last was on the map (the free-roam map at its
  // remembered camera, or a park dashboard) rather than always the park page.
  const back = getLastMapView();
  const backClass = "inline-flex items-center gap-1.5 hover:underline";

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 py-6 lg:px-6">
      <nav className="text-sm text-muted-foreground">
        {back.to === "/map" ? (
          <Link to="/map" className={backClass}>
            <ArrowLeftIcon className="size-3.5" />
            {ride.park.name}
          </Link>
        ) : (
          <Link to="/park/$slug" params={back.params} className={backClass}>
            <ArrowLeftIcon className="size-3.5" />
            {ride.park.name}
          </Link>
        )}
      </nav>

      <header className="flex flex-col gap-4">
        {heroImage && (
          <div className="relative h-56 w-full overflow-hidden rounded-2xl bg-muted sm:h-72">
            <img
              src={heroImage}
              alt={ride.meta?.imageAlt ?? ride.name}
              className="size-full object-cover"
              loading="eager"
            />
          </div>
        )}
        <div className="flex flex-col gap-2">
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{ride.name}</h1>
          {subtitleParts.length > 0 && (
            <p className="text-muted-foreground">{subtitleParts.join(" · ")}</p>
          )}
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge variant={STATUS_BADGE[status] ?? "outline"}>{status.toLowerCase()}</Badge>
            {ride.meta?.heightRequirement && (
              <Badge variant="outline" className="font-normal">
                {ride.meta.heightRequirement}
              </Badge>
            )}
            {ride.meta?.tags?.map((t) => (
              <Badge key={t} variant="outline" className="font-normal">
                {t}
              </Badge>
            ))}
          </div>
          {ride.meta?.detailUrl && (
            <a
              href={ride.meta.detailUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex w-fit items-center gap-1.5 text-sm text-primary hover:underline"
            >
              View on the official site
              <ExternalLinkIcon className="size-3.5" />
            </a>
          )}
        </div>
      </header>

      <Card>
        <CardContent className="flex flex-col gap-6 pt-6">
          <div className="flex flex-col sm:grid sm:grid-cols-4 sm:gap-6">
            <Stat label="Standby">
              {ride.standbyWait == null ? (
                <span className="text-muted-foreground">—</span>
              ) : (
                <>
                  {ride.standbyWait}
                  <span className="text-sm font-normal text-muted-foreground"> min</span>
                </>
              )}
            </Stat>
            <Stat label="Typical (24–48h)">
              {ride.histStandbyWait == null ? (
                <span className="text-muted-foreground">—</span>
              ) : (
                <>
                  {ride.histStandbyWait}
                  <span className="text-sm font-normal text-muted-foreground"> min</span>
                </>
              )}
            </Stat>
            <Stat label={paidLineProduct(operatorSlug)}>
              {!ll.has ? (
                <span className="text-muted-foreground">—</span>
              ) : (
                <span className="flex items-center gap-2 text-base">
                  {ll.state ? (
                    <Badge variant={ll.soldOut ? "destructive" : "secondary"}>
                      {ll.state.toLowerCase().replace("_", " ")}
                    </Badge>
                  ) : (
                    <Badge variant="outline">offered</Badge>
                  )}
                  {llPrice && <span className="tabular-nums">{llPrice}</span>}
                </span>
              )}
            </Stat>
            <Stat label="24h trend">
              <Sparkline
                data={trend}
                width={120}
                height={32}
                color={
                  status === "DOWN" || status === "REFURBISHMENT"
                    ? "var(--destructive)"
                    : "var(--primary)"
                }
              />
            </Stat>
          </div>
          {ll.has && isUniversal(operatorSlug) && (
            <p className={cn("text-xs text-muted-foreground")}>
              Universal’s per-ride signal is the free Virtual Line return time. Paid Express is a
              separate park-wide pass — see the{" "}
              <Link to="/tickets" className="underline">
                Ticket Pricing
              </Link>{" "}
              page.
            </p>
          )}
        </CardContent>
      </Card>

      <RideAnalytics attractionId={ride.id} timezone={ride.park.timezone} />
    </div>
  );
}
