"use client";

import * as React from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { differenceInCalendarDays, format } from "date-fns";
import { type DateRange } from "react-day-picker";
import { CalendarIcon, ExternalLinkIcon } from "lucide-react";

import { ACTION_BAR_PAGE_PAD, DetailActionBar } from "#/components/detail/action-bar.tsx";
import { Band, BandHeading } from "#/components/detail/band.tsx";
import { TintPanel, WashPanel } from "#/components/detail/panels.tsx";
import {
  TICKET_DEFAULT_CREASE,
  Ticket,
  TicketBlock,
  TicketChip,
  TicketRow,
  type TicketFact,
} from "#/components/detail/ticket.tsx";
import { DetailHero, HERO_PAGE_PADDING, HERO_OVERLAY_HEADLINE } from "#/components/detail-hero.tsx";
import { EAT_HERE_CATALOG_LIMIT, EatHere } from "#/components/dining/eat-here.tsx";
import { LocationMap } from "#/components/maps/location-map.tsx";
import { PAGE_WIDTH } from "#/components/page-container.tsx";
import { heroFlightKey } from "#/components/park-map/card-flight.ts";
import { RemovalRequestDialog } from "#/components/removal-request-dialog.tsx";
import { ResortPriceChart } from "#/components/stays/resort-price-chart.tsx";
import { ResortRateCalendar } from "#/components/stays/resort-rate-calendar.tsx";
import { StayAlertButton } from "#/components/stays/stay-alert-button.tsx";
import { areaLabel, reasonLabel, TIER_LABEL, TIER_META } from "#/components/stays/stays-filters.ts";
import { Button } from "#/components/ui/button.tsx";
import { Calendar } from "#/components/ui/calendar.tsx";
import { Label } from "#/components/ui/label.tsx";
import { Popover, PopoverContent, PopoverTrigger } from "#/components/ui/popover.tsx";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "#/components/ui/select.tsx";
import { Skeleton } from "#/components/ui/skeleton.tsx";
import { Switch } from "#/components/ui/switch.tsx";
import { useIsMobile } from "#/hooks/use-mobile.ts";
import { useTRPC } from "#/integrations/trpc/react.ts";
import { authClient } from "#/lib/auth-client.ts";
import { cn } from "#/lib/utils.ts";
import { RESORT_CATALOG } from "#/server/stays/resort-catalog.generated.ts";
import { resortCoords } from "#/server/stays/resort-coords.ts";
import { landmarkDistances } from "#/server/stays/wdw-landmarks.ts";

/** Resort hotels are a static catalog; resolve by slug for the detail page. */
const RESORT_BY_SLUG = new Map(RESORT_CATALOG.map((r) => [r.slug, r]));

export function resortBySlug(slug: string) {
  return RESORT_BY_SLUG.get(slug) ?? null;
}

/**
 * Dining's `park_resort` text is the resort's display name verbatim, so this
 * reverses the catalog into a name → slug lookup for cross-linking a dining
 * venue back to its resort's detail page.
 */
const RESORT_SLUG_BY_NAME = new Map(RESORT_CATALOG.map((r) => [r.name, r.slug]));

export function resortSlugByName(name: string) {
  return RESORT_SLUG_BY_NAME.get(name) ?? null;
}

const ISO = "yyyy-MM-dd";
function iso(d: Date): string {
  return format(d, ISO);
}

function rangeLabel(range: DateRange | undefined): string {
  if (!range?.from) return "Add dates";
  if (!range.to) return format(range.from, "MMM d");
  return `${format(range.from, "MMM d")} – ${format(range.to, "MMM d")}`;
}

const ADULT_OPTIONS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
const KID_OPTIONS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

/** Disney requires an age per child; default to the common rack bucket. */
const DEFAULT_CHILD_AGE = 10;

/**
 * Parks named on the ticket's lower half. Three is what the stub's width and
 * the resort's geography both support: past the third nearest park the figures
 * stop separating (every WDW resort is 3–7 miles from the far side of the
 * property) and the block turns into a table nobody reads.
 */
const TICKET_PARKS = 3;

interface SearchState {
  range: DateRange;
  adults: number;
  children: number;
  floridaResident: boolean;
  accessible: boolean;
}

