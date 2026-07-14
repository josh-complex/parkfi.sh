"use client";

import * as React from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeftIcon, ExternalLinkIcon } from "lucide-react";

import { getLastMapView } from "#/components/park-map/map-stage.tsx";
import { RemovalRequestDialog } from "#/components/removal-request-dialog.tsx";
import { Badge } from "#/components/ui/badge.tsx";
import { Button } from "#/components/ui/button.tsx";
import { Image } from "#/components/ui/image.tsx";
import { disneyResizeUrl, HERO_IMAGE } from "#/lib/image.ts";
import { Card, CardContent } from "#/components/ui/card.tsx";
import { Skeleton } from "#/components/ui/skeleton.tsx";
import { useIsNative } from "#/hooks/use-is-native.ts";
import { useTRPC } from "#/integrations/trpc/react.ts";
import { authClient } from "#/lib/auth-client.ts";
import { QueueType } from "#/server/parks/codes.ts";
import { cn } from "#/lib/utils.ts";

import { formatPriceCents, isUniversal, paidLineInfo, paidLineProduct } from "./lightning-lane.ts";
import { LightningLaneAvailability } from "./ll-availability.tsx";
import { RideAnalytics } from "./ride-analytics.tsx";

const STATUS_BADGE: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  OPERATING: "secondary",
  DOWN: "destructive",
  REFURBISHMENT: "destructive",
  CLOSED: "outline",
  UNKNOWN: "outline",
};

function StatCard({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Card size="sm">
      <CardContent className="flex flex-col gap-1">
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </span>
        <span className="text-2xl font-bold tabular-nums">{children}</span>
      </CardContent>
    </Card>
  );
}

type CoasterStats = {
  trackLengthM: number | null;
  topSpeedKmh: number | null;
  dropHeightM: number | null;
  maxHeightM: number | null;
  inversions: number | null;
  coasterType: string | null;
  manufacturer: string | null;
  openedYear: number | null;
};

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <span className="text-base font-semibold tabular-nums">{value}</span>
    </div>
  );
}

/**
 * Published coaster facts (length/speed/drop/…) plus, for signed-in riders, the
 * personal bests recorded by the native ride sensor. Facts are public + SSR'd;
 * the "your rides" line loads client-side and only when the user has ridden it.
 */
