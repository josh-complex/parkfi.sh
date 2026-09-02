"use client";

import * as React from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { ExternalLinkIcon, PhoneIcon } from "lucide-react";

import { DetailHero, HERO_BLEED, HERO_OVERLAY_TOP } from "#/components/detail-hero.tsx";
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
import {
  isPerPerson,
  MenuBody,
  slugifyMenuItem,
  useMenuState,
} from "#/components/dining/menu-content.tsx";
import { LocationMap } from "#/components/maps/location-map.tsx";
import {
  heroFlightKey,
  launchHeroReturn,
  releaseHeroFlight,
  useHeroFlight,
} from "#/components/park-map/card-flight.ts";
import { WalkThereButton } from "#/components/park-map/walk-there-button.tsx";
import { Badge } from "#/components/ui/badge.tsx";
import { Button } from "#/components/ui/button.tsx";
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

/**
 * The venue page's identity hero: the shared `DetailHero` shell plus dining's
 * own overlay chips — the live walk-up wait as the headline number on the left,
 * today's open state and the menu-freshness chip stacked on the right. Rendered
 * identically by the loaded page and the seeded loading state (see
 * `DetailHero` for why both configurations must match).
 */
function DiningHero({
  heroKey,
  name,
  subtitle,
  image,
  underlay,
  thumbhash,
  video,
  slides,
  flying,
  entrance,
  walkupWaitMin,
  walkupDetail,
  schedules,
  freshness,
  onFreshnessPress,
}: {
  heroKey: string;
  name: string;
  subtitle: string | null;
  image: string | null;
  /** The hero-crop preview the flight fades to in mid-air — see `DetailHero`. */
  underlay?: string | null;
  thumbhash?: string | null;
  video?: { url: string; poster?: string | null } | null;
  slides?: Array<{ url: string; alt: string | null }>;
  flying: boolean;
  entrance: boolean;
  /** Live walk-up minutes (signature TS venues) — the hero's headline number. */
  walkupWaitMin?: number | null;
  /** Per-party-size breakdown behind the walk-up chip's tooltip. */
  walkupDetail?: string;
  schedules?: Array<ScheduleEntry>;
  /** "Newly added" (new venue) vs "Freshly updated" (recent menu change). */
  freshness?: "new" | "updated" | null;
  /** Jump-to-item handler behind the "Freshly updated" chip. */
  onFreshnessPress?: () => void;
}) {
  const nowMin = parkNowMinutes();
  const sched = schedules ?? [];
  const hoursText = sched.length > 0 ? hoursLabel(sched) : null;
  const status = sched.length > 0 ? openStatus(sched, nowMin) : null;
  const isOpen = status === "open" || status === "closes-soon";
  return (
    <DetailHero
      heroKey={heroKey}
      name={name}
      subtitle={subtitle}
      image={image}
      underlay={underlay}
      thumbhash={thumbhash}
      video={video}
      slides={slides}
      flying={flying}
      entrance={entrance}
      overlays={({ chipFx }) => {
        const freshFx = chipFx(hoursText ? 1 : 0);
        return (
          <>
            {/* The headline number: the live walk-up list, when one is posted —
                dining's analogue of the ride hero's standby block. Not a flight
                landing target (POI cards fly no wait chip), so it just joins
                the entrance cascade. */}
            {walkupWaitMin != null && (
              <div
                style={chipFx(0).style}
                title={walkupDetail || undefined}
                className={cn(
                  "absolute left-4 flex items-center gap-2 rounded-2xl bg-black/75 px-3.5 py-2 text-white shadow-lg backdrop-blur-sm",
                  HERO_OVERLAY_TOP,
                  chipFx(0).className,
                )}
              >
                <span className="text-3xl font-bold leading-none tabular-nums sm:text-4xl">
                  {walkupWaitMin}
                </span>
                <span className="flex flex-col text-[10px] font-semibold uppercase leading-tight tracking-wide">
                  <span>min</span>
                  <span className="text-white/70">walk-up</span>
                </span>
              </div>
            )}

            {/* Open state + freshness, opposite the walk-up number. */}
            <div
              className={cn(
                "absolute right-4 flex max-w-[60%] flex-col items-end gap-1.5 text-right",
                HERO_OVERLAY_TOP,
              )}
            >
              {hoursText && (
                <span
                  style={chipFx(0).style}
                  title={openStatusDetail(sched, nowMin)}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-full bg-black/70 px-2.5 py-1 text-xs font-semibold text-white backdrop-blur-sm",
                    chipFx(0).className,
                  )}
                >
                  <span
                    className={cn(
                      "size-1.5 rounded-full",
                      isOpen ? "bg-emerald-400" : "bg-white/60",
                    )}
                  />
                  {isOpen ? "Open" : "Closed"} · {hoursText}
                </span>
              )}
              {freshness === "new" && (
                <span
                  style={freshFx.style}
                  className={cn(
                    "rounded-full bg-emerald-400/90 px-2.5 py-1 text-[11px] font-semibold text-emerald-950 backdrop-blur-sm",
                    freshFx.className,
                  )}
                >
                  Newly added
                </span>
              )}
              {freshness === "updated" && (
                <button
                  type="button"
                  onClick={onFreshnessPress}
                  style={freshFx.style}
                  className={cn(
                    "cursor-pointer rounded-full bg-emerald-400/90 px-2.5 py-1 text-[11px] font-semibold text-emerald-950 backdrop-blur-sm",
                    freshFx.className,
                  )}
                >
                  Freshly updated
                </button>
              )}
            </div>
          </>
        );
      }}
    />
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
            dateFormat="PP"
            className="h-8 flex-1 md:w-40 md:flex-none"
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
            variant="outline"
            className="size-8"
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
  const venueQ = useQuery(trpc.dining.venue.queryOptions({ facilityId }));
  const venue = venueQ.data;
  const hoursQ = useQuery(trpc.dining.hours.queryOptions({}));
  const state = useMenuState(facilityId, true, targetItemSlug);
  // Set when this page was opened by tapping a map POI card: the card's own
  // name, subtitle and photo, plus whether its flown clones are still in the
  // air (see `card-flight.ts`).
  const heroKey = heroFlightKey("dining", facilityId);
  const flight = useHeroFlight(heroKey);
  // Heading back to a map view, pop the hero down into its marker. A *layout*
  // effect, deliberately: its cleanup runs while the page is still in the DOM
  // (so the hero can be measured and cloned) but with history already pointing
  // at the destination (so the flight knows this exit is map-bound).
  React.useLayoutEffect(() => () => launchHeroReturn(heroKey), [heroKey]);
  // Drop the seed on the way out, so coming back later from somewhere that
  // isn't the map doesn't paint a stale hero from it.
  React.useEffect(() => () => releaseHeroFlight(heroKey), [heroKey]);

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
  // The hero's overlaid one-liner, mirroring the ride hero's "Park · Land" (and
  // the flight seed's construction of the same, so a map-launched hero doesn't
  // reword when the venue query lands).
  const heroSubtitle = venue
    ? [venue.parkResort, venue.land && venue.land !== venue.parkResort ? venue.land : null]
        .filter(Boolean)
        .join(" · ")
    : null;

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
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-4 lg:p-6">
      {/* Cast-member-only; renders nothing for everyone else, so it adds no gap. */}
      <RemovalRequestDialog
        entityType="restaurant"
        entityId={facilityId}
        entityName={venue?.name}
        className="hidden self-end md:inline-flex"
      />

      {/* Header. The loading shell mirrors the loaded branch — same <header>
          wrapper, hero first — so React reconciles the hero into the *same*
          DOM node when the venue query lands mid-flight (a remount would
          replay the image fade and orphan the flight's settle listeners). */}
      {venueQ.isLoading ? (
        <header className="flex flex-col gap-4">
          {/* Arriving from a map POI card, the hero is already known — paint it
              from the card's seed rather than a grey block, so the flown clones
              land on the real thing. */}
          {flight ? (
            <DiningHero
              heroKey={heroKey}
              name={flight.seed.name}
              subtitle={flight.seed.subtitle}
              image={flight.seed.imageUrl}
              underlay={flight.seed.previewImageUrl ?? flight.seed.cardImageUrl}
              flying={flight.flying}
              entrance
              schedules={schedules}
            />
          ) : (
            /* Same bleed as the real hero, so data landing doesn't shift the page. */
            <Skeleton className={HERO_BLEED} />
          )}
          <Skeleton className="h-6 w-64" />
          <Skeleton className="h-4 w-40" />
        </header>
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
          {/* Identity hero, matching the ride pages: full-bleed photo (or
              gradient), name + location overlaid, live walk-up wait and open
              state on top. The old in-flow name/location/hours rows all live on
              the hero now; only what the hero can't carry stays below. */}
          <DiningHero
            heroKey={heroKey}
            name={venue.name}
            subtitle={heroSubtitle}
            image={venue.imageUrl}
            // Identical expression to the loading shell's, so the underlay
            // <img> keeps its src (and stays decoded) across the query landing.
            underlay={flight ? (flight.seed.previewImageUrl ?? flight.seed.cardImageUrl) : null}
            thumbhash={venue.imageThumbhash}
            video={venueHeroVideo}
            slides={venueHeroSlides}
            flying={flight?.flying ?? false}
            entrance={!!flight}
            walkupWaitMin={venue.walkupWaitMin}
            walkupDetail={(venue.walkupPartySizes ?? [])
              .filter((p) => p.waitMin != null)
              .map((p) => `Party of ${p.partySize}: ~${p.waitMin} min`)
              .join(" · ")}
            schedules={schedules}
            freshness={isNewVenue ? "new" : freshChange ? "updated" : null}
            onFreshnessPress={jumpToFreshItem}
          />
          <div className="flex flex-col gap-2">
            {/* The hero subtitle already names the park/resort and land; this
                row adds what it can't — the resort cross-link and the cuisine /
                experience type. */}
            {(resortSlug || subtitleRest) && (
              <p className="text-muted-foreground flex flex-wrap items-center gap-x-1.5">
                {resortSlug && (
                  <Link
                    to="/resort/$slug"
                    params={{ slug: resortSlug }}
                    className="hover:text-foreground hover:underline"
                  >
                    {venue.parkResort}
                  </Link>
                )}
                {resortSlug && subtitleRest && <span aria-hidden>·</span>}
                {subtitleRest && <span>{subtitleRest}</span>}
              </p>
            )}
            <VenueBadges venue={venue} />
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