type CatalogResort = NonNullable<ReturnType<typeof resortBySlug>>;

/**
 * A sensible default stay so the page opens with a live quote instead of an
 * empty form: the upcoming Friday, two nights, two adults. Computed lazily on
 * the client (see the seeding effect) so SSR and the browser can't disagree on
 * "today" and trip a hydration mismatch.
 */
function defaultStaySearch(): SearchState {
  const from = new Date();
  from.setHours(0, 0, 0, 0);
  const daysUntilFri = (((5 - from.getDay()) % 7) + 7) % 7 || 7;
  from.setDate(from.getDate() + daysUntilFri);
  const to = new Date(from);
  to.setDate(to.getDate() + 2);
  return { range: { from, to }, adults: 2, children: 0, floridaResident: false, accessible: false };
}

function partyLabel(adults: number, children: number): string {
  const a = `${adults} adult${adults === 1 ? "" : "s"}`;
  return children > 0 ? `${a} · ${children} kid${children === 1 ? "" : "s"}` : a;
}

/** Disney's per-child age list for a party (each kid defaults to the rack bucket). */
function childAgesFor(children: number): Array<number> {
  return Array.from({ length: children }, () => DEFAULT_CHILD_AGE);
}

/** The store's own name, for the ticket's line of place. */
const STORE_NAME: Record<string, string> = {
  wdw: "Walt Disney World",
  dlr: "Disneyland Resort",
};

/**
 * The page's job block: pick dates and a party, see this resort's nightly rate,
 * book it or have us watch it.
 *
 * Structurally the venue page's "Grab a table" panel over a different booking
 * system — controls on one row, the answer under them, the yellow key last and
 * desktop-only (the phone's lives in the floating action bar, so the page
 * carries exactly one of them at any width).
 */
