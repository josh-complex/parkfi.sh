"use client";

import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeftIcon, ExternalLinkIcon } from "lucide-react";

import { MenuBody, useMenuState } from "#/components/dining/menu-content.tsx";
import { Badge } from "#/components/ui/badge.tsx";
import { Skeleton } from "#/components/ui/skeleton.tsx";
import { useIsMobile } from "#/hooks/use-mobile.ts";
import { useTRPC } from "#/integrations/trpc/react.ts";

function VenueBadges({
  venue,
}: {
  venue: {
    requiresParkTicket: boolean;
    characterDining: boolean;
    dinnerShow: boolean;
    fineDining: boolean;
    priceRange: string | null;
  };
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {venue.priceRange && (
        <Badge variant="outline" className="font-normal">
          {venue.priceRange}
        </Badge>
      )}
      {venue.requiresParkTicket && <Badge variant="secondary">Park ticket</Badge>}
      {venue.characterDining && <Badge variant="secondary">Characters</Badge>}
      {venue.dinnerShow && <Badge variant="secondary">Dinner show</Badge>}
      {venue.fineDining && <Badge variant="secondary">Signature</Badge>}
    </div>
  );
}

/**
 * Standalone restaurant detail page body: a venue header + the full menu,
 * rendered inline (not in a modal). `targetItemSlug` comes from a `#menu-<slug>`
 * deep link — it auto-selects the right meal period, scrolls to the item, and
 * highlights it briefly. The menu rendering is shared with the board's menu
 * drawer via `menu-content.tsx`.
 */
export function DiningVenueDetail({
  facilityId,
  targetItemSlug,
}: {
  facilityId: string;
  targetItemSlug?: string | null;
}) {
  const trpc = useTRPC();
  const isMobile = useIsMobile();
  const venueQ = useQuery(trpc.dining.venue.queryOptions({ facilityId }));
  const venue = venueQ.data;
  const state = useMenuState(facilityId, true, targetItemSlug);

  const subtitle = venue
    ? [venue.parkResort, venue.experienceType ?? venue.cuisine].filter(Boolean).join(" · ")
    : "";

  const hasMenu = state.periods.length > 0;

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-6 lg:px-6">
      <nav className="text-sm text-muted-foreground">
        <Link to="/dining" className="inline-flex items-center gap-1.5 hover:underline">
          <ArrowLeftIcon className="size-3.5" />
          All dining
        </Link>
      </nav>

      {/* Header */}
      {venueQ.isLoading ? (
        <div className="flex flex-col gap-3">
          <Skeleton className="h-48 w-full rounded-2xl" />
          <Skeleton className="h-7 w-64" />
          <Skeleton className="h-4 w-40" />
        </div>
      ) : !venue ? (
        <div className="rounded-2xl border bg-muted/30 py-16 text-center">
          <p className="text-lg font-semibold">Restaurant not found</p>
          <p className="mt-1 text-sm text-muted-foreground">
            This venue may no longer be listed.{" "}
            <Link to="/dining" className="underline">
              Browse all dining
            </Link>
            .
          </p>
        </div>
      ) : (
        <header className="flex flex-col gap-4">
          {venue.imageUrl && (
            <div className="relative h-48 w-full overflow-hidden rounded-2xl bg-muted sm:h-64">
              <img
                src={venue.imageUrl}
                alt={venue.name}
                className="size-full object-cover"
                loading="eager"
              />
            </div>
          )}
          <div className="flex flex-col gap-2">
            <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{venue.name}</h1>
            {subtitle && <p className="text-muted-foreground">{subtitle}</p>}
            <VenueBadges venue={venue} />
            {venue.detailUrl && (
              <a
                href={venue.detailUrl}
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
      )}

      {/* Menu */}
      {venue && (
        <section className="flex flex-col gap-3">
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="text-lg font-semibold tracking-tight">Menu</h2>
            <p className="text-xs text-muted-foreground">Prices excl. tax &amp; gratuity</p>
          </div>
          {state.menuQ.isLoading || hasMenu ? (
            <div className="flex h-[70vh] min-h-[420px] flex-col overflow-hidden rounded-2xl border bg-card">
              <MenuBody
                periods={state.periods}
                activePeriodIdx={state.activePeriodIdx}
                onSwitchPeriod={state.switchPeriod}
                typeSections={state.typeSections}
                onJumpToType={state.jumpToType}
                sectionRefs={state.sectionRefs}
                scrollRef={state.scrollRef}
                pillsRef={state.pillsRef}
                twoColumn={!isMobile}
                menuIsLoading={state.menuQ.isLoading}
                highlightSlug={state.highlightSlug}
              />
            </div>
          ) : (
            <div className="rounded-2xl border bg-muted/30 py-16 text-center">
              <p className="font-medium">Menu not yet captured</p>
              <p className="mt-1 text-sm text-muted-foreground">
                We haven&apos;t recorded a menu for this venue yet — check back soon.
              </p>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
