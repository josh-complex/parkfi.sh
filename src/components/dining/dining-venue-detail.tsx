"use client";

import * as React from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import {
  CalendarIcon,
  BookOpenTextIcon,
  ChevronRightIcon,
  ExternalLinkIcon,
  Maximize2Icon,
  Minimize2Icon,
  PhoneIcon,
  XIcon,
} from "lucide-react";

import { ACTION_BAR_PAGE_PAD, DetailActionBar } from "#/components/detail/action-bar.tsx";
import { Band, BandHeading } from "#/components/detail/band.tsx";
import { DayHeatGrid, WeekdayBars } from "#/components/detail/day-series.tsx";
import { MoreKey, PunchDay, TimeKey } from "#/components/detail/keys.tsx";
import { DetailCard, FactTile, TintPanel, WashPanel } from "#/components/detail/panels.tsx";
import { RightSheet } from "#/components/detail/right-sheet.tsx";
import { TimeBandStrip } from "#/components/detail/time-bands.tsx";
import { PAGE_WIDTH } from "#/components/page-container.tsx";
import {
  TICKET_DEFAULT_CREASE,
  Ticket,
  TicketChip,
  type TicketFact,
} from "#/components/detail/ticket.tsx";
import {
  DetailHero,
  HERO_BLEED,
  HERO_CREASE_ALIGNED,
  HERO_OVERLAY_HEADLINE,
  HERO_PAGE_PADDING,
  HERO_UNDER_NAV,
} from "#/components/detail-hero.tsx";
import { DiningAlertButton } from "#/components/dining/dining-alert-button.tsx";
import { EatHere } from "#/components/dining/eat-here.tsx";
import { useVenueHours, VenueHours } from "#/components/dining/venue-hours.tsx";
import {
  byMealPeriod,
  cuisineList,
  daysOutLabel,
  offerTimeLabel,
  taxonomyLabel,
  type DayEntry,
  type Offer,
} from "#/components/dining/dining-filters.ts";
import {
  OPEN_STATUS_LABELS,
  openStatus,
  openStatusDetail,
  parkNowMinutes,
  parkToday,
  type ScheduleEntry,
} from "#/components/dining/dining-hours.ts";
import {
  formatPrice,
  isPerPerson,
  MenuBody,
  slugifyMenuItem,
  useMenuState,
  type MenuItemData,
} from "#/components/dining/menu-content.tsx";
import {
  findDishCover,
  findFoodPhoto,
  rankTeaserDishes,
  type TeaserCandidate,
} from "#/components/dining/menu-teaser.ts";
import { LocationMap } from "#/components/maps/location-map.tsx";
import { ParkNews } from "#/components/park-dashboard/park-news.tsx";
import {
  heroFlightKey,
  launchHeroReturn,
  releaseHeroFlight,
  useHeroFlight,
} from "#/components/park-map/card-flight.ts";
import { WalkThereButton } from "#/components/park-map/walk-there-button.tsx";
import { Button } from "#/components/ui/button.tsx";
import { DatePicker } from "#/components/ui/date-picker.tsx";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from "#/components/ui/drawer.tsx";
import { Image } from "#/components/ui/image.tsx";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "#/components/ui/select.tsx";
import { Skeleton } from "#/components/ui/skeleton.tsx";
import { useIsNative } from "#/hooks/use-is-native.ts";
import { useHydrated } from "#/lib/use-hydrated.ts";
import { useIsMobile } from "#/hooks/use-mobile.ts";
import { RemovalRequestDialog } from "#/components/removal-request-dialog.tsx";
import { resortSlugByName } from "#/components/stays/resort-detail.tsx";
import { useTRPC } from "#/integrations/trpc/react.ts";
import { authClient } from "#/lib/auth-client.ts";
import { formatParkName, samePark } from "#/lib/parks.ts";
import { decodeEntities } from "#/lib/text.ts";
import { cn } from "#/lib/utils.ts";

/** Items/venues first seen within this many days read as "new". */
const NEW_WINDOW_DAYS = 30;

function isWithinDays(iso: string | null | undefined, days: number): boolean {
  if (!iso) return false;
  const t = Date.parse(iso);
  return Number.isFinite(t) && Date.now() - t <= days * 86_400_000;
}

/**
 * Disney's price facet arrives spelled out — "$$ ($15 to $34.99 per adult)".
 * A ticket fact cell is a third of a phone-wide stub, about eleven characters,
 * so the long form wraps to four lines and drags the whole bottom half of the
 * ticket down with it. Fold it to the figures that actually differentiate two
 * restaurants ("$15–$35"), and keep the original in the cell's tooltip.
 */
function shortPriceRange(range: string): string | null {
  const glyphs = range.match(/^\$+/)?.[0] ?? null;
  const figures = [...range.matchAll(/\$\s?(\d+(?:\.\d+)?)/g)]
    .map((m) => Number(m[1]))
    .filter((n) => Number.isFinite(n));
  if (figures.length >= 2) {
    const lo = Math.round(figures[0]!);
    const hi = Math.round(figures[figures.length - 1]!);
    return lo === hi ? `$${lo}` : `$${lo}–$${hi}`;
  }
  // "$$$$ ($60 and over per adult)" — one figure, open-ended.
  if (figures.length === 1) return `$${Math.round(figures[0]!)}+`;
  return glyphs ?? (range.trim() || null);
}

// UOR places-feed accessibility slugs → chip labels (unknown slugs drop).
const ACCESSIBILITY_LABELS: Record<string, string> = {
  "accessible-in-wheelchair": "Wheelchair accessible",
  "accessible-in-ecv": "ECV accessible",
  "stationary-seating": "Stationary seating",
};

/**
 * Panel titles in one place per page, so swapping the casual voice for the app's
 * plainer labels is a single edit (plan §7 — the mock copy is the default).
 */
const COPY = {
  job: "Grab a table",
  jobWalkUp: "Walk up & hours",
  menu: "What's cookin'",
  planAhead: "Plan ahead",
} as const;

const PARTY_SIZES = [1, 2, 3, 4, 5, 6, 7, 8];
/** Days in the availability strip under the picker. */
const STRIP_DAYS = 7;
const AVAIL_HORIZON = 60;
/** Days of the availability horizon the calendar shows — five whole weeks. */
const HEAT_DAYS = 35;
/**
 * Days averaged into the weekday bars — two whole weeks, so each weekday rests
 * on the same two dates. Whole weeks or the ranking is a slicing artifact; see
 * `WeekdayBars`, which withholds its caption when the window isn't one.
 */
const WEEKDAY_DAYS = 14;
const ISO = "yyyy-MM-dd";
/** Times per meal period before the "+N more" fold, and per nearest-day row. */
const TIMES_PER_PERIOD = 8;
const TIMES_PER_NEAREST_DAY = 3;
/** Ticket chips shown before the "+N" fold (plan deviation D5). */
const MAX_TICKET_CHIPS = 4;
/** Dishes on the mint panel's menu board (the cover counts as one of them). */
const TEASER_DISHES = 4;
/**
 * How far down the ranking `findDishCover` looks for a dish we hold a photo of.
 * Deep enough that a venue whose gallery pictures its third-best dish still
 * gets a cover, shallow enough that the cover is never something obscure.
 */
const COVER_SEARCH_DEPTH = 12;

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

/** Resolves an offer's link for the current platform, or null when unbookable. */
type OfferHref = (deepLink: string | null) => string | null;

// ── Hero ──────────────────────────────────────────────────────────────────────

/**
 * The venue page's identity hero: the shared `DetailHero` shell plus dining's
 * one overlay — the live walk-up wait, the only number here that is a reading
 * of this minute. Rendered identically by the loaded page and the seeded
 * loading state (see `DetailHero` for why both configurations must match).
 *
 * `titleless`: the ticket overlapping the hero's bottom edge carries the name,
 * so the hero shows only the photo.
 *
 * `underNav` + `crease="always"`, as the park page's hero does since its
 * redesign: the photo runs up behind the desktop nav capsule and squares off
 * its top corners, and the ticket's own crease is the single tear line at every
 * width (the desktop scallop drew a second one across the middle of the photo).
 *
 * Today's open state used to ride here as a chip. It is on the ticket now, next
 * to the venue's name — the stub says what this place *is*, and whether its
 * doors are open is the same kind of fact as what it costs.
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
}) {
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
      tear
      crease="always"
      titleless
      underNav
      overlays={({ chipFx }) =>
        /* The headline number: the live walk-up list, when one is posted —
           dining's analogue of the ride hero's standby block. Not a flight
           landing target (POI cards fly no wait chip), so it just joins the
           entrance cascade. */
        walkupWaitMin != null ? (
          <div
            style={chipFx(0).style}
            title={walkupDetail || undefined}
            className={cn(
              "absolute flex items-center gap-2 rounded-2xl bg-black/75 px-3.5 py-2 text-white shadow-lg backdrop-blur-sm",
              HERO_OVERLAY_HEADLINE,
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
        ) : null
      }
    />
  );
}

