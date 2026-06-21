"use client";

import * as React from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { ArrowLeftIcon, ExternalLinkIcon, MapPinIcon } from "lucide-react";

import { DiningAlertButton } from "#/components/dining/dining-alert-button.tsx";
import { taxonomyLabel } from "#/components/dining/dining-filters.ts";
import {
  hoursLabel,
  openStatus,
  openStatusDetail,
  parkNowMinutes,
  parkToday,
  type ScheduleEntry,
} from "#/components/dining/dining-hours.ts";
import { AvailabilityCalendar } from "#/components/dining/dining-restaurant-card.tsx";
import { MenuBody, useMenuState } from "#/components/dining/menu-content.tsx";
import { LocationMap } from "#/components/maps/location-map.tsx";
import { Badge } from "#/components/ui/badge.tsx";
import { DatePicker } from "#/components/ui/date-picker.tsx";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "#/components/ui/select.tsx";
import { Skeleton } from "#/components/ui/skeleton.tsx";
import { useIsMobile } from "#/hooks/use-mobile.ts";
import { useTRPC } from "#/integrations/trpc/react.ts";
import { authClient } from "#/lib/auth-client.ts";
import { cn } from "#/lib/utils.ts";

/** A venue's attribute badges — price, format, dining plan, discounts, perks. */
function VenueBadges({
  venue,
}: {
  venue: {
    requiresParkTicket: boolean;
    characterDining: boolean;
    dinnerShow: boolean;
    diningPackage: boolean;
    fineDining: boolean;
    walkupWaitList: boolean;
    mobileOrder: boolean;
    annualPassDiscount: boolean;
    disneyVisaDiscount: boolean;
    tripAdvisorAward: boolean;
    diningPlanQs: boolean;
    diningPlanTs: boolean;
    maximumPartySize: number | null;
    priceRange: string | null;
  };
}) {
  const planTiers = [venue.diningPlanQs && "QS", venue.diningPlanTs && "TS"].filter(
    Boolean,
  ) as Array<string>;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {venue.priceRange && (
        <Badge variant="outline" className="font-normal">
          {venue.priceRange}
        </Badge>
      )}
      {venue.requiresParkTicket && (
        <Badge className="bg-yellow-400 text-black hover:bg-yellow-400">Needs Park Entry</Badge>
      )}
      {venue.characterDining && <Badge variant="secondary">Characters</Badge>}
      {venue.dinnerShow && <Badge variant="secondary">Dinner show</Badge>}
      {venue.diningPackage && <Badge variant="secondary">Package</Badge>}
      {venue.fineDining && <Badge variant="secondary">Signature</Badge>}
      {venue.walkupWaitList && <Badge variant="secondary">Walk-up list</Badge>}
      {venue.mobileOrder && <Badge variant="secondary">Mobile order</Badge>}
      {planTiers.length > 0 && (
        <Badge variant="secondary">Dining Plan: {planTiers.join(" + ")}</Badge>
      )}
      {venue.annualPassDiscount && <Badge variant="secondary">Annual Pass discount</Badge>}
      {venue.disneyVisaDiscount && <Badge variant="secondary">Disney Visa discount</Badge>}
      {venue.tripAdvisorAward && <Badge variant="secondary">TripAdvisor award</Badge>}
      {venue.maximumPartySize != null && (
        <Badge variant="outline" className="font-normal">
          Max party {venue.maximumPartySize}
        </Badge>
      )}
    </div>
  );
}

/** Open-now / closing-soon / closed chip for a venue's schedule today. */
function HoursChip({ schedules }: { schedules: Array<ScheduleEntry> }) {
  const nowMin = parkNowMinutes();
  const status = openStatus(schedules, nowMin);
  const label = hoursLabel(schedules);
  if (!label) return null;
  const isOpen = status === "open" || status === "closes-soon";
  return (
    <Badge
      variant="secondary"
      title={openStatusDetail(schedules, nowMin)}
      className={cn(
        "font-normal",
        isOpen
          ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
          : "text-muted-foreground",
      )}
    >
      {isOpen ? "Open" : "Closed"} · {label}
    </Badge>
  );
}

const PARTY_SIZES = [1, 2, 3, 4, 5, 6, 7, 8];
const AVAIL_HORIZON = 60;
const ISO = "yyyy-MM-dd";

/**
 * Inline reservation-availability search for venues we actively sweep. Date and
 * party size both drive the search: `dining.availability` returns a 60-day
 * horizon for the chosen party (so changing the date just re-slices, no refetch),
 * the picked date's status is called out, and a 7-day strip anchored on it gives
 * surrounding context. An "alert me" bell watches the same date + party.
 */
