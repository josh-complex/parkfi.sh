"use client";

import * as React from "react";
import { getRouteApi, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { ArrowLeftIcon, ExternalLinkIcon, MapPinIcon, PhoneIcon } from "lucide-react";

import { AmbientHeroVideo, HeroCrossfade } from "#/components/hero-media.tsx";
import { DiningAlertButton } from "#/components/dining/dining-alert-button.tsx";
import { taxonomyLabel } from "#/components/dining/dining-filters.ts";
import { diningTrail } from "#/components/dining/dining-search-params.ts";
import {
  hoursLabel,
  openStatus,
  openStatusDetail,
  parkNowMinutes,
  parkToday,
  type ScheduleEntry,
} from "#/components/dining/dining-hours.ts";
import { AvailabilityCalendar } from "#/components/dining/dining-restaurant-card.tsx";
import {
  isPerPerson,
  MenuBody,
  slugifyMenuItem,
  useMenuState,
} from "#/components/dining/menu-content.tsx";
import { LocationMap } from "#/components/maps/location-map.tsx";
import { WalkThereButton } from "#/components/park-map/walk-there-button.tsx";
import { Badge } from "#/components/ui/badge.tsx";
import { Button } from "#/components/ui/button.tsx";
import { Image } from "#/components/ui/image.tsx";
import { disneyResizeUrl } from "#/lib/image.ts";
import { Card } from "#/components/ui/card.tsx";
import { DatePicker } from "#/components/ui/date-picker.tsx";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "#/components/ui/select.tsx";
import { Skeleton } from "#/components/ui/skeleton.tsx";
import { useIsNative } from "#/hooks/use-is-native.ts";
import { useIsMobile } from "#/hooks/use-mobile.ts";
import { RemovalRequestDialog } from "#/components/removal-request-dialog.tsx";
import { resortSlugByName } from "#/components/stays/resort-detail.tsx";
import { useTRPC } from "#/integrations/trpc/react.ts";
import { authClient } from "#/lib/auth-client.ts";
import { cn } from "#/lib/utils.ts";

const venueRoute = getRouteApi("/_app/dining_/$facilityId");

/** Items/venues first seen within this many days read as "new". */
const NEW_WINDOW_DAYS = 30;

function isWithinDays(iso: string | null | undefined, days: number): boolean {
  if (!iso) return false;
  const t = Date.parse(iso);
  return Number.isFinite(t) && Date.now() - t <= days * 86_400_000;
}

// UOR places-feed accessibility slugs → chip labels (unknown slugs drop).
const ACCESSIBILITY_LABELS: Record<string, string> = {
  "accessible-in-wheelchair": "Wheelchair accessible",
  "accessible-in-ecv": "ECV accessible",
  "stationary-seating": "Stationary seating",
};

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
    apDiscountPct: number | null;
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
      {venue.annualPassDiscount && (
        <Badge variant="secondary">
          {/* Disney publishes a % for some venues (plan item 2.3) — show it. */}
          {venue.apDiscountPct != null
            ? `Annual Pass ${venue.apDiscountPct}% off`
            : "Annual Pass discount"}
        </Badge>
      )}
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
 * Disney's web reservation flow for a venue, keyed by the finder slug
 * (`url_friendly_id`) — e.g. `…/dine-res/restaurant/morimoto-asia`. This is the
 * web equivalent of the native `mdx://dining/reservation` deep link (it lands on
 * the bookable page), so it's the web fallback — not the venue *detail* page.
 * Falls back to the finder detail URL for the ~2 venues missing a slug.
 */
function diningReserveUrl(urlFriendlyId: string | null, detailUrl: string | null): string | null {
  if (urlFriendlyId) {
    return `https://disneyworld.disney.go.com/dine-res/restaurant/${urlFriendlyId}`;
  }
  return detailUrl;
}

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
  webUrl,
  minPartySize,
  maxPartySize,
  maxAdvanceDays,
}: {
  facilityId: string;
  restaurantName: string;
  /** Disney's official venue page — the web fallback when MDE isn't installed. */
  webUrl: string | null;
  /** UOR reservation bounds (plan item 3.2); null for WDW / unswept venues. */
  minPartySize: number | null;
  maxPartySize: number | null;
  maxAdvanceDays: number | null;
}) {
  const trpc = useTRPC();
  const native = useIsNative();
  const { data: session } = authClient.useSession();

  // Party-size options bounded by the venue's real limits when known.
  const partyOptions = React.useMemo(() => {
    const lo = minPartySize ?? PARTY_SIZES[0];
    const hi = maxPartySize ?? PARTY_SIZES[PARTY_SIZES.length - 1];
    const opts = PARTY_SIZES.filter((n) => n >= lo && n <= hi);
    return opts.length > 0 ? opts : PARTY_SIZES;
  }, [minPartySize, maxPartySize]);
  const [partySize, setPartySize] = React.useState(() =>
    partyOptions.includes(2) ? 2 : partyOptions[0],
  );

  const todayIso = parkToday();
  const today = React.useMemo(() => new Date(`${todayIso}T00:00:00`), [todayIso]);
  // Same-day reservations are bookable, so the search starts today — the sweep
  // records today's service date and `dining.availability` returns it. Cap the
  // picker at the venue's advance window when it's tighter than our sweep horizon.
  const maxDate = React.useMemo(() => {
    const horizon =
      maxAdvanceDays != null ? Math.min(AVAIL_HORIZON, maxAdvanceDays) : AVAIL_HORIZON;
    const d = new Date(today);
    d.setDate(d.getDate() + horizon - 1);
    return d;
  }, [today, maxAdvanceDays]);
  const [date, setDate] = React.useState<Date | undefined>(today);
  const selectedIso = date ? format(date, ISO) : todayIso;

  const availabilityQ = useQuery(
    trpc.dining.availability.queryOptions({ facilityId, partySize, days: AVAIL_HORIZON }),
  );
  const days = availabilityQ.data?.find((e) => e.facilityId === facilityId)?.days ?? [];
  const fromSelected = days.filter((d) => d.date >= selectedIso);
  const selected = days.find((d) => d.date === selectedIso);
  const dateLabel = date ? format(date, "EEE, MMM d") : "your date";

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-col gap-3 md:flex-row md:flex-wrap md:items-center md:justify-between">
        <h2 className="text-lg font-semibold tracking-tight">Reservations</h2>
        <div className="flex w-full items-center gap-2 md:w-auto">
          <DatePicker
            value={date}
            onChange={setDate}
            fromDate={today}
            toDate={maxDate}
            placeholder="Pick a date"
            className="h-8 flex-1 md:w-44 md:flex-none"
          />
          <Select value={String(partySize)} onValueChange={(v) => v && setPartySize(Number(v))}>
            <SelectTrigger size="sm" className="w-28 shrink-0" aria-label="Party size">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {partyOptions.map((n) => (
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
      {(maxPartySize != null || maxAdvanceDays != null) && (
        <p className="text-xs text-muted-foreground">
          {minPartySize != null && maxPartySize != null && (
            <>
              Parties {minPartySize}–{maxPartySize}
            </>
          )}
          {minPartySize != null && maxPartySize != null && maxAdvanceDays != null && " · "}
          {maxAdvanceDays != null && <>bookable up to {maxAdvanceDays} days out</>}
        </p>
      )}
      <Card size="sm" className="px-4">
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
            {selected?.available &&
              // Native: the `mdx://` link opens MDE straight into the booking
              // flow. Web: that scheme dead-ends in a browser, so fall back to
              // Disney's reservable venue page.
              (() => {
                const href = native ? selected.deepLink : webUrl;
                if (!href) return null;
                return (
                  <Button
                    size="sm"
                    className="w-fit gap-1.5"
                    render={<a href={href} target="_blank" rel="noreferrer" />}
                  >
                    {native ? "Book in Disney App" : "Reserve on Disney.com"}
                    <ExternalLinkIcon className="size-3.5" />
                  </Button>
                );
              })()}
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
      </Card>
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
  scrollToMenu,
}: {
  facilityId: string;
  targetItemSlug?: string | null;
  scrollToMenu?: boolean;
}) {
  const trpc = useTRPC();
  const isMobile = useIsMobile();
  // The dining search carried in via the results link — powers the breadcrumb.
  const search = venueRoute.useSearch();
  const trail = diningTrail(search);
  const venueQ = useQuery(trpc.dining.venue.queryOptions({ facilityId }));
  const venue = venueQ.data;
  const hoursQ = useQuery(trpc.dining.hours.queryOptions({}));
  const state = useMenuState(facilityId, true, targetItemSlug);

  // A bare `#menu` deep link (recently-updated shelf) scrolls to the menu
  // section once the venue + menu have rendered — a native hash jump would fire
  // before the async content exists and land at the wrong offset.
  const menuSectionRef = React.useRef<HTMLElement>(null);
  const menuReady = !!venue && !state.menuQ.isLoading;
  React.useEffect(() => {
    if (!scrollToMenu || !menuReady) return;
    menuSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [scrollToMenu, menuReady]);

  // A resort-hosted venue (no park ticket required) cross-links back to its
  // resort's detail page; theme-park venues just show the plain text.
  const resortSlug =
    venue && !venue.requiresParkTicket && venue.parkResort
      ? resortSlugByName(venue.parkResort)
      : null;
  const subtitleRest = venue ? (venue.experienceType ?? venue.cuisine) : null;

  const schedules = hoursQ.data?.find((h) => h.facilityId === facilityId)?.schedules ?? [];

  // Venue hero media (plan item 1.9 follow-up): slide 0 is the best ambient
  // asset (the normalizer orders cinemagraph → video → stills). Without a
  // video, the gallery stills crossfade over the base image (de-duped sans
  // query — CDN timestamps churn).
  const venueHeroVideo = venue?.heroMedia.find((s) => s.kind === "video") ?? null;
  const venueHeroSlides: Array<{ url: string; alt: string | null }> = [];
  if (venue && !venueHeroVideo) {
    const baseKey = venue.imageUrl?.split("?")[0];
    const seen = new Set(baseKey ? [baseKey] : []);
    for (const s of venue.heroMedia) {
      if (s.kind !== "image") continue;
      const key = s.url.split("?")[0];
      if (seen.has(key)) continue;
      seen.add(key);
      venueHeroSlides.push({ url: s.url, alt: s.alt });
    }
  }

  // Deduped, prettified taxonomy chips from the finder's interest/franchise
  // tags, plus the UOR places-feed accessibility slugs (WDW rows carry none).
  const taxonomy = venue
    ? [
        ...[...new Set([...venue.diningInterests, ...venue.disneyFavorites])]
          .map((slug) => taxonomyLabel(slug))
          .filter((label): label is string => label != null),
        ...venue.accessibility
          .map((slug) => ACCESSIBILITY_LABELS[slug])
          .filter((label): label is string => label != null),
      ]
    : [];

  const hasMenu = state.periods.length > 0;

  // Some venues price dishes per guest (family-style, prix-fixe). When any are
  // present, offer a party-size control so the menu can show party totals.
  const [guestCount, setGuestCount] = React.useState(2);
  const hasPerPersonItems = React.useMemo(
    () =>
      state.periods.some((p) =>
        p.groups.some((g) => g.items.some((it) => isPerPerson(it.priceType))),
      ),
    [state.periods],
  );

  // The header chip distinguishes a brand-new venue from an established one whose
  // menu just changed. A new venue's items are all new too, so "Newly added"
  // subsumes any item activity; only when the venue itself isn't new do we surface
  // recent menu changes as a "Freshly updated" chip. Prefer a freshly-added item
  // as the jump target so the chip lands the reader on something genuinely new.
  const isNewVenue = !!venue && isWithinDays(venue.firstSeenAt, NEW_WINDOW_DAYS);
  const freshChange = React.useMemo(() => {
    if (isNewVenue) return null;
    const added = state.recentChanges.find((c) => c.kind === "added");
    return added ?? state.recentChanges[0] ?? null;
  }, [isNewVenue, state.recentChanges]);

  function jumpToFreshItem() {
    if (!freshChange) return;
    state.focusItem(slugifyMenuItem(freshChange.title));
    menuSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 pt-2 pb-6 lg:px-6">
      {/* Tuck the breadcrumb tight under the header, matching the eats search /
          cuisine-chip rhythm. The header (py-3) + wrapper (pt-2) leave ~20px
          above it, so trim the section gap to leave the same below. */}
      <div className="-mb-1 hidden items-center justify-between gap-3 md:flex">
        <nav className="flex-wrap items-center gap-1.5 text-sm text-muted-foreground">
          <Link
            to="/dining"
            search={{}}
            className="inline-flex items-center gap-1.5 hover:underline"
          >
            <ArrowLeftIcon className="size-3.5" />
            All dining
          </Link>
          {trail.map((label, i) => (
            <React.Fragment key={`${label}-${i}`}>
              <span aria-hidden>/</span>
              {/* Every crumb returns to the same filtered list — the facets are
                parallel, so there's no deeper level to drill into. */}
              <Link to="/dining" search={search} className="hover:underline">
                {label}
              </Link>
            </React.Fragment>
          ))}
        </nav>
        <RemovalRequestDialog
          entityType="restaurant"
          entityId={facilityId}
          entityName={venue?.name}
        />
      </div>

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
          {(venue.imageUrl || venueHeroVideo) && (
            <div className="relative h-40 w-full overflow-hidden rounded-2xl bg-muted sm:h-56 lg:h-64">
              {venue.imageUrl && (
                <Image
                  src={disneyResizeUrl(venue.imageUrl, 1600)}
                  alt={venue.name}
                  className="size-full object-cover"
                  loading="eager"
                  fetchPriority="high"
                  sizes="100vw"
                  quality={80}
                  // Box is h-40/sm:h-56/lg:h-64 at full width — worst case ~2.4:1
                  // on a small phone. Same banner crop as the park-dashboard hero.
                  aspect={12 / 5}
                  placeholder={venue.imageThumbhash}
                />
              )}
              {/* Ambient loop / stills crossfade from the venue's mediaEngine
                  collection (plan item 1.9 follow-up). */}
              {venueHeroVideo ? (
                <AmbientHeroVideo src={venueHeroVideo.url} poster={venueHeroVideo.poster ?? null} />
              ) : (
                <HeroCrossfade slides={venueHeroSlides} />
              )}
            </div>
          )}
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{venue.name}</h1>
              {isNewVenue ? (
                <Badge className="bg-emerald-500/15 text-emerald-700 hover:bg-emerald-500/15 dark:text-emerald-400">
                  Newly added
                </Badge>
              ) : freshChange ? (
                <button type="button" onClick={jumpToFreshItem} className="cursor-pointer">
                  <Badge className="bg-emerald-500/15 text-emerald-700 hover:bg-emerald-500/25 dark:text-emerald-400">
                    Freshly updated
                  </Badge>
                </button>
              ) : null}
            </div>
            {(venue.parkResort || subtitleRest) && (
              <p className="text-muted-foreground flex flex-wrap items-center gap-x-1.5">
                {venue.parkResort &&
                  (resortSlug ? (
                    <Link
                      to="/resort/$slug"
                      params={{ slug: resortSlug }}
                      className="hover:text-foreground hover:underline"
                    >
                      {venue.parkResort}
                    </Link>
                  ) : (
                    <span>{venue.parkResort}</span>
                  ))}
                {venue.parkResort && subtitleRest && <span aria-hidden>·</span>}
                {subtitleRest && <span>{subtitleRest}</span>}
              </p>
            )}
            {venue.land && venue.land !== venue.parkResort && (
              <p className="inline-flex items-center gap-1 text-sm text-muted-foreground">
                <MapPinIcon className="size-3.5" />
                {venue.land}
              </p>
            )}
            <div className="flex flex-wrap items-center gap-1.5">
              {schedules.length > 0 && <HoursChip schedules={schedules} />}
              {/* Live walk-up waitlist (plan item 1.2) — signature TS venues. */}
              {venue.walkupWaitMin != null && (
                <Badge
                  variant="secondary"
                  className="bg-sky-500/15 font-normal text-sky-700 dark:text-sky-400"
                  title={(venue.walkupPartySizes ?? [])
                    .filter((p) => p.waitMin != null)
                    .map((p) => `Party of ${p.partySize}: ~${p.waitMin} min`)
                    .join(" · ")}
                >
                  Walk-up ~{venue.walkupWaitMin} min
                </Badge>
              )}
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
            {/* Official marketing copy (plan item 2.3). */}
            {venue.description && (
              <p className="max-w-prose text-sm text-muted-foreground">{venue.description}</p>
            )}
            {(venue.detailUrl || venue.phone) && (
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                {venue.phone && (
                  <a
                    href={`tel:${venue.phone}`}
                    className="inline-flex w-fit items-center gap-1.5 text-sm text-primary hover:underline"
                  >
                    <PhoneIcon className="size-3.5" />
                    {venue.phone}
                  </a>
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
            )}
          </div>
        </header>
      )}

      {/* Reservations — only for venues we actively sweep for availability. */}
      {venue?.availabilityEligible && (
        <ReservationsSection
          facilityId={facilityId}
          restaurantName={venue.name}
          webUrl={diningReserveUrl(venue.urlFriendlyId, venue.detailUrl)}
          minPartySize={venue.minPartySize}
          maxPartySize={venue.maxPartySize}
          maxAdvanceDays={venue.maxAdvanceDays}
        />
      )}

      {/* Location map — Disney venues carry finder coordinates (UOR may not). */}
      {venue?.latitude != null && venue.longitude != null && (
        <section className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-semibold tracking-tight">Location</h2>
            {/* Walking-nav entry point (§4.2) — routes to the venue on the map. */}
            <WalkThereButton
              name={venue.name}
              latitude={venue.latitude}
              longitude={venue.longitude}
            />
          </div>
          <LocationMap
            latitude={venue.latitude}
            longitude={venue.longitude}
            label={venue.name}
            zoom={17}
            caption={
              [...new Set([venue.land, venue.parkResort].filter(Boolean))].join(", ") || undefined
            }
            className="h-48 w-full overflow-hidden rounded-2xl border sm:h-72"
          />
        </section>
      )}

      {/* Menu */}
      {venue && (
        <section id="menu" ref={menuSectionRef} className="flex scroll-mt-16 flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
            <h2 className="text-lg font-semibold tracking-tight">Menu</h2>
            <div className="flex items-center gap-3">
              {hasPerPersonItems && (
                <Select
                  value={String(guestCount)}
                  onValueChange={(v) => v && setGuestCount(Number(v))}
                >
                  <SelectTrigger size="sm" className="w-28 shrink-0" aria-label="Guests">
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
              )}
              <p className="text-xs text-muted-foreground">Prices excl. tax &amp; gratuity</p>
            </div>
          </div>
          {state.menuQ.isLoading || hasMenu ? (
            <div className="flex h-[60vh] min-h-0 flex-col overflow-hidden rounded-2xl border bg-card sm:h-[70vh] sm:min-h-[420px]">
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
                changesBySlug={state.changesBySlug}
                newSlugs={state.newSlugs}
                facilityId={facilityId}
                recentChanges={state.recentChanges}
                viewingChanges={state.viewingChanges}
                onShowChanges={state.showChanges}
                guestCount={guestCount}
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