// ── Reservations ──────────────────────────────────────────────────────────────

/**
 * Everything the reservation blocks share: the 60-day availability horizon for
 * the chosen party, the picked day, that day's real times, and the nearest days
 * that do have tables. Lifted out of the panel because the desktop "Plan ahead"
 * charts read the same horizon — one query, one party size, no second fetch.
 */
function useReservations({
  facilityId,
  enabled,
  minPartySize,
  maxPartySize,
  maxAdvanceDays,
  native,
  webUrl,
}: {
  facilityId: string;
  enabled: boolean;
  minPartySize: number | null;
  maxPartySize: number | null;
  maxAdvanceDays: number | null;
  native: boolean;
  webUrl: string | null;
}) {
  const trpc = useTRPC();

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

  const availabilityQ = useQuery({
    ...trpc.dining.availability.queryOptions({ facilityId, partySize, days: AVAIL_HORIZON }),
    enabled,
  });
  const days = availabilityQ.data?.find((e) => e.facilityId === facilityId)?.days ?? [];
  const selected = days.find((d) => d.date === selectedIso);

  // The strip stays anchored on today and only slides once the chosen day would
  // fall off its right edge — picking Wednesday must not hide Sunday through
  // Tuesday, which is what slicing from the selected date used to do.
  const stripDays = React.useMemo(() => {
    const idx = days.findIndex((d) => d.date === selectedIso);
    const start =
      idx < 0 ? 0 : Math.max(0, Math.min(idx - (STRIP_DAYS - 1), days.length - STRIP_DAYS));
    return days.slice(start, start + STRIP_DAYS);
  }, [days, selectedIso]);

  // The nearest days that *do* have tables, so a full date offers an exit
  // instead of a dead end.
  const nextOpen = React.useMemo(
    () => days.filter((d) => d.date > selectedIso && d.available).slice(0, 2),
    [days, selectedIso],
  );

  // Times are only fetched for what we actually render: the chosen day when it
  // has tables, otherwise the two nearest days that do. Changing the date
  // refetches this narrow query — the 60-day `availability` slice above doesn't.
  const offerDates = React.useMemo(
    () => (selected?.available ? [selectedIso] : nextOpen.map((d) => d.date)),
    [selected?.available, selectedIso, nextOpen],
  );
  const offersQ = useQuery({
    ...trpc.dining.offers.queryOptions({ facilityId, partySize, dates: offerDates }),
    enabled: enabled && offerDates.length > 0,
  });
  const offersByDate = React.useMemo(
    () => new Map((offersQ.data ?? []).map((e) => [e.date, e.offers])),
    [offersQ.data],
  );

  // Native opens MDE at the exact offer; a browser can't resolve `mdx://` (and
  // Universal offers carry no such link at all), so those fall back to the
  // venue's own reservation page — the same target as the page's Book key.
  const offerHref: OfferHref = (deepLink) => (native && deepLink ? deepLink : webUrl);

  const selectedOffers = offersByDate.get(selectedIso) ?? [];
  const soonest = selected?.available ? (selectedOffers[0] ?? null) : null;

  return {
    partySize,
    setPartySize,
    partyOptions,
    today,
    todayIso,
    maxDate,
    date,
    setDate,
    selectedIso,
    dateLabel: date ? format(date, "EEE, MMM d") : "your date",
    days,
    selected,
    stripDays,
    nextOpen,
    offersByDate,
    selectedOffers,
    soonest,
    offerHref,
    availabilityQ,
    offersQ,
  };
}

type Reservations = ReturnType<typeof useReservations>;

/**
 * The selected day's real times, grouped by meal period — the thing a guest can
 * actually act on, in place of a bare count. Long lists fold behind "+N more";
 * mount it with a `key` on the date so the fold resets when the day changes.
 */
function OfferTimes({
  offers,
  loading,
  href,
}: {
  offers: Array<Offer>;
  loading: boolean;
  href: OfferHref;
}) {
  const [expanded, setExpanded] = React.useState(false);
  // Chip-shaped placeholders, so the block lands at roughly the height it will
  // occupy rather than growing under whatever sits below it.
  if (offers.length === 0)
    return loading ? (
      <div className="flex flex-wrap gap-1.5" aria-hidden>
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="h-[38px] w-[88px] rounded-xl" />
        ))}
      </div>
    ) : null;

  const groups = byMealPeriod(offers);
  return (
    <div className="flex flex-col gap-2.5 md:grid md:grid-cols-[4rem_1fr] md:items-start md:gap-x-3">
      {groups.map(([period, list]) => {
        // Each period folds its own overflow — "+12" next to Dinner answers "how
        // much more dinner is there", which a page-wide total doesn't.
        const folded = Math.max(0, list.length - TIMES_PER_PERIOD);
        return (
          <React.Fragment key={period}>
            <span className="text-[11px] font-bold uppercase tracking-[0.06em] text-wash-muted md:pt-2.5">
              {period}
            </span>
            <div className="flex flex-wrap gap-1.5">
              {(expanded ? list : list.slice(0, TIMES_PER_PERIOD)).map((offer) => (
                <TimeKey
                  key={`${offer.mealPeriod}-${offer.time}`}
                  label={offerTimeLabel(offer.time)}
                  href={href(offer.deepLink)}
                />
              ))}
              {folded > 0 && !expanded && (
                <MoreKey onClick={() => setExpanded(true)}>+{folded}</MoreKey>
              )}
            </div>
          </React.Fragment>
        );
      })}
    </div>
  );
}

/**
 * A day that does have tables, offered when the chosen one doesn't. The date
 * and the overflow both move the picker to that day, so the full-date case ends
 * in a next step rather than a sentence.
 */