function ReservationsSection({
  facilityId,
  restaurantName,
}: {
  facilityId: string;
  restaurantName: string;
}) {
  const trpc = useTRPC();
  const { data: session } = authClient.useSession();
  const [partySize, setPartySize] = React.useState(2);

  const todayIso = parkToday();
  const today = React.useMemo(() => new Date(`${todayIso}T00:00:00`), [todayIso]);
  // Disney doesn't take same-day reservations, so the search starts tomorrow.
  const tomorrow = React.useMemo(() => {
    const d = new Date(today);
    d.setDate(d.getDate() + 1);
    return d;
  }, [today]);
  const maxDate = React.useMemo(() => {
    const d = new Date(today);
    d.setDate(d.getDate() + AVAIL_HORIZON - 1);
    return d;
  }, [today]);
  const [date, setDate] = React.useState<Date | undefined>(tomorrow);
  const selectedIso = date ? format(date, ISO) : format(tomorrow, ISO);

  const availabilityQ = useQuery(
    trpc.dining.availability.queryOptions({ facilityId, partySize, days: AVAIL_HORIZON }),
  );
  const days = availabilityQ.data?.find((e) => e.facilityId === facilityId)?.days ?? [];
  const fromSelected = days.filter((d) => d.date >= selectedIso);
  const selected = days.find((d) => d.date === selectedIso);
  const dateLabel = date ? format(date, "EEE, MMM d") : "your date";

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold tracking-tight">Reservations</h2>
        <div className="flex flex-wrap items-center gap-2">
          <DatePicker
            value={date}
            onChange={setDate}
            fromDate={tomorrow}
            toDate={maxDate}
            placeholder="Pick a date"
            className="h-8 w-44"
          />
          <Select value={String(partySize)} onValueChange={(v) => v && setPartySize(Number(v))}>
            <SelectTrigger size="sm" className="w-32" aria-label="Party size">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PARTY_SIZES.map((n) => (
                <SelectItem key={n} value={String(n)}>
                  {n} {n === 1 ? "guest" : "guests"}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <DiningAlertButton
            facilityId={facilityId}
            restaurantName={restaurantName}
            defaultPartySize={partySize}
            loggedIn={!!session?.user}
          />
        </div>
      </div>
      <div className="rounded-2xl border bg-card p-4">
        {availabilityQ.isLoading ? (
          <Skeleton className="h-12 w-full" />
        ) : days.length > 0 ? (
          <div className="flex flex-col gap-3">
            <p className="text-sm">
              {selected?.available ? (
                <>
                  <span className="font-medium text-emerald-700 dark:text-emerald-400">
                    {selected.offerCount} reservation{selected.offerCount === 1 ? "" : "s"}
                  </span>{" "}
                  <span className="text-muted-foreground">
                    on {dateLabel} · party of {partySize}
                    {selected.mealPeriods.length > 0 ? ` · ${selected.mealPeriods.join(", ")}` : ""}
                  </span>
                </>
              ) : (
                <span className="text-muted-foreground">
                  No reservations on {dateLabel} for a party of {partySize} — try another date or
                  party size, or set an alert.
                </span>
              )}
            </p>
            {fromSelected.length > 0 && (
              <AvailabilityCalendar days={fromSelected} windowDays={7} referenceDate={todayIso} />
            )}
          </div>
        ) : (
          <p className="py-4 text-center text-sm text-muted-foreground">
            No reservation availability recorded yet — try a different party size, or set an alert
            above.
          </p>
        )}
      </div>
    </section>
  );
}

/**
 * Standalone restaurant detail page body: a venue header (image, attributes,
 * hours, location, taxonomy), an inline reservations strip for swept venues, and
 * the full menu, rendered inline (not in a modal). `targetItemSlug` comes from a
 * `#menu-<slug>` deep link — it auto-selects the right meal period, scrolls to the
 * item, and highlights it briefly. The menu rendering is shared with the board's
 * menu drawer via `menu-content.tsx`.
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
  const hoursQ = useQuery(trpc.dining.hours.queryOptions({}));
  const state = useMenuState(facilityId, true, targetItemSlug);

  const subtitle = venue
    ? [venue.parkResort, venue.experienceType ?? venue.cuisine].filter(Boolean).join(" · ")
    : "";

  const schedules = hoursQ.data?.find((h) => h.facilityId === facilityId)?.schedules ?? [];

  // Deduped, prettified taxonomy chips from the finder's interest/franchise tags.
  const taxonomy = venue
    ? [...new Set([...venue.diningInterests, ...venue.disneyFavorites])]
        .map((slug) => taxonomyLabel(slug))
        .filter((label): label is string => label != null)
    : [];

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
            {venue.land && (
              <p className="inline-flex items-center gap-1 text-sm text-muted-foreground">
                <MapPinIcon className="size-3.5" />
                {venue.land}
              </p>
            )}
            <div className="flex flex-wrap items-center gap-1.5">
              {schedules.length > 0 && <HoursChip schedules={schedules} />}
              <VenueBadges venue={venue} />
            </div>
            {taxonomy.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5">
                {taxonomy.map((label) => (
                  <Badge key={label} variant="outline" className="font-normal">
                    {label}
                  </Badge>
                ))}
              </div>
            )}
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

      {/* Reservations — only for venues we actively sweep for availability. */}
      {venue?.availabilityEligible && (
        <ReservationsSection facilityId={facilityId} restaurantName={venue.name} />
      )}

      {/* Location map — Disney venues carry finder coordinates (UOR may not). */}
      {venue?.latitude != null && venue.longitude != null && (
        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold tracking-tight">Location</h2>
          <LocationMap
            latitude={venue.latitude}
            longitude={venue.longitude}
            label={venue.name}
            zoom={17}
            caption={[venue.land, venue.parkResort].filter(Boolean).join(", ") || undefined}
            className="h-56 w-full overflow-hidden rounded-2xl border sm:h-72"
          />
        </section>
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