function CoasterStatsCard({ stats, attractionId }: { stats: CoasterStats; attractionId: number }) {
  const trpc = useTRPC();
  const { data: session } = authClient.useSession();
  const loggedIn = !!session?.user;
  const mine = useQuery({
    ...trpc.achievements.myRideStats.queryOptions({ attractionId }),
    enabled: loggedIn,
  });

  const facts: Array<{ label: string; value: string }> = [];
  if (stats.trackLengthM != null)
    facts.push({ label: "Length", value: `${Math.round(stats.trackLengthM).toLocaleString()} m` });
  if (stats.topSpeedKmh != null)
    facts.push({ label: "Top speed", value: `${Math.round(stats.topSpeedKmh)} km/h` });
  if (stats.dropHeightM != null)
    facts.push({ label: "Drop", value: `${Math.round(stats.dropHeightM)} m` });
  if (stats.maxHeightM != null)
    facts.push({ label: "Height", value: `${Math.round(stats.maxHeightM)} m` });
  if (stats.inversions != null)
    facts.push({ label: "Inversions", value: String(stats.inversions) });
  if (stats.coasterType)
    facts.push({
      label: "Type",
      value: stats.coasterType.charAt(0).toUpperCase() + stats.coasterType.slice(1),
    });
  if (stats.manufacturer) facts.push({ label: "Maker", value: stats.manufacturer });
  if (stats.openedYear != null) facts.push({ label: "Opened", value: String(stats.openedYear) });

  const r = mine.data;
  const ridden = r && r.rideCount > 0;

  return (
    <Card>
      <CardContent className="flex flex-col gap-4">
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Coaster stats
        </span>
        <div className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
          {facts.map((f) => (
            <Fact key={f.label} label={f.label} value={f.value} />
          ))}
        </div>
        {loggedIn && ridden && (
          <div className="flex flex-col gap-1 border-t pt-3">
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Your rides
            </span>
            <p className="text-sm text-muted-foreground">
              <span className="font-semibold text-foreground tabular-nums">{r.rideCount}</span>{" "}
              {r.rideCount === 1 ? "ride" : "rides"}
              {r.bestMaxG != null && (
                <>
                  {" · best "}
                  <span className="font-semibold text-foreground tabular-nums">
                    {r.bestMaxG.toFixed(1)} g
                  </span>
                </>
              )}
              {r.totalDrops > 0 && (
                <>
                  {" · "}
                  <span className="font-semibold text-foreground tabular-nums">
                    {r.totalDrops}
                  </span>{" "}
                  {r.totalDrops === 1 ? "drop" : "drops"}
                </>
              )}
              {r.lastRiddenAt && <> · last {new Date(r.lastRiddenAt).toLocaleDateString()}</>}
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Standalone attraction detail page: live status + standby wait + paid-line
 * (Lightning Lane / Express) state for one ride, with a 24h standby trend and a
 * link back to the park board. Sourced from `parks.attraction`.
 */
export function RideDetail({ parkSlug, rideSlug }: { parkSlug: string; rideSlug: string }) {
  const trpc = useTRPC();
  const native = useIsNative();
  const rideQ = useQuery(trpc.parks.attraction.queryOptions({ parkSlug, rideSlug }));
  const ride = rideQ.data;

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
  const backClass = "-m-2 inline-flex items-center gap-1.5 p-2 hover:underline";

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 pt-2 pb-6 lg:px-6">
      <div className="hidden items-center justify-between gap-3 md:flex">
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
        <RemovalRequestDialog
          entityType="attraction"
          entityId={String(ride.id)}
          entityName={ride.name}
        />
      </div>

      <header className="flex flex-col gap-4">
        {heroImage && (
          <div className="relative h-56 w-full overflow-hidden rounded-2xl bg-muted sm:h-72">
            <Image
              src={disneyResizeUrl(heroImage, HERO_IMAGE.resizeWidth)}
              alt={ride.meta?.imageAlt ?? ride.name}
              className="size-full object-cover"
              loading="eager"
              fetchPriority="high"
              sizes={HERO_IMAGE.sizes}
              quality={HERO_IMAGE.quality}
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

      <div className="grid grid-cols-2 gap-3 sm:gap-4">
        <StatCard label="Standby">
          {ride.standbyWait == null ? (
            <span className="text-muted-foreground">—</span>
          ) : (
            <>
              {ride.standbyWait}
              <span className="text-sm font-normal text-muted-foreground"> min</span>
            </>
          )}
        </StatCard>
        <StatCard label="Typical (24–48h)">
          {ride.histStandbyWait == null ? (
            <span className="text-muted-foreground">—</span>
          ) : (
            <>
              {ride.histStandbyWait}
              <span className="text-sm font-normal text-muted-foreground"> min</span>
            </>
          )}
        </StatCard>
      </div>

      {ll.has && (
        <Card>
          <CardContent className="flex flex-col gap-4">
            <div className="flex flex-col gap-1">
              <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {paidLineProduct(operatorSlug)}
              </span>
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
            </div>
            {/* Lightning Lane lives only in the MDE app — no web page to fall
                back to — so this is native-only; web users have the official-site
                link in the header above. */}
            {native && ride.lightningLaneDeepLink && (
              <Button
                size="sm"
                className="w-fit gap-1.5"
                render={<a href={ride.lightningLaneDeepLink} target="_blank" rel="noreferrer" />}
              >
                Open in Disney App
                <ExternalLinkIcon className="size-3.5" />
              </Button>
            )}
            {isUniversal(operatorSlug) && (
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
      )}

      {/* Availability timeline — only for rides that actually offer the paid line.
          Single LL is a PAID_RETURN_TIME queue; Multi LL and Universal's Virtual
          Line are RETURN_TIME. */}
      {ll.has && (
        <LightningLaneAvailability
          attractionId={ride.id}
          queueType={ll.kind === "Single" ? QueueType.PAID_RETURN_TIME : QueueType.RETURN_TIME}
          timeZone={ride.park.timezone}
          product={paidLineProduct(operatorSlug)}
        />
      )}

      {ride.coasterStats && <CoasterStatsCard stats={ride.coasterStats} attractionId={ride.id} />}

      <RideAnalytics attractionId={ride.id} timezone={ride.park.timezone} />
    </div>
  );
}