function CheckRatesPanel({
  resort,
  committed,
  onCommit,
  onQuote,
  bookHref,
  className,
}: {
  resort: CatalogResort;
  /** The committed search (null until the parent's default lands after mount). */
  committed: SearchState | null;
  onCommit: (s: SearchState) => void;
  /** Reports the quoted nightly rate up, so the hero's headline chip and this
   *  panel's own figure can never disagree about the number. */
  onQuote: (pricePerNight: number | null) => void;
  bookHref: string;
  className?: string;
}) {
  const trpc = useTRPC();
  const isMobile = useIsMobile();
  const { data: session } = authClient.useSession();

  // Draft controls. Seeded from `committed` so the prefilled default (and any
  // toggle re-commit) shows up in the fields.
  const [range, setRange] = React.useState<DateRange | undefined>(committed?.range);
  const [adults, setAdults] = React.useState(committed?.adults ?? 2);
  const [children, setChildren] = React.useState(committed?.children ?? 0);
  const [floridaResident, setFloridaResident] = React.useState(committed?.floridaResident ?? false);
  const [accessible, setAccessible] = React.useState(committed?.accessible ?? false);
  const [datesOpen, setDatesOpen] = React.useState(false);

  React.useEffect(() => {
    if (!committed) return;
    setRange(committed.range);
    setAdults(committed.adults);
    setChildren(committed.children);
    setFloridaResident(committed.floridaResident);
    setAccessible(committed.accessible);
  }, [committed]);

  const today = React.useMemo(() => new Date(), []);

  const availabilityQ = useQuery({
    ...trpc.stays.availability.queryOptions({
      checkInDate: committed ? iso(committed.range.from!) : "",
      checkOutDate: committed ? iso(committed.range.to!) : "",
      adults: committed?.adults ?? 2,
      children: committed?.children ?? 0,
      childAges: committed ? childAgesFor(committed.children) : [],
      accessible: committed?.accessible ?? false,
      floridaResident: committed?.floridaResident ?? false,
    }),
    enabled: !!committed,
  });

  const nights =
    committed?.range.from && committed.range.to
      ? differenceInCalendarDays(committed.range.to, committed.range.from)
      : 0;

  const submit = React.useCallback(() => {
    if (!range?.from || !range.to) {
      setDatesOpen(true);
      return;
    }
    onCommit({
      range: { from: range.from, to: range.to },
      adults,
      children,
      floridaResident,
      accessible,
    });
  }, [range, adults, children, floridaResident, accessible, onCommit]);

  const offer = availabilityQ.data?.offers.find((o) => o.id === resort.id);
  const fresh = availabilityQ.data ? !availabilityQ.data.cached : false;
  const quoted = offer?.available ? (offer.pricePerNight ?? null) : null;

  // Publish the quote to the page, so the ticket's headline fact and this panel
  // never disagree about the number. An effect rather than a render-time call:
  // this is a write into the parent's state.
  React.useEffect(() => {
    onQuote(quoted);
  }, [quoted, onQuote]);

  const alertDims = {
    checkInDate: committed?.range.from ? iso(committed.range.from) : "",
    checkOutDate: committed?.range.to ? iso(committed.range.to) : "",
    adults: committed?.adults ?? adults,
    children: committed?.children ?? children,
    childAges: childAgesFor(committed?.children ?? children),
    accessible: committed?.accessible ?? accessible,
    floridaResident: committed?.floridaResident ?? floridaResident,
  };

  const meta = !committed
    ? null
    : availabilityQ.isLoading
      ? "Checking…"
      : offer?.available
        ? `${nights} night${nights === 1 ? "" : "s"} · ${partyLabel(committed.adults, committed.children)}`
        : reasonLabel(offer?.reasonCode ?? null);

  return (
    <WashPanel title="Check rates" meta={meta} className={className}>
      {/* Dates take their own row — a range label plus two party selects plus a
          key does not fit a phone, and letting them wrap left the key stranded
          on a line of its own anyway. */}
      <div className="flex flex-col gap-2">
        <Popover open={datesOpen} onOpenChange={setDatesOpen}>
          <PopoverTrigger
            render={
              <Button
                type="button"
                variant="outline"
                data-empty={!range?.from}
                className="h-11 w-full justify-start gap-2 text-[15px] font-semibold data-[empty=true]:text-muted-foreground"
              />
            }
          >
            <CalendarIcon className="size-4" />
            {rangeLabel(range)}
          </PopoverTrigger>
          <PopoverContent align="center" collisionPadding={12} className="w-auto p-2">
            <Calendar
              mode="range"
              selected={range}
              onSelect={(r) => {
                setRange(r);
                if (r?.from && r.to && differenceInCalendarDays(r.to, r.from) >= 1) {
                  setDatesOpen(false);
                }
              }}
              numberOfMonths={isMobile ? 1 : 2}
              disabled={{ before: today }}
              startMonth={today}
              showOutsideDays
            />
          </PopoverContent>
        </Popover>

        <div className="flex gap-2">
          <Select value={String(adults)} onValueChange={(v) => v && setAdults(Number(v))}>
            <SelectTrigger
              className="min-w-0 flex-1 rounded-4xl text-[15px] font-semibold data-[size=default]:h-11"
              aria-label="Adults"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ADULT_OPTIONS.map((n) => (
                <SelectItem key={n} value={String(n)}>
                  {n} adult{n === 1 ? "" : "s"}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={String(children)} onValueChange={(v) => v && setChildren(Number(v))}>
            <SelectTrigger
              className="min-w-0 flex-1 rounded-4xl text-[15px] font-semibold data-[size=default]:h-11"
              aria-label="Kids"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {KID_OPTIONS.map((n) => (
                <SelectItem key={n} value={String(n)}>
                  {n} kid{n === 1 ? "" : "s"}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button type="button" onClick={submit} className="h-11 shrink-0 px-5 font-bold">
            Check
          </Button>
        </div>
      </div>

      {/* The answer. */}
      {committed &&
        (availabilityQ.isLoading ? (
          <Skeleton className="h-[4.25rem] w-full rounded-2xl bg-wash-bar/60" />
        ) : availabilityQ.isError ? (
          <p className="text-sm text-wash-muted">
            We couldn&apos;t pull live rates just now — please try again.
          </p>
        ) : offer?.available && offer.pricePerNight != null ? (
          <div className="flex flex-wrap items-end justify-between gap-3 rounded-2xl bg-background/70 px-4 py-3">
            <div className="flex flex-col gap-0.5">
              <div className="flex items-baseline gap-1.5">
                <span className="text-3xl font-extrabold tracking-tight tabular-nums text-wash-fg">
                  ${offer.pricePerNight.toLocaleString()}
                </span>
                <span className="text-sm text-wash-muted">/ night</span>
              </div>
              {nights > 0 && (
                <span className="text-sm text-wash-muted tabular-nums">
                  ${(offer.pricePerNight * nights).toLocaleString()} total · {nights} night
                  {nights === 1 ? "" : "s"}
                </span>
              )}
            </div>
            <FreshnessChip fresh={fresh} />
          </div>
        ) : (
          <p className="text-sm text-wash-muted">
            {reasonLabel(offer?.reasonCode ?? null)} for these dates. Set an alert and we&apos;ll
            email you when a room opens.
          </p>
        ))}

      {/* Rate-shaping toggles. They re-commit on change, so the quote above
          moves with them rather than waiting on the Check key. */}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        <div className="flex items-center gap-2">
          <Switch
            id="resort-fl"
            size="sm"
            checked={floridaResident}
            onCheckedChange={(v) => {
              setFloridaResident(v);
              if (committed) onCommit({ ...committed, floridaResident: v });
            }}
          />
          <Label htmlFor="resort-fl" className="text-sm font-normal whitespace-nowrap">
            Florida resident
          </Label>
        </div>
        <div className="flex items-center gap-2">
          <Switch
            id="resort-access"
            size="sm"
            checked={accessible}
            onCheckedChange={(v) => {
              setAccessible(v);
              if (committed) onCommit({ ...committed, accessible: v });
            }}
          />
          <Label htmlFor="resort-access" className="text-sm font-normal whitespace-nowrap">
            Accessible rooms
          </Label>
        </div>
      </div>

      {/* Desktop's keys. The phone's are in the floating action bar. */}
      <div className="hidden md:flex md:flex-wrap md:gap-2">
        <Button
          variant="yellow"
          size="lg"
          className="font-bold"
          render={<a href={bookHref} target="_blank" rel="noreferrer" />}
        >
          Book on Disney
          <ExternalLinkIcon />
        </Button>
        <StayAlertButton
          resortId={resort.id}
          resortName={resort.name}
          tier={resort.tier}
          area={resort.area}
          dims={alertDims}
          loggedIn={!!session?.user}
          variant="key"
        />
      </div>
    </WashPanel>
  );
}

/** A small "how current is this quote?" indicator beside the price. */
function FreshnessChip({ fresh }: { fresh: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-wash-edge px-2.5 py-1 text-xs text-wash-muted">
      <span
        className={cn("size-1.5 rounded-full", fresh ? "bg-emerald-500" : "bg-wash-bar-strong")}
      />
      {fresh ? "Live rate" : "Recently checked"}
    </span>
  );
}

/**
 * Standalone resort hotel detail page, on the ticket-stub system
 * (docs/plans/dining-redesign §4.4): a torn photo hero, the ticket carrying the
 * name, three facts and the walk to each park, then the page's job — what a
 * stay costs — in the wash panel, this resort's kitchens beside it, and the
 * rates we have tracked in the "Know" band at the foot.
 *
 * Stays data is resort-level only (no room or view granularity — see the memory
 * note `stays-data-resort-level-only`), which is why every figure on the page is
 * a nightly rate for a party rather than a room type.
 */
export function ResortDetail({ slug }: { slug: string }) {
  const resort = resortBySlug(slug);
  const { data: session } = authClient.useSession();

  // The committed search, shared by the wash panel, the hero's headline chip and
  // the band's two charts — one tuple, so nothing on the page can be quoting a
  // different stay from anything else. Seeded with a sensible default on the
  // client only (SSR and the browser would otherwise disagree about "today"),
  // so the page opens with a live quote and a trend rather than a blank form.
  const [search, setSearch] = React.useState<SearchState | null>(null);
  React.useEffect(() => {
    setSearch((prev) => prev ?? defaultStaySearch());
  }, []);

  // The quoted nightly rate, reported up by the panel so the hero can print it
  // as the page's headline number — the standby wait's slot on a ride page.
  // `useCallback`, because the panel publishes it from an effect.
  const [quote, setQuote] = React.useState<number | null>(null);
  const onQuote = React.useCallback((price: number | null) => setQuote(price), []);

  // The phone layout hangs the ticket's crease on the hero's bottom edge, so
  // both boxes need the stub's top-half height — it varies with how many lines
  // the resort's name takes ("Disney's Animal Kingdom Lodge — Kidani Village"
  // is three). The ticket measures it; the page publishes it as `--crease`.
  const [crease, setCrease] = React.useState(TICKET_DEFAULT_CREASE);

  const coords = resort ? resortCoords(resort.slug) : null;
  const nearby = React.useMemo(() => (coords ? landmarkDistances(coords) : []), [coords]);
  const parkMarkers = React.useMemo(
    () => nearby.map((l) => ({ latitude: l.lat, longitude: l.lng, label: l.short })),
    [nearby],
  );

  // Does this resort have kitchens of its own? `EatHere` self-hides when it has
  // nothing, which would leave the wide column empty rather than absent — so
  // the page asks the identical query (same key, so it costs no second round
  // trip) and drops the column with it. Some catalog entries genuinely have
  // none: a DVC tower's venues are listed under its host resort's name.
  const trpc = useTRPC();
  const diningQ = useQuery({
    ...trpc.dining.byPark.queryOptions({
      parkName: resort?.name ?? "",
      limit: EAT_HERE_CATALOG_LIMIT,
    }),
    enabled: !!resort,
  });
  // True until the query lands (which is also while `EatHere` draws its own
  // skeleton), so the page doesn't open one-column and snap to two. Tested on
  // the data rather than `isLoading`, which is false on the first client render
  // — see `EatHere`'s own guard for why.
  const hasWide = !diningQ.data || diningQ.data.length > 0;

  if (!resort) {
    return (
      <div className={cn(PAGE_WIDTH, "py-16 text-center")}>
        <p className="text-lg font-semibold">Resort not found</p>
        <p className="mt-1 text-sm text-muted-foreground">
          This resort may no longer be listed.{" "}
          <Link to="/stays" className="underline">
            Browse all resorts
          </Link>
          .
        </p>
      </div>
    );
  }

  const blurb = TIER_META.find((t) => t.key === resort.tier)?.blurb ?? null;
  const area = resort.area ? areaLabel(resort.area) : null;
  const placeLine = [STORE_NAME[resort.store], area].filter(Boolean).join(" · ");
  const parks = nearby.filter((l) => l.kind === "park").slice(0, TICKET_PARKS);

  const historyParams =
    search?.range.from && search.range.to
      ? {
          resortId: resort.id,
          checkInDate: iso(search.range.from),
          checkOutDate: iso(search.range.to),
          adults: search.adults,
          children: search.children,
          childAges: childAgesFor(search.children),
          accessible: search.accessible,
          floridaResident: search.floridaResident,
        }
      : null;
  const nightsLabel = search
    ? `${rangeLabel(search.range)} · ${partyLabel(search.adults, search.children)}`
    : "";

  // ── Ticket contents ────────────────────────────────────────────────────────
  // Three facts that never move, on purpose. The nightly rate is deliberately
  // *not* among them: it is the hero's headline number (as the standby wait is
  // on a ride), it arrives a beat after the page from a client-side search, and
  // a fact cell appearing late would reflow the other two under the reader's
  // eye every time they changed the dates. Everything here is catalog data, so
  // the stub is complete in the SSR'd markup (plan §4.9).
  const facts: Array<TicketFact> = [{ label: "Tier", value: TIER_LABEL[resort.tier] }];
  const fillers: Array<TicketFact | null> = [
    area ? { label: "Area", value: area } : null,
    parks[0] ? { label: "Nearest park", value: parks[0].short, hint: parks[0].name } : null,
    { label: "Books at", value: STORE_NAME[resort.store] ?? "Disney" },
  ];
  for (const f of fillers) {
    if (facts.length >= 3) break;
    if (f && !facts.some((existing) => existing.label === f.label)) facts.push(f);
  }

  const bookHref = resort.detailUrl;
  const alertDims = {
    checkInDate: search?.range.from ? iso(search.range.from) : "",
    checkOutDate: search?.range.to ? iso(search.range.to) : "",
    adults: search?.adults ?? 2,
    children: search?.children ?? 0,
    childAges: childAgesFor(search?.children ?? 0),
    accessible: search?.accessible ?? false,
    floridaResident: search?.floridaResident ?? false,
  };

  return (
    <div
      style={{ "--crease": `${crease}px` } as React.CSSProperties}
      className={cn(PAGE_WIDTH, "flex flex-col", HERO_PAGE_PADDING, ACTION_BAR_PAGE_PAD)}
    >
      {/* The hero. No flight lands here — resorts have no map marker — but the
          shared shell keeps the treatment (and the `data-hero` contract, should
          resort markers ever land) identical across every detail page. The tier
          and area badges it used to wear are on the stub now; the only overlay
          left is the page's one live number, which is what a night here costs
          for the stay currently in the panel below. */}
      <DetailHero
        heroKey={heroFlightKey("resort", resort.slug)}
        name={resort.name}
        subtitle={placeLine}
        image={resort.image ?? null}
        thumbhash={resort.imageThumbhash}
        flying={false}
        entrance={false}
        tear
        crease="always"
        titleless
        underNav
        overlays={({ chipFx }) =>
          quote != null ? (
            <div
              style={chipFx(0).style}
              className={cn(
                "absolute flex items-baseline gap-1.5 rounded-2xl bg-black/75 px-3.5 py-2 text-white shadow-lg backdrop-blur-sm",
                HERO_OVERLAY_HEADLINE,
                chipFx(0).className,
              )}
            >
              <span className="text-3xl font-bold leading-none tabular-nums sm:text-4xl">
                ${quote.toLocaleString()}
              </span>
              <span className="text-[10px] font-semibold uppercase tracking-wide text-white/70">
                / night
              </span>
            </div>
          ) : null
        }
      />

      {/* Three children on a two-column grid, placed explicitly — the venue
          page's arrangement, over a hotel's material: the ticket and the rest of
          the narrow column take rows 1 and 2 of column 1, and the wide column
          spans both rows of column 2, so the food rides up beside the ticket
          into what would otherwise be dead space under the hero.

          The phone order is ticket → what it costs → what it is → where it is →
          what to eat, carried by two `order`s that dissolve at `wide`. */}
      <div
        className={cn(
          "flex flex-col gap-5",
          // A resort with no kitchens listed under its own name (a DVC tower's
          // venues sit under its host resort) has nothing for the wide column,
          // and an empty 1fr beside a 1,100px column is worse than no grid —
          // so the page simply stays the single phone column. The placement
          // classes below are inert in a flex container, and the `contents`
          // wrappers dissolve into it exactly as they do on a phone.
          hasWide
            ? "wide:grid wide:grid-cols-[minmax(0,30rem)_minmax(0,1fr)] wide:grid-rows-[auto_1fr] wide:items-start wide:gap-x-6 wide:gap-y-5 xl:grid-cols-[minmax(0,34rem)_minmax(0,1fr)]"
            : "md:max-w-[34rem]",
        )}
      >
        <Ticket
          onCreaseHeight={setCrease}
          // Pulled up by its own top half at every width, so the crease lands on
          // the hero's bottom edge (the hero is `crease="always"`), and nudged
          // past the column's left edge on a desktop so the stub reads as laid
          // *on* the page rather than ruled into the grid.
          className="mt-[calc(var(--crease)*-1)] md:mx-auto md:w-full md:max-w-[34rem] wide:col-start-1 wide:row-start-1 wide:-mx-2.5 wide:w-auto wide:max-w-none"
          heroKey={heroFlightKey("resort", resort.slug)}
          title={resort.name}
          subtitle={
            <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
              {placeLine && <span>{placeLine}</span>}
              <TicketChip accent>{TIER_LABEL[resort.tier]}</TicketChip>
            </span>
          }
          facts={facts}
          // No keys: the one place this page can send anybody is Disney's own
          // resort page, and the wash panel's yellow key already goes there. A
          // second key to the same URL is not a second option.
          // The stub's lower half: how far this hotel is from the gates. It is a
          // fact about the place — the same kind as its tier — so it rides on
          // the ticket, exactly as the park's hours and the ride's windows do.
          //
          // "Distance", never "walk": these are straight-line miles between two
          // points, and almost every WDW resort reaches its parks by bus, boat
          // or Skyliner. The meta line says so rather than leaving the reader to
          // infer it from a figure that looks walkable.
          footer={
            parks.length > 0 ? (
              <TicketBlock title="Distance to the parks" meta="Straight-line" gap="tight">
                {parks.map((l) => (
                  <TicketRow key={l.short} lead={`${l.miles.toFixed(1)} mi`}>
                    {l.short}
                  </TicketRow>
                ))}
              </TicketBlock>
            ) : null
          }
        />

        {/* THE FOOD. The wide column, spanning both of the grid's rows so it runs
            up beside the ticket — the venue page's own arrangement, over a
            hotel's material. It carries no band heading, unlike the venue and
            ride pages: the card brings its own, and the two stacked read as a
            heading about a heading. Last on a phone (`order-3`). */}
        {hasWide && (
          <div className="order-3 wide:col-start-2 wide:row-span-2 wide:row-start-1 wide:pt-4">
            <EatHere parkName={resort.name} title="Eat without leaving" />
          </div>
        )}

        {/* The rest of the narrow column, under the ticket. */}
        <div className="contents wide:col-start-1 wide:row-start-2 wide:flex wide:flex-col wide:gap-5">
          {/* The page's job, directly under the ticket at every width. */}
          <CheckRatesPanel
            resort={resort}
            committed={search}
            onCommit={setSearch}
            onQuote={onQuote}
            bookHref={bookHref}
          />

          <div className="order-2 flex flex-col gap-5 wide:contents">
            {/* What this tier *is*, rather than what it costs this weekend. */}
            {blurb && (
              <p className="text-[15px] leading-[1.45] text-pretty text-muted-foreground md:text-base md:leading-[1.55]">
                {blurb}
              </p>
            )}

            {/* The exit block: where it sits on the property. Every WDW resort
                has coordinates; the guard is for a catalog entry we haven't
                placed yet. */}
            {coords && (
              <TintPanel tone="peach" pad="tight" title={area ? `Find it near ${area}` : "Find it"}>
                <LocationMap
                  latitude={coords[0]}
                  longitude={coords[1]}
                  label={resort.name}
                  markers={parkMarkers}
                  caption={`Approximate location${resort.area ? ` · ${resort.area}` : ""}`}
                  className="h-48 w-full overflow-hidden rounded-[18px] sm:h-56 md:h-[15.5rem]"
                />
              </TintPanel>
            )}

            <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline" className="font-bold" render={<Link to="/stays" />}>
                Compare nearby resorts
              </Button>
            </div>

            {/* Cast-member-only; renders nothing for everyone else. */}
            <RemovalRequestDialog
              entityType="resort"
              entityId={resort.slug}
              entityName={resort.name}
              className="w-fit"
            />
          </div>
        </div>
      </div>

      {/* ── KNOW: what we've watched this resort charge ──

          The trend always draws — with its own "we haven't tracked these dates
          yet, set an alert" state when it has nothing, which is a useful thing
          to say. The calendar withholds itself instead: a grid of six rows of
          hairlines answers nothing the trend's sentence hasn't already. */}
      <Band className="mt-10 md:mt-14">
        <BandHeading
          kicker="Know"
          title="What it has been costing"
          meta="Nightly rates we've recorded, for the party above"
        />
        {historyParams && (
          <ResortPriceChart params={historyParams} enabled nightsLabel={nightsLabel} />
        )}
        {search && (
          <ResortRateCalendar
            resortId={resort.id}
            store={resort.store}
            adults={search.adults}
            children={search.children}
            childAges={childAgesFor(search.children)}
            accessible={search.accessible}
            floridaResident={search.floridaResident}
            partyLabel={partyLabel(search.adults, search.children)}
          />
        )}
      </Band>

      {/* The phone's one-line answer to "what do I do here". */}
      <DetailActionBar>
        <Button
          variant="yellow"
          size="lg"
          className="h-12 min-w-0 flex-1 text-[15px] font-bold"
          render={<a href={bookHref} target="_blank" rel="noreferrer" />}
        >
          Book on Disney
          <ExternalLinkIcon />
        </Button>
        <StayAlertButton
          resortId={resort.id}
          resortName={resort.name}
          tier={resort.tier}
          area={resort.area}
          dims={alertDims}
          loggedIn={!!session?.user}
          variant="key"
          label="Alert"
          className="h-12 shrink-0 text-[15px]"
        />
      </DetailActionBar>
    </div>
  );
}