function NearestDayRow({
  day,
  offers,
  todayIso,
  href,
  onPick,
}: {
  day: DayEntry;
  offers: Array<Offer>;
  todayIso: string;
  href: OfferHref;
  onPick: () => void;
}) {
  const shown = offers.slice(0, TIMES_PER_NEAREST_DAY);
  const extra = day.offerCount - shown.length;
  return (
    <div className="flex flex-col gap-2 rounded-2xl bg-background/70 px-3 py-2.5">
      {/* Date and how far out it is on their own line: three time keys plus a
          date plus "in 2 days" don't fit a phone's width, and letting them wrap
          as one row left the date stranded above a half-empty line of keys. */}
      <div className="flex items-baseline justify-between gap-2">
        <button
          type="button"
          onClick={onPick}
          className="truncate text-sm font-semibold underline-offset-2 hover:underline"
        >
          {format(new Date(`${day.date}T00:00:00`), "EEE, MMM d")}
        </button>
        <span className="shrink-0 text-xs text-wash-muted">{daysOutLabel(todayIso, day.date)}</span>
      </div>
      {(shown.length > 0 || extra > 0) && (
        <div className="flex flex-wrap items-center gap-1.5">
          {shown.map((offer) => (
            <TimeKey
              key={`${offer.mealPeriod}-${offer.time}`}
              label={offerTimeLabel(offer.time)}
              href={href(offer.deepLink)}
            />
          ))}
          {extra > 0 && (
            <MoreKey onClick={onPick}>
              {shown.length > 0
                ? `+${extra} more`
                : `${day.offerCount} table${day.offerCount === 1 ? "" : "s"}`}
            </MoreKey>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * The page's job block for a venue we sweep: pick a day and a party, see the
 * real times, book the soonest. The yellow Book key is desktop-only — on a
 * phone it's the floating action bar's primary key instead, so the page carries
 * exactly one of them.
 */
function GrabATablePanel({
  r,
  facilityId,
  restaurantName,
  webUrl,
  minPartySize,
  maxPartySize,
  maxAdvanceDays,
  bookHref,
  className,
}: {
  r: Reservations;
  facilityId: string;
  restaurantName: string;
  webUrl: string | null;
  minPartySize: number | null;
  maxPartySize: number | null;
  maxAdvanceDays: number | null;
  bookHref: string | null;
  className?: string;
}) {
  const { data: session } = authClient.useSession();
  const bounds = [
    minPartySize != null && maxPartySize != null ? `parties ${minPartySize}–${maxPartySize}` : null,
    maxAdvanceDays != null ? `up to ${maxAdvanceDays} days out` : null,
  ].filter(Boolean);

  const meta = r.availabilityQ.isLoading
    ? "Checking…"
    : r.selected?.available
      ? `${r.selected.offerCount} open ${r.selectedIso === r.todayIso ? "today" : format(new Date(`${r.selectedIso}T00:00:00`), "EEE")}`
      : r.selected
        ? `${r.dateLabel} is full`
        : null;

  return (
    <WashPanel title={COPY.job} meta={meta} className={className}>
      <div className="flex gap-2">
        <DatePicker
          value={r.date}
          onChange={r.setDate}
          fromDate={r.today}
          toDate={r.maxDate}
          placeholder="Pick a date"
          dateFormat="EEE, MMM d"
          className="h-11 min-w-0 flex-1 text-[15px] font-semibold"
        />
        <Select value={String(r.partySize)} onValueChange={(v) => v && r.setPartySize(Number(v))}>
          <SelectTrigger
            className="w-auto shrink-0 rounded-4xl text-[15px] font-semibold data-[size=default]:h-11"
            aria-label="Party size"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {r.partyOptions.map((n) => (
              <SelectItem key={n} value={String(n)}>
                {n} {n === 1 ? "guest" : "guests"}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <DiningAlertButton
          facilityId={facilityId}
          restaurantName={restaurantName}
          defaultPartySize={r.partySize}
          loggedIn={!!session?.user}
          variant="outline"
          className="size-11 rounded-full"
        />
      </div>

      {r.availabilityQ.isLoading ? (
        <Skeleton className="h-[4.25rem] w-full rounded-2xl" />
      ) : r.days.length === 0 ? (
        <p className="text-sm text-wash-muted">
          No reservation availability recorded yet — try a different party size, or set an alert
          above.
        </p>
      ) : (
        <>
          {/* The punch-card week. Pinned above everything that loads or expands,
              so it never moves under the cursor. */}
          {r.stripDays.length > 0 && (
            <div className="grid grid-cols-7 gap-1 sm:gap-2">
              {r.stripDays.map((d) => {
                const dt = new Date(`${d.date}T00:00:00`);
                return (
                  <PunchDay
                    key={d.date}
                    weekday={dt.toLocaleDateString("en-US", { weekday: "short" })}
                    day={dt.getDate()}
                    count={d.available ? d.offerCount : "—"}
                    selected={d.date === r.selectedIso}
                    label={`${dt.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" })} — ${
                      d.available
                        ? `${d.offerCount} table${d.offerCount === 1 ? "" : "s"}`
                        : "no tables"
                    }`}
                    onSelect={() => r.setDate(new Date(`${d.date}T00:00:00`))}
                  />
                );
              })}
            </div>
          )}

          {/* Open day: the day's real times, grouped by meal period. */}
          {r.selected?.available && (
            <OfferTimes
              key={r.selectedIso}
              offers={r.selectedOffers}
              loading={r.offersQ.isLoading}
              href={r.offerHref}
            />
          )}

          {/* Full day: the nearest days that aren't, with their first times. */}
          {!r.selected?.available && r.nextOpen.length > 0 && (
            <div className="flex flex-col gap-2">
              <span className="text-[11px] font-bold uppercase tracking-[0.06em] text-wash-muted">
                Nearest tables
              </span>
              {r.nextOpen.map((d) => (
                <NearestDayRow
                  key={d.date}
                  day={d}
                  offers={r.offersByDate.get(d.date) ?? []}
                  todayIso={r.todayIso}
                  href={r.offerHref}
                  onPick={() => r.setDate(new Date(`${d.date}T00:00:00`))}
                />
              ))}
            </div>
          )}
          {!r.selected?.available && r.nextOpen.length === 0 && (
            <p className="text-sm text-wash-muted">
              {r.selected
                ? `Nothing open for a party of ${r.partySize} — try another party size or date.`
                : `We haven't checked ${r.dateLabel} yet.`}
            </p>
          )}
        </>
      )}

      {/* Desktop's primary call to action. The phone's lives in the action bar
          (one yellow key per page), but the booking terms belong to the panel on
          both — that's where the day and party they apply to are chosen. */}
      <div className="flex flex-col gap-2 pt-0.5 md:flex-row md:items-center md:gap-3.5">
        {bookHref && (
          <Button
            variant="yellow"
            size="lg"
            className="hidden shrink-0 md:inline-flex"
            render={<a href={bookHref} target="_blank" rel="noreferrer" />}
          >
            {r.soonest ? `Book ${offerTimeLabel(r.soonest.time)}` : "Check the official site"}
            <ExternalLinkIcon />
          </Button>
        )}
        {(bounds.length > 0 || webUrl) && (
          <p className="text-[13px] text-wash-muted">
            {[webUrl ? "Books on the official site" : null, ...bounds].filter(Boolean).join(" · ")}
          </p>
        )}
      </div>
    </WashPanel>
  );
}

/**
 * The job block for a venue we don't sweep — quick service, most of Universal.
 * Hours are the answer there, plus a mobile-order hand-off where one exists.
 */
function WalkUpPanel({
  schedules,
  walkupWaitMin,
  walkupWaitList,
  mobileOrder,
  className,
}: {
  schedules: Array<ScheduleEntry>;
  walkupWaitMin: number | null;
  walkupWaitList: boolean;
  mobileOrder: boolean;
  className?: string;
}) {
  const nowMin = parkNowMinutes();
  const status = schedules.length > 0 ? openStatus(schedules, nowMin) : null;
  // Today's window is on the ticket above (`VenueHours`) and its state is in
  // the stub's own status chip, so the panel says what it alone can: how you
  // get served, and — when the clock is about to change the answer — the
  // countdown neither of those can carry.
  const countdown =
    status === "closes-soon" || status === "opens-soon"
      ? openStatusDetail(schedules, nowMin).replace(/ · .*$/, "")
      : null;
  return (
    <WashPanel
      title={COPY.jobWalkUp}
      meta={status ? OPEN_STATUS_LABELS[status] : null}
      className={className}
    >
      <div className="grid grid-cols-2 gap-2">
        <FactTile
          className="bg-background/70"
          label={walkupWaitMin != null ? "Walk-up wait" : "Walk-ups"}
          value={
            walkupWaitMin != null
              ? `${walkupWaitMin} min`
              : walkupWaitList
                ? "Join the list in person"
                : "First come, first served"
          }
        />
        <FactTile
          className="bg-background/70"
          label="Order ahead"
          value={mobileOrder ? "Mobile order in the app" : "At the counter"}
        />
      </div>
      {countdown && <p className="text-[13px] text-wash-muted">{countdown}</p>}
    </WashPanel>
  );
}

// ── Menu teaser ───────────────────────────────────────────────────────────────

/**
 * The panel's photograph. `item` is the dish it was proven to be of, or null
 * when all we can show is that the picture is of this venue's food.
 */
interface MenuCover {
  item: MenuItemData | null;
  url: string;
  alt: string | null;
}

/**
 * A dish we hold a photograph of, run full width at the top of the panel with
 * its name and price on the image. Only ever a photo `findDishCover` could tie
 * to this exact dish (see `menu-teaser.ts`) — a picture of the dining room over
 * the name of a burger is worse than no picture at all.
 */
function DishCover({ item, url, alt }: MenuCover) {
  const name = item ? decodeEntities(item.title) : null;
  const price = item ? formatPrice(item.price, item.currency) : null;
  const caption = alt ? decodeEntities(alt) : null;
  return (
    <div className="relative overflow-hidden rounded-[18px] bg-muted">
      <Image
        src={url}
        alt={caption ?? name ?? "A dish from this venue"}
        loading="lazy"
        sizes="(min-width: 768px) 460px, 100vw"
        aspect={2}
        className="h-44 w-full object-cover"
      />
      {/* Named only when the photo was tied to a dish. A buffet's photo runs
          bare rather than captioned with a plate we cannot identify. */}
      {name && (
        <div className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-3 bg-gradient-to-t from-black/75 to-transparent px-3.5 pt-10 pb-3">
          <p className="text-[15px] leading-tight font-bold text-balance text-white">{name}</p>
          {price && (
            <p className="shrink-0 text-[17px] font-extrabold tabular-nums text-white">{price}</p>
          )}
        </div>
      )}
    </div>
  );
}

/** One line of the menu board: what it is, what's in it, what it costs. */
function DishRow({ item }: { item: MenuItemData }) {
  const description = decodeEntities(item.description);
  const price = formatPrice(item.price, item.currency);
  return (
    <div className="flex items-start gap-3 py-3">
      <div className="flex min-w-0 flex-col gap-0.5">
        <p className="text-[15px] leading-snug font-bold tracking-[-0.01em] text-balance">
          {decodeEntities(item.title)}
        </p>
        {description && (
          <p className="line-clamp-2 text-[12.5px] leading-snug text-pretty text-muted-foreground">
            {description}
          </p>
        )}
      </div>
      {price && (
        <p className="ml-auto shrink-0 text-base font-extrabold tabular-nums text-mint-fg">
          {price}
        </p>
      )}
    </div>
  );
}

/**
 * The reference block: the dishes that stand for this venue's menu, and the
 * door to the rest of it. A menu reads as a menu — name over description, price
 * in the right column — because that carries the appetite a glyph never could,
 * and because two thirds of the items we hold ship a description worth reading.
 * Flat rows: they're read, not pressed (D1); the "See all" key is the only
 * thing here that acts.
 */
function MenuPanel({
  loading,
  hasMenu,
  cover,
  dishes,
  itemCount,
  meta,
  onOpen,
}: {
  loading: boolean;
  hasMenu: boolean;
  cover: MenuCover | null;
  dishes: Array<MenuItemData>;
  itemCount: number;
  /** Which menu is on show and how much of it there is — "Lunch · 42 dishes". */
  meta?: React.ReactNode;
  onOpen: () => void;
}) {
  return (
    /* The heading lives here now (2026-09-17, Josh). It used to sit above the
       panel as the column's band heading, which put a kicker and a 26px title
       over a block that then opened with its own field — two headings deep
       before the first dish. One heading, on the thing it names. */
    <TintPanel tone="mint" title={COPY.menu} meta={meta}>
      {loading ? (
        <div className="flex flex-col gap-2" aria-hidden>
          {Array.from({ length: TEASER_DISHES }, (_, i) => (
            <Skeleton key={i} className="h-14 rounded-[18px]" />
          ))}
        </div>
      ) : !hasMenu ? (
        <div className="flex flex-col gap-1 py-2">
          <p className="font-semibold">Menu not yet captured</p>
          <p className="text-sm text-muted-foreground">
            We haven&apos;t recorded a menu for this venue yet — check back soon.
          </p>
        </div>
      ) : (
        <>
          {cover && <DishCover {...cover} />}
          {dishes.length > 0 && (
            /* Two columns from `lg`, where this panel is sitting in the page's
               wide column: a single file of four rows under a full-width
               photograph left a hand's width of mint doing nothing on either
               side of every price. The rule between rows is drawn per column,
               so it never runs across the gap. */
            <div className="rounded-[18px] bg-card px-3.5 py-0.5 lg:grid lg:grid-cols-2 lg:gap-x-6 lg:px-5">
              {dishes.map((item, i) => (
                <div key={item.title} className="flex flex-col">
                  {i > 0 && <div className="h-px bg-card-edge lg:hidden" />}
                  {i > 1 && <div className="hidden h-px bg-card-edge lg:block" />}
                  <DishRow item={item} />
                </div>
              ))}
            </div>
          )}
          <Button variant="outline" size="lg" className="w-full font-bold" onClick={onOpen}>
            See all {itemCount.toLocaleString()} {itemCount === 1 ? "dish" : "dishes"}
            <ChevronRightIcon />
          </Button>
        </>
      )}
    </TintPanel>
  );
}

// ── Plan ahead ────────────────────────────────────────────────────────────────

/**
 * How long ago the sweep last looked at this venue, in words.
 *
 * Deliberately a reading rather than a promise: this band used to say "swept
 * hourly", which the cron aims at but does not guarantee — the run is
 * budget-bounded and orders venues least-recently-swept first, so a long run
 * leaves a tail whose figures are hours old under copy claiming minutes.
 * `observed_at` is on every row the API already returns; nothing read it.
 *
 * Null until hydration, for the reason `useParkClock` is: a relative time
 * rendered on the server is wrong by however long the HTML sat in the edge
 * cache, and mismatches on the way in.
 */
function useSweptLabel(observedAt: string | null | undefined): string | null {
  const hydrated = useHydrated();
  if (!hydrated || !observedAt) return null;
  const ms = Date.now() - Date.parse(observedAt);
  if (!Number.isFinite(ms) || ms < 0) return null;
  const mins = Math.round(ms / 60_000);
  if (mins < 2) return "just now";
  if (mins < 90) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 36) return `${hours} hr ago`;
  return `${Math.round(hours / 24)} days ago`;
}

/**
 * What the sweep knows that no single day's search can show: which dates still
 * have room, which weekday reliably does, and — the one the other two can't
 * answer — which stretch of the clock.
 *
 * ## Why the series starts tomorrow
 *
 * A row in `dining_obs` is the times still bookable *at sweep time*. For a
 * future date that is the date's availability; for today it is whatever is left
 * of today, a number that shrinks to zero by dinnertime. They are different
 * quantities and cannot share a scale. Measured across the Disney priority set
 * for a party of two, today averages 3.4 open times against tomorrow's 16.7,
 * and 52 of 111 venues read zero — so mixing it in did two things:
 *
 *   - it decided the weekday caption. Each weekday rests on two dates, one of
 *     which is today for today's weekday, and 71 of 126 venues named *today's
 *     weekday* as their worst. The sentence rotated with the day of the week
 *     you happened to open the page on (37% of venues changed their answer once
 *     today was dropped), which is a property of the clock, not the restaurant.
 *   - it anchored the heat ramp. Today was the sole minimum on 41 of 105
 *     charted venues, stretching the average colour span by half and squashing
 *     a real month of variation into the top two steps.
 *
 * Today is still drawn, still ringed, and deliberately blank — `todayLabel`
 * says why. The panel above it is where today's actual times live.
 *
 * ## Why "times" and not "tables"
 *
 * `offerCount` counts bookable arrival *times*: Frontera Cocina's 48 is every
 * 15-minute slot from 11:00 to 22:45, not 48 tables. The ceiling is the venue's
 * slot grid rather than its dining room, so the figure says nothing about size
 * and saturates once everything is open.
 *
 * It renders only when the sweep has something to say. A venue we hold a
 * fortnight of *empty* days for gets no band at all: a calendar of "nothing
 * open" looks like a broken chart and answers nothing the panel above hasn't
 * already answered.
 */
function PlanAhead({ r, facilityId }: { r: Reservations; facilityId: string }) {
  const trpc = useTRPC();
  // Only the stretch we have actually swept. Beyond it every day would read
  // "no tables", which is a claim we can't make — the sweep simply stops.
  const swept = r.days.slice(0, HEAT_DAYS);
  const points = React.useMemo(
    () =>
      swept.filter((d) => d.date > r.todayIso).map((d) => ({ date: d.date, value: d.offerCount })),
    [swept, r.todayIso],
  );
  // Today, present so the calendar opens on the week the guest is in, and
  // valueless so it neither anchors the ramp nor votes on a weekday.
  const gridDays = React.useMemo(
    () => [{ date: r.todayIso, value: null }, ...points],
    [points, r.todayIso],
  );
  // Whole weeks only — an uneven window ranks weekdays by where it was cut.
  // Never empty at render: the guard below drops the band under seven days.
  const weekdayDays = React.useMemo(
    () => points.slice(0, Math.min(WEEKDAY_DAYS, Math.floor(points.length / 7) * 7)),
    [points],
  );
  const openDays = points.filter((p) => p.value > 0).length;
  // The newest generation across the horizon, not `days[0]`'s: today's row
  // stops being rewritten every evening from 8 PM Eastern (the sweep's own
  // window is UTC), so the first day is the stalest one on the page.
  const lastSwept = React.useMemo(
    () =>
      swept.reduce<string | null>(
        (a, d) => (a == null || d.observedAt > a ? d.observedAt : a),
        null,
      ),
    [swept],
  );
  const sweptLabel = useSweptLabel(lastSwept);

  const bandsQ = useQuery({
    ...trpc.dining.timeBands.queryOptions({
      facilityId,
      partySize: r.partySize,
      days: HEAT_DAYS,
    }),
    enabled: points.length >= 7,
  });
  const bandDays = React.useMemo(
    () => (bandsQ.data ?? []).filter((d) => d.date > r.todayIso),
    [bandsQ.data, r.todayIso],
  );

  // Under a week of forward sweep, or a horizon with nothing open in it: the
  // charts would be a grid of grey and seven empty bars.
  if (points.length < 7 || openDays === 0) return null;

  const times = (value: number) => `${value.toLocaleString()} ${value === 1 ? "time" : "times"}`;
  // The span the window really covers, which is not the same as the number of
  // days we hold rows for the moment the sweep drops one.
  const spanDays =
    Math.round(
      (Date.parse(`${points[points.length - 1]!.date}T00:00:00`) -
        Date.parse(`${points[0]!.date}T00:00:00`)) /
        86_400_000,
    ) + 1;

  return (
    /* The page's one band, and the last thing on it: everything above is this
       venue today, and this is what our sweep knows about it in general — the
       park page's "Know" band, over tables instead of waits. */
    <Band className="mt-10 md:mt-12">
      <BandHeading
        kicker="Know"
        title={COPY.planAhead}
        meta={`${sweptLabel ? `Checked ${sweptLabel} ` : ""}for a party of ${r.partySize} · ${openDays} of the next ${spanDays} days have openings`}
      />
      {/* Three charts that each want a different width: a calendar wants to be
          square and small, seven bars want to be squat, and a 30-column strip
          wants to be long. Stacked on a phone, calendar-and-bars beside each
          other from `md` with the strip under them, and all three abreast from
          `xl` — where a two-column split left the bars floating in the top
          third of a card sized by the calendar next to it. The first column is
          fixed rather than fractional so the calendar's cells stay cells
          instead of growing into 90px tiles on a wide monitor. */}
      <div className="grid gap-4 md:grid-cols-[19rem_minmax(0,1fr)] md:gap-6 xl:grid-cols-[19rem_minmax(0,1fr)_minmax(0,1.45fr)]">
        <DetailCard
          title="Openings by date"
          description="Bookable times per service date · from tomorrow, today ringed"
        >
          <DayHeatGrid
            days={gridDays}
            today={r.todayIso}
            align="start"
            weeks={6}
            unit={times}
            zeroLabel="Fully booked"
            todayLabel="today — see the times above"
          />
        </DetailCard>
        <DetailCard
          title="Openings by weekday"
          description={`Average bookable times per weekday · next ${weekdayDays.length} days · best in green`}
        >
          <WeekdayBars
            days={weekdayDays}
            good="max"
            unit={times}
            caption={({ best, worst }) => `${best}s open the most times; ${worst}s the fewest.`}
          />
        </DetailCard>
        {bandDays.length >= 7 && (
          <DetailCard
            title="Openings by time of day"
            description="One column per date, down the clock · darkest is most open"
            className="md:col-span-2 xl:col-span-1"
          >
            <TimeBandStrip days={bandDays} />
          </DetailCard>
        )}
      </div>
    </Band>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

/**
 * Standalone restaurant detail page body, built on the ticket-stub system
 * (docs/plans/dining-redesign): a torn photo hero, the ticket carrying the name
 * and three facts, the wash panel carrying the page's job (booking a table),
 * then the menu teaser, the venue's own copy, and the map.
 *
 * `targetItemSlug` comes from a `#menu-<slug>` deep link — it auto-selects the
 * right meal period, scrolls to the item, and highlights it briefly. The menu
 * itself is a bottom drawer on a phone and a right-hand sheet on desktop; both
 * render the same `MenuBody` the board's drawer uses.
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
  const native = useIsNative();
  const venueQ = useQuery(trpc.dining.venue.queryOptions({ facilityId }));
  const venue = venueQ.data;
  // This venue's own posted window, today first. Not `dining.hours`, which
  // answers the *list* page's question ("what is open right now") by shipping
  // four hundred venues' schedules — see `dining.venueSchedule`.
  const hours = useVenueHours(facilityId);
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

  const schedules = hours.today;
  const webUrl = venue ? diningReserveUrl(venue.urlFriendlyId, venue.detailUrl) : null;

  // The park this venue stands in, matched on the finder's own location name
  // (`samePark`) — there is no park id on a restaurant row. It buys the wide
  // column its news card; a resort-hosted venue simply doesn't have one.
  const parksQ = useQuery(trpc.parks.list.queryOptions());
  const park = React.useMemo(
    () =>
      venue?.parkResort
        ? (parksQ.data?.find((p) => samePark(venue.parkResort, p.name)) ?? null)
        : null,
    [parksQ.data, venue?.parkResort],
  );

  const r = useReservations({
    facilityId,
    enabled: !!venue?.availabilityEligible,
    minPartySize: venue?.minPartySize ?? null,
    maxPartySize: venue?.maxPartySize ?? null,
    maxAdvanceDays: venue?.maxAdvanceDays ?? null,
    native,
    webUrl,
  });

  // A `#menu` / `#menu-<slug>` deep link has to *open* the menu — it's a drawer
  // on a phone and a sheet on desktop, so there's no inline panel to scroll to.
  const [menuOpen, setMenuOpen] = React.useState(false);
  const menuReady = !!venue && !state.menuQ.isLoading;
  React.useEffect(() => {
    if (!menuReady) return;
    if (!scrollToMenu && !targetItemSlug) return;
    setMenuOpen(true);
  }, [scrollToMenu, targetItemSlug, menuReady]);

  // A resort-hosted venue (no park ticket required) cross-links back to its
  // resort's detail page; theme-park venues just show the plain text.
  const resortSlug =
    venue && !venue.requiresParkTicket && venue.parkResort
      ? resortSlugByName(venue.parkResort)
      : null;
  // The ticket's one line of place, mirroring the ride ticket's "Park · Land"
  // (and the flight seed's construction of the same, so a map-launched hero
  // doesn't reword when the venue query lands).
  const placeLine = venue
    ? [venue.parkResort, venue.land && venue.land !== venue.parkResort ? venue.land : null]
        .filter(Boolean)
        .map((part) => decodeEntities(part))
        .join(" · ")
    : null;
  // The peach panel's title takes a place name only when it fits on one line
  // beside the Walk-there key — the land first, since that's the useful one
  // when you're already in the park.
  const mapPlace =
    [venue?.land, venue?.parkResort]
      .map((place) => decodeEntities(place))
      .find((place): place is string => !!place && place.length <= 20) ?? null;

  // Venue hero media (plan item 1.9 follow-up): slide 0 is the best ambient
  // asset (the normalizer orders cinemagraph → video → stills). Without a
  // video, the gallery stills crossfade over the base image.
  const venueHeroVideo = venue?.heroMedia.find((s) => s.kind === "video") ?? null;
  /**
   * Every gallery still the page can draw on, minus the one the hero is already
   * built from (de-duped sans query — CDN timestamps churn). The hero carousel
   * and the menu panel's cover both come out of here, in that order: the cover
   * picks first, and the carousel gets what's left.
   */
  const venueGallery = React.useMemo(() => {
    if (!venue) return [];
    const seen = new Set(venue.imageUrl ? [venue.imageUrl.split("?")[0]] : []);
    const stills: Array<{ url: string; alt: string | null }> = [];
    for (const s of venue.heroMedia) {
      if (s.kind !== "image") continue;
      const key = s.url.split("?")[0];
      if (seen.has(key)) continue;
      seen.add(key);
      stills.push({ url: s.url, alt: s.alt });
    }
    return stills;
  }, [venue]);

  const hasMenu = state.periods.length > 0;
  const activePeriod = state.periods[state.activePeriodIdx]?.mealPeriod ?? null;

  // Dish count for the menu key. Deduped per meal period, since a venue often
  // lists the same dish under several groups (a cider under both "Draft Beer"
  // and "Bottle & Can") and counting it twice overstates the menu.
  const menuItemCount = React.useMemo(() => {
    const seen = new Set<string>();
    for (const p of state.periods) {
      for (const g of p.groups) {
        for (const item of g.items) seen.add(`${p.mealPeriod}|${item.title}`);
      }
    }
    return seen.size;
  }, [state.periods]);

  // The teaser: the venue's most *distinctive* menu if it has one (a milkshake
  // or dessert list says more about Toothsome than its entrées do), else the
  // first period — then the dishes off it that stand for the place, ranked by
  // `menu-teaser.ts` rather than taken in menu order, which on a Disney card
  // means opening with the fruit bowl and the yogurt parfait.
  const teaser = React.useMemo(() => {
    const distinctive = state.periods.find((p) =>
      /shake|dessert|sweet|treat|bakery|snack/i.test(p.mealPeriod),
    );
    const period = distinctive ?? state.periods[0];
    if (!period) return null;
    const candidates: Array<TeaserCandidate> = [];
    for (const g of period.groups) {
      for (const item of g.items) {
        candidates.push({
          item,
          groupName: g.groupName,
          itemType: g.itemType,
          index: candidates.length,
        });
      }
    }
    return { period: period.mealPeriod, ranked: rankTeaserDishes(candidates, venue?.name ?? null) };
  }, [state.periods, venue?.name]);

  // The panel's photo, when this venue's own gallery turns out to hold one of
  // the dish it's showing (plan §12 q3). The gallery is the hero's, minus the
  // still the hero itself is built from — a cover the page already opened with
  // reads as a printing error, not as a photograph of dinner.
  const menuCover = React.useMemo((): MenuCover | null => {
    if (!teaser || !venue) return null;
    const found = findDishCover(teaser.ranked, venueGallery, venue.name, COVER_SEARCH_DEPTH);
    if (found) return { item: found.candidate.item, url: found.slide.url, alt: found.slide.alt };
    // Nothing provable: a buffet's menu is section headings, and plenty of
    // galleries picture food the card never names. Show the food anyway, with
    // no dish name on it.
    const food = findFoodPhoto(venueGallery, venue.name);
    return food ? { item: null, url: food.url, alt: food.alt } : null;
  }, [teaser, venue, venueGallery]);

  // What the carousel is left with. A photo the page has already spent below
  // the fold is dropped from it: the same plate swimming past in the hero and
  // sitting on the menu panel reads as a printing error, not as a gallery.
  const venueHeroSlides = React.useMemo(() => {
    if (venueHeroVideo) return [];
    const spent = menuCover?.url.split("?")[0];
    return spent ? venueGallery.filter((s) => s.url.split("?")[0] !== spent) : venueGallery;
  }, [venueHeroVideo, venueGallery, menuCover]);

  // With a cover the leading dish is *on* the photo, so the rows below it pick
  // up where it left off; without one, all four rows are the menu board.
  const teaserDishes = React.useMemo(() => {
    if (!teaser) return [];
    const ranked = teaser.ranked.map((c) => c.item);
    // An unnamed cover takes no dish off the board — it isn't standing in for
    // any one of them, so all four rows still have something to say.
    const covered = menuCover?.item;
    if (!covered) return ranked.slice(0, TEASER_DISHES);
    return ranked.filter((item) => item !== covered).slice(0, TEASER_DISHES - 1);
  }, [teaser, menuCover]);

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

  // The ticket's accent chip distinguishes a brand-new venue from an established
  // one whose menu just changed. A new venue's items are all new too, so "Newly
  // added" subsumes any item activity; only when the venue itself isn't new do we
  // surface recent menu changes as "Freshly updated". Prefer a freshly-added item
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
    setMenuOpen(true);
  }

  // ── Ticket contents ────────────────────────────────────────────────────────
  // Exactly three facts, always filled: the venue's own numbers first, then its
  // most useful stable metadata. Nothing invented, no empty cell (plan §4.9).
  const cuisines = venue ? cuisineList(venue.cuisine) : [];
  const facts: Array<TicketFact> = [];
  if (venue) {
    // Every value has to survive a third of a phone-wide stub, so each one is
    // either short by nature or folded here with the long form in `hint`.
    const priceFact: TicketFact | null = venue.priceRange
      ? {
          label: "Price",
          value: shortPriceRange(venue.priceRange) ?? venue.priceRange,
          hint: venue.priceRange,
        }
      : null;
    const service = venue.experienceType ?? cuisines[0] ?? null;
    if (service) facts.push({ label: "Service", value: service });
    // No "Hours" cell: the stub's lower half lists the whole posted window now
    // (`VenueHours`), and its status chip says whether the doors are open. The
    // freed cell goes to the price band, which nothing else on the page states.
    if (venue.minPartySize != null && venue.maxPartySize != null) {
      facts.push({ label: "Party", value: `${venue.minPartySize}–${venue.maxPartySize}` });
    } else if (priceFact) {
      facts.push(priceFact);
    } else if (venue.maximumPartySize != null) {
      facts.push({ label: "Max party", value: venue.maximumPartySize });
    }
    // Fillers, in order of usefulness, for venues missing one of the above.
    const fillers: Array<TicketFact | null> = [
      priceFact,
      cuisines.length > 0 ? { label: "Cuisine", value: cuisines[0]! } : null,
      venue.land ? { label: "Area", value: venue.land } : null,
      // The park is a short name; a resort's is not ("Disney's Grand Floridian
      // Resort & Spa" in an 11-character cell), and the ticket's subtitle
      // already carries it — so it fills a cell only when it fits one.
      venue.parkResort && venue.parkResort.length <= 20
        ? { label: "Where", value: venue.parkResort }
        : null,
    ];
    for (const f of fillers) {
      if (facts.length >= 3) break;
      if (f && !facts.some((existing) => existing.label === f.label)) facts.push(f);
    }
  }

  // Chip pool: what the venue *is*, then its taxonomy, then accessibility —
  // capped at four plus a "+N" that names the rest in its tooltip (D5).
  const chipPool = venue
    ? [
        venue.characterDining && "Characters",
        venue.dinnerShow && "Dinner show",
        venue.fineDining && "Signature",
        venue.diningPackage && "Package",
        venue.walkupWaitList && "Walk-up list",
        venue.mobileOrder && "Mobile order",
        [venue.diningPlanQs && "QS", venue.diningPlanTs && "TS"].filter(Boolean).length > 0
          ? `Dining Plan: ${[venue.diningPlanQs && "QS", venue.diningPlanTs && "TS"].filter(Boolean).join(" + ")}`
          : null,
        venue.annualPassDiscount &&
          (venue.apDiscountPct != null
            ? `Annual Pass ${venue.apDiscountPct}% off`
            : "Annual Pass discount"),
        venue.disneyVisaDiscount && "Disney Visa discount",
        venue.tripAdvisorAward && "TripAdvisor award",
        venue.requiresParkTicket && "Needs park entry",
        ...[...new Set([...venue.diningInterests, ...venue.disneyFavorites])].map((slug) =>
          taxonomyLabel(slug),
        ),
        ...venue.accessibility.map((slug) => ACCESSIBILITY_LABELS[slug]),
      ].filter((label): label is string => !!label)
    : [];
  const shownChips = chipPool.slice(0, MAX_TICKET_CHIPS);
  const foldedChips = chipPool.slice(MAX_TICKET_CHIPS);

  // ── Actions ───────────────────────────────────────────────────────────────
  const bookHref = r.soonest ? r.offerHref(r.soonest.deepLink) : webUrl;

  // The per-guest control and the tax disclaimer ride in the menu's header on
  // both breakpoints, so build them once.
  const menuControls = (
    <div className="flex items-center gap-3">
      {hasPerPersonItems && (
        <Select value={String(guestCount)} onValueChange={(v) => v && setGuestCount(Number(v))}>
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
  );

  const menuBody = (
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
  );

  // The wash panel is the page's job block. A venue with neither reservations
  // nor hours has no job to show, and the menu is promoted into the slot — so
  // the left column never opens with an empty field.
  const hasJobPanel = !!venue && (venue.availabilityEligible || schedules.length > 0);

  // The floating bar overlaps the page, so the page owes it that height back.
  const hasActionBar = !!venue && (!!bookHref || hasMenu);

  // The phone layout hangs the ticket's crease on the hero's bottom edge, so
  // both boxes need the stub's top-half height — it varies with how many lines
  // the venue's name takes. The ticket measures it; the page publishes it as
  // `--crease` for the hero (height) and the ticket (pull-up) to read.
  const [crease, setCrease] = React.useState(TICKET_DEFAULT_CREASE);

  // The menu sheet opens wide and can be pushed wider still — a long menu is
  // three columns of dense rows, and readers browsing one want the room.
  const [menuWide, setMenuWide] = React.useState(false);

  // The menu panel's heading line: which menu is on show, and how much of it
  // there is. It reads beside the title on a desktop and drops on a phone,
  // where both facts are a tap away inside the sheet.
  const menuMeta = hasMenu
    ? [
        teaser?.period,
        `${menuItemCount.toLocaleString()} ${menuItemCount === 1 ? "dish" : "dishes"}`,
      ]
        .filter(Boolean)
        .join(" · ")
    : undefined;

  // "More in Islands of Adventure" — the park's short name when we resolved one,
  // the venue's own location when it fits a heading, else no place at all
  // ("Disney's Grand Floridian Resort & Spa" is not a heading).
  const eatHerePlace = park
    ? formatParkName(park.name)
    : venue?.parkResort && venue.parkResort.length <= 24
      ? decodeEntities(venue.parkResort)
      : null;
  const eatHereTitle = eatHerePlace ? `More in ${eatHerePlace}` : "More places to eat";

  return (
    <div
      style={{ "--crease": `${crease}px` } as React.CSSProperties}
      className={cn(
        PAGE_WIDTH,
        "flex flex-col",
        HERO_PAGE_PADDING,
        hasActionBar && ACTION_BAR_PAGE_PAD,
      )}
    >
      {/* The hero. The loading shell renders the *same* configuration — same
          bleed, same tear — so React reconciles it into the same DOM node when
          the venue query lands mid-flight (a remount would replay the image
          fade and orphan the flight's settle listeners). */}
      {venueQ.isLoading ? (
        flight ? (
          <DiningHero
            heroKey={heroKey}
            name={flight.seed.name}
            subtitle={flight.seed.subtitle}
            image={flight.seed.imageUrl}
            underlay={flight.seed.previewImageUrl ?? flight.seed.cardImageUrl}
            flying={flight.flying}
            entrance
          />
        ) : (
          /* Same bleed, the same crease-aligned height *and* the same run up
             behind the nav as the real hero, so the ticket's crease lands on
             its bottom edge while the venue is still loading and nothing shifts
             when the data lands. */
          <Skeleton
            className={cn(
              HERO_BLEED,
              HERO_CREASE_ALIGNED,
              "md:h-100 md:rounded-t-none md:rounded-b-3xl",
              HERO_UNDER_NAV,
            )}
          />
        )
      ) : !venue ? (
        /* No venue at this id. Still a hero, bare: the masthead inks itself for
           a photograph on this route (`UNDER_NAV_PAGES` in site-header-desktop),
           so a page that drops the hero entirely prints white nav links on a
           white page. `DetailHero` with no image is its dark gradient. */
        <DiningHero
          heroKey={heroKey}
          name=""
          subtitle={null}
          image={null}
          flying={false}
          entrance={false}
        />
      ) : (
        <DiningHero
          heroKey={heroKey}
          name={venue.name}
          subtitle={placeLine}
          image={venue.imageUrl}
          // Identical expression to the loading shell's, so the underlay <img>
          // keeps its src (and stays decoded) across the query landing.
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
        />
      )}

      {!venue && !venueQ.isLoading ? (
        <div className="mt-6 rounded-4xl border bg-muted/30 py-16 text-center">
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
        /* Three children on a two-column grid, placed explicitly (the park page's
           arrangement, over a venue's material): the ticket and the rest of the
           narrow column take rows 1 and 2 of column 1, and the wide column spans
           both rows of column 2 — so the menu rides up beside the ticket into
           what would otherwise be dead space under the hero.

           The order is chosen for the *phone*, where the grid collapses to this
           one flex column: ticket, the job, the food, then the place itself, and
           the neighbourhood cards last. Three `order`s carry it (see each), and
           all of them dissolve at `md`, where the columns place themselves. */
        <div className="flex flex-col gap-5 md:grid md:grid-cols-[minmax(0,30rem)_minmax(0,1fr)] md:grid-rows-[auto_1fr] md:items-start md:gap-x-6 md:gap-y-5 xl:grid-cols-[minmax(0,34rem)_minmax(0,1fr)]">
          {venueQ.isLoading && !flight ? (
            /* Nothing to name the ticket with yet (no map-card seed): hold its
               box so the blocks below don't jump when the venue lands. */
            <Skeleton className="mt-[calc(var(--crease)*-1)] h-52 rounded-none md:col-start-1 md:row-start-1" />
          ) : (
            <Ticket
              onCreaseHeight={setCrease}
              // Pulled up by its own top half at every width, so the crease
              // lands on the hero's bottom edge (the hero is `crease="always"`
              // now), and nudged past the column's left edge on a desktop so
              // the stub reads as laid *on* the page rather than ruled into
              // the grid.
              className="mt-[calc(var(--crease)*-1)] md:col-start-1 md:row-start-1 md:-ml-3 lg:-mx-2.5"
              heroKey={heroKey}
              titleHidden={flight?.flying ? { opacity: 0, visibility: "hidden" } : undefined}
              title={venue?.name ?? flight?.seed.name ?? ""}
              // The place, then whether its doors are open — the same line the
              // park stub carries. `hours.status` is null until hydration (it
              // is a reading of the clock), so the chip simply appears.
              subtitle={
                placeLine || hours.status ? (
                  <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    {placeLine && <span>{placeLine}</span>}
                    {hours.status && (
                      <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-ink-on-yellow px-2.5 py-[3px] text-[11px] font-bold text-brand-yellow">
                        <span
                          className={cn(
                            "size-1.5 rounded-full",
                            hours.openNow ? "bg-emerald-400" : "bg-white/50",
                          )}
                        />
                        {hours.status}
                      </span>
                    )}
                  </span>
                ) : (
                  flight?.seed.subtitle
                )
              }
              facts={facts}
              chips={
                venue && (shownChips.length > 0 || freshChange || isNewVenue) ? (
                  <>
                    {isNewVenue && <TicketChip accent>Newly added</TicketChip>}
                    {!isNewVenue && freshChange && (
                      <TicketChip accent onPress={jumpToFreshItem}>
                        Freshly updated
                      </TicketChip>
                    )}
                    {shownChips.map((label) => (
                      <TicketChip key={label}>{label}</TicketChip>
                    ))}
                    {foldedChips.length > 0 && (
                      <TicketChip title={foldedChips.join(" · ")}>+{foldedChips.length}</TicketChip>
                    )}
                  </>
                ) : null
              }
              keys={
                venue && (venue.phone || venue.detailUrl) ? (
                  <div className="grid grid-cols-2 gap-2">
                    {venue.phone && (
                      <Button variant="ticket" size="lg" render={<a href={`tel:${venue.phone}`} />}>
                        <PhoneIcon />
                        <span className="truncate">Call</span>
                      </Button>
                    )}
                    {venue.detailUrl && (
                      <Button
                        variant="ticket"
                        size="lg"
                        className={cn(!venue.phone && "col-span-2")}
                        render={<a href={venue.detailUrl} target="_blank" rel="noreferrer" />}
                      >
                        <span className="truncate">Official site</span>
                        <ExternalLinkIcon />
                      </Button>
                    )}
                  </div>
                ) : null
              }
              // The stub's lower half: this venue's posted window, today
              // picked out. It is a fact about the place — the same kind as
              // its price band — so it rides on the ticket rather than in a
              // card, exactly as the park's hours do.
              footer={
                !hours.ready || hours.hasSchedule ? <VenueHours facilityId={facilityId} /> : null
              }
            />
          )}

          {/* THE FOOD. The wide column, spanning both of the grid's rows so it
              runs up beside the ticket — the park page's live column, over a
              venue's material. Its heading is the page's "Now": what this
              kitchen is serving, at the hour you are reading it. */}
          <div className="contents md:col-start-2 md:row-span-2 md:row-start-1 md:flex md:flex-col md:gap-4 md:pt-4">
            {venue && (state.menuQ.isLoading || hasMenu || !hasJobPanel) && (
              <div className="order-1 flex flex-col gap-4 md:contents">
                {/* No band heading over it (2026-09-17, Josh): one heading per
                    block, and it belongs to the panel — see `MenuPanel`. */}
                <div id="menu" className="scroll-mt-16">
                  <MenuPanel
                    loading={state.menuQ.isLoading}
                    hasMenu={hasMenu}
                    cover={menuCover}
                    dishes={teaserDishes}
                    itemCount={menuItemCount}
                    meta={menuMeta}
                    onOpen={() => setMenuOpen(true)}
                  />
                </div>
              </div>
            )}

            {/* The neighbourhood: what we've written about the park this venue
                stands in, and the other kitchens in it. Both self-hide when
                there is nothing to show, and both are the park page's own cards
                — one grid of restaurants in the app, not two. Last on a phone
                (`order-3`): they are about somewhere else. */}
            <div className="order-3 flex flex-col gap-5 md:contents">
              {park?.slug && (
                <ParkNews parkSlug={park.slug} title={`News from ${formatParkName(park.name)}`} />
              )}
              {venue?.parkResort && (
                <EatHere
                  parkName={venue.parkResort}
                  excludeFacilityId={facilityId}
                  title={eatHereTitle}
                />
              )}
            </div>
          </div>

          {/* The rest of the narrow column, under the ticket. */}
          <div className="contents md:col-start-1 md:row-start-2 md:flex md:flex-col md:gap-5">
            {/* The page's job, directly under the ticket at every width. First
                in this wrapper, so the phone reads it straight after the stub. */}
            {venue &&
              hasJobPanel &&
              (venue.availabilityEligible ? (
                <GrabATablePanel
                  r={r}
                  facilityId={facilityId}
                  restaurantName={venue.name}
                  webUrl={webUrl}
                  minPartySize={venue.minPartySize}
                  maxPartySize={venue.maxPartySize}
                  maxAdvanceDays={venue.maxAdvanceDays}
                  bookHref={bookHref}
                />
              ) : (
                <WalkUpPanel
                  schedules={schedules}
                  walkupWaitMin={venue.walkupWaitMin}
                  walkupWaitList={venue.walkupWaitList}
                  mobileOrder={venue.mobileOrder}
                />
              ))}

            {/* What this place *is*, rather than what it is doing tonight: its
                own copy, and where to find it. Behind the food on a phone
                (`order-2`), beside it on a desktop, where `md:contents`
                dissolves this wrapper into the narrow column. */}
            <div className="order-2 flex flex-col gap-5 md:contents">
              {/* The venue's own copy — official marketing text, never rewritten
                  (only un-escaped: the feed hands it to us as HTML). */}
              {venue?.description && (
                <div className="flex flex-col gap-2">
                  <p className="text-[15px] leading-[1.45] text-pretty text-muted-foreground md:text-base md:leading-[1.55]">
                    {decodeEntities(venue.description)}
                  </p>
                  {resortSlug && (
                    <Link
                      to="/resort/$slug"
                      params={{ slug: resortSlug }}
                      className="w-fit text-sm font-medium text-primary hover:underline"
                    >
                      More at {decodeEntities(venue.parkResort)}
                    </Link>
                  )}
                </div>
              )}

              {/* Disney venues carry finder coordinates; many UOR ones don't, and
                  the panel simply doesn't render for those. */}
              {venue?.latitude != null && venue.longitude != null && (
                <TintPanel
                  tone="peach"
                  pad="tight"
                  // Only a place name that fits one line joins the title — a
                  // resort's full name ("Disney's Grand Floridian Resort & Spa")
                  // wraps to three beside the Walk-there key, and the map's own
                  // caption names it underneath anyway.
                  title={mapPlace ? `Find it in ${mapPlace}` : "Find it"}
                  meta={
                    <WalkThereButton
                      name={venue.name}
                      latitude={venue.latitude}
                      longitude={venue.longitude}
                      variant="yellow"
                      className="h-9 font-bold"
                    />
                  }
                >
                  <LocationMap
                    latitude={venue.latitude}
                    longitude={venue.longitude}
                    label={venue.name}
                    zoom={17}
                    caption={
                      [...new Set([venue.land, venue.parkResort].filter(Boolean))]
                        .map((part) => decodeEntities(part))
                        .join(", ") || undefined
                    }
                    className="h-48 w-full overflow-hidden rounded-[18px] sm:h-56 md:h-[15.5rem]"
                  />
                </TintPanel>
              )}

              {/* Cast-member-only; renders nothing for everyone else. */}
              <RemovalRequestDialog
                entityType="restaurant"
                entityId={facilityId}
                entityName={venue?.name}
                className="w-fit"
              />
            </div>
          </div>
        </div>
      )}

      {venue?.availabilityEligible && r.days.length > 0 && (
        <PlanAhead r={r} facilityId={facilityId} />
      )}

      {/* The menu destination. A phone gets the full-screen drawer it always
          had; desktop gets the right-hand sheet. */}
      {venue &&
        (isMobile ? (
          <Drawer open={menuOpen} onOpenChange={setMenuOpen}>
            {/* Taller than the 80vh default and with the side padding pulled
                in, so the menu's own rails and rows own the width. */}
            <DrawerContent className="h-[92vh] px-2 data-[vaul-drawer-direction=bottom]:max-h-[92vh]">
              <DrawerHeader className="shrink-0 px-4 py-2 group-data-[vaul-drawer-direction=bottom]/drawer-content:text-left">
                <DrawerTitle>{venue.name}</DrawerTitle>
                {/* The dialog needs a description or it warns on every open
                    ("Missing `Description` for {DialogContent}"); the visible
                    header is controls, not prose, so this one is for readers. */}
                <DrawerDescription className="sr-only">
                  {activePeriod ? `${activePeriod} menu` : "Menu"} ·{" "}
                  {menuItemCount.toLocaleString()} {menuItemCount === 1 ? "dish" : "dishes"}
                </DrawerDescription>
                {menuControls}
              </DrawerHeader>
              {menuBody}
            </DrawerContent>
          </Drawer>
        ) : (
          <RightSheet
            open={menuOpen}
            onOpenChange={setMenuOpen}
            width={menuWide ? "full" : "default"}
            title={`${venue.name} menu`}
            description={`${activePeriod ? `${activePeriod} · ` : ""}${menuItemCount.toLocaleString()} ${menuItemCount === 1 ? "dish" : "dishes"}`}
          >
            <div className="flex shrink-0 items-start justify-between gap-4 border-b px-6 py-4">
              <div className="flex min-w-0 flex-col gap-1">
                <span className="text-[11px] font-bold uppercase tracking-[0.06em] text-muted-foreground">
                  {activePeriod ? `${activePeriod} · ` : ""}
                  {menuItemCount.toLocaleString()} {menuItemCount === 1 ? "dish" : "dishes"}
                </span>
                <p className="truncate text-xl font-extrabold tracking-[-0.01em]">{venue.name}</p>
                {menuControls}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Button
                  variant="outline"
                  size="icon"
                  aria-label={menuWide ? "Narrow the menu" : "Widen the menu"}
                  title={menuWide ? "Narrow the menu" : "Widen the menu"}
                  onClick={() => setMenuWide((w) => !w)}
                >
                  {menuWide ? <Minimize2Icon /> : <Maximize2Icon />}
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  aria-label="Close menu"
                  onClick={() => setMenuOpen(false)}
                >
                  <XIcon />
                </Button>
              </div>
            </div>
            {menuBody}
          </RightSheet>
        ))}

      {/* The phone's one-line answer to "what do I do here". */}
      {hasActionBar && (
        <DetailActionBar>
          {r.soonest && bookHref ? (
            <>
              <Button
                variant="yellow"
                size="lg"
                className="h-12 min-w-0 flex-1 text-[15px] font-bold"
                render={<a href={bookHref} target="_blank" rel="noreferrer" />}
              >
                Book {offerTimeLabel(r.soonest.time)}
                <ExternalLinkIcon />
              </Button>
              {hasMenu && (
                <Button
                  variant="outline"
                  size="lg"
                  className="h-12 shrink-0 text-[15px] font-bold"
                  onClick={() => setMenuOpen(true)}
                >
                  <BookOpenTextIcon />
                  Menu
                </Button>
              )}
            </>
          ) : hasMenu ? (
            <>
              <Button
                variant="yellow"
                size="lg"
                className="h-12 min-w-0 flex-1 text-[15px] font-bold"
                onClick={() => setMenuOpen(true)}
              >
                <BookOpenTextIcon />
                See the menu
              </Button>
              {venue.availabilityEligible && bookHref && (
                <Button
                  variant="outline"
                  size="lg"
                  className="h-12 shrink-0 text-[15px] font-bold"
                  render={<a href={bookHref} target="_blank" rel="noreferrer" />}
                >
                  <CalendarIcon />
                  Book
                </Button>
              )}
            </>
          ) : (
            bookHref && (
              <Button
                variant="yellow"
                size="lg"
                className="h-12 min-w-0 flex-1 text-[15px] font-bold"
                render={<a href={bookHref} target="_blank" rel="noreferrer" />}
              >
                Check availability
                <ExternalLinkIcon />
              </Button>
            )
          )}
        </DetailActionBar>
      )}
    </div>
  );
}
