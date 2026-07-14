"use client";

import * as React from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { differenceInCalendarDays, format } from "date-fns";
import { type DateRange } from "react-day-picker";
import { ArrowLeftIcon, CalendarIcon, ExternalLinkIcon } from "lucide-react";

import { LocationMap } from "#/components/maps/location-map.tsx";
import { ResortDiningShelf } from "#/components/dining/resort-dining-shelf.tsx";
import { RemovalRequestDialog } from "#/components/removal-request-dialog.tsx";
import { ResortPriceChart } from "#/components/stays/resort-price-chart.tsx";
import { StayAlertButton } from "#/components/stays/stay-alert-button.tsx";
import { reasonLabel, TIER_LABEL, TIER_META } from "#/components/stays/stays-filters.ts";
import { Badge } from "#/components/ui/badge.tsx";
import { Button, buttonVariants } from "#/components/ui/button.tsx";
import { Image } from "#/components/ui/image.tsx";
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

interface SearchState {
  range: DateRange;
  adults: number;
  children: number;
  floridaResident: boolean;
  accessible: boolean;
}

type CatalogResort = NonNullable<ReturnType<typeof resortBySlug>>;

/**
 * A sensible default stay so the card opens with a live quote instead of an
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

/**
 * Inline availability search for a single resort. Mirrors the simple, compact
 * control style of the dining detail page (plain field controls — the fancy
 * "core search" pill is reserved for the `/stays` and `/dining` boards). Reuses
 * the `stays.availability` procedure (which returns every resort), filtering the
 * response to this resort's id, and shows its nightly rate / sold-out status plus
 * an "alert me" bell for the committed search.
 */
function ResortAvailability({
  resort,
  committed,
  onCommit,
}: {
  resort: CatalogResort;
  /** The committed search (null until the parent's default lands after mount). */
  committed: SearchState | null;
  onCommit: (s: SearchState) => void;
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

  return (
    <section className="flex flex-col gap-4 rounded-2xl border bg-card p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold tracking-tight">Check availability &amp; rates</h2>
        <StayAlertButton
          resortId={resort.id}
          resortName={resort.name}
          tier={resort.tier}
          area={resort.area}
          dims={{
            checkInDate: committed?.range.from ? iso(committed.range.from) : "",
            checkOutDate: committed?.range.to ? iso(committed.range.to) : "",
            adults: committed?.adults ?? adults,
            children: committed?.children ?? children,
            childAges: childAgesFor(committed?.children ?? children),
            accessible: committed?.accessible ?? accessible,
            floridaResident: committed?.floridaResident ?? floridaResident,
          }}
          loggedIn={!!session?.user}
        />
      </div>

      {/* Simple field controls: dates + adults + kids + search. On phones this is
          a 2-col grid (date + Check rates span the full width); md+ is an inline row. */}
      <div className="grid grid-cols-2 items-end gap-3 md:flex md:flex-wrap">
        <div className="col-span-2 flex flex-col gap-1.5">
          <Label className="text-xs font-medium text-muted-foreground">When</Label>
          <Popover open={datesOpen} onOpenChange={setDatesOpen}>
            <PopoverTrigger
              render={
                <Button
                  type="button"
                  variant="outline"
                  data-empty={!range?.from}
                  className="h-9 w-full justify-start gap-2 font-normal data-[empty=true]:text-muted-foreground md:w-52"
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
        </div>

        <div className="flex flex-col gap-1.5">
          <Label className="text-xs font-medium text-muted-foreground">Adults</Label>
          <Select value={String(adults)} onValueChange={(v) => v && setAdults(Number(v))}>
            <SelectTrigger className="w-full md:w-28" aria-label="Adults">
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
        </div>

        <div className="flex flex-col gap-1.5">
          <Label className="text-xs font-medium text-muted-foreground">Kids</Label>
          <Select value={String(children)} onValueChange={(v) => v && setChildren(Number(v))}>
            <SelectTrigger className="w-full md:w-28" aria-label="Kids">
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
        </div>

        <Button type="button" onClick={submit} className="col-span-2 h-9 w-full md:w-auto">
          Check rates
        </Button>
      </div>

      {/* Rate-shaping toggles, mirroring the /stays board. */}
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

      {/* Result for this resort. */}
      {committed && (
        <div className="border-t pt-4">
          {availabilityQ.isLoading ? (
            <div className="flex flex-col gap-1.5">
              <Skeleton className="h-9 w-40" />
              <Skeleton className="h-4 w-52" />
            </div>
          ) : availabilityQ.isError ? (
            <p className="text-sm text-muted-foreground">
              We couldn&apos;t pull live rates just now — please try again.
            </p>
          ) : offer?.available && offer.pricePerNight != null ? (
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div className="flex flex-col gap-0.5">
                <div className="flex items-baseline gap-1.5">
                  <span className="text-3xl font-bold tracking-tight tabular-nums">
                    ${offer.pricePerNight.toLocaleString()}
                  </span>
                  <span className="text-sm text-muted-foreground">/ night</span>
                </div>
                {nights > 0 && (
                  <span className="text-sm text-muted-foreground tabular-nums">
                    ${(offer.pricePerNight * nights).toLocaleString()} total · {nights} night
                    {nights === 1 ? "" : "s"}
                  </span>
                )}
              </div>
              <FreshnessChip fresh={fresh} />
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              {reasonLabel(offer?.reasonCode ?? null)} for these dates. Set an alert above and
              we&apos;ll email you when a room opens.
            </p>
          )}
        </div>
      )}
    </section>
  );
}

/** A small "how current is this quote?" indicator beside the price. */
function FreshnessChip({ fresh }: { fresh: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs text-muted-foreground">
      <span
        className={cn("size-1.5 rounded-full", fresh ? "bg-emerald-500" : "bg-muted-foreground/40")}
      />
      {fresh ? "Live rate" : "Recently checked"}
    </span>
  );
}

/**
 * Standalone resort hotel detail page. Stays data is resort-level only (no
 * room/view granularity), so the page pairs the catalog identity (image, tier,
 * area, blurb) with an inline availability search scoped to this resort, a price
 * alert, and an approximate location map.
 */
export function ResortDetail({ slug }: { slug: string }) {
  const resort = resortBySlug(slug);

  if (!resort) {
    return (
      <div className="mx-auto w-full max-w-4xl px-4 py-16 text-center lg:px-6">
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
  const coords = resortCoords(resort.slug);

  // Committed search shared by the availability card and the price-trend chart.
  // Seeded with a sensible default on the client only (SSR/client `new Date()`
  // would otherwise disagree), so the page opens with a live quote + trend.
  const [search, setSearch] = React.useState<SearchState | null>(null);
  React.useEffect(() => {
    setSearch((prev) => prev ?? defaultStaySearch());
  }, []);

  const nearby = React.useMemo(() => (coords ? landmarkDistances(coords) : []), [coords]);
  const parkMarkers = React.useMemo(
    () => nearby.map((l) => ({ latitude: l.lat, longitude: l.lng, label: l.short })),
    [nearby],
  );

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

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 pt-2 pb-6 lg:px-6">
      <div className="hidden items-center justify-between gap-3 md:flex">
        <nav className="text-sm text-muted-foreground">
          <Link to="/stays" className="inline-flex items-center gap-1.5 hover:underline">
            <ArrowLeftIcon className="size-3.5" />
            All resorts
          </Link>
        </nav>
        <RemovalRequestDialog entityType="resort" entityId={resort.slug} entityName={resort.name} />
      </div>

      {resort.image && (
        <div className="relative h-56 w-full overflow-hidden rounded-2xl bg-muted sm:h-80">
          <Image
            src={resort.image}
            alt={resort.name}
            className="size-full object-cover"
            loading="eager"
            fetchPriority="high"
            sizes="100vw"
          />
        </div>
      )}

      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{resort.name}</h1>
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge variant="outline" className="font-normal">
            {TIER_LABEL[resort.tier]}
          </Badge>
          {resort.area && (
            <Badge variant="outline" className="font-normal">
              {resort.area}
            </Badge>
          )}
        </div>
        {blurb && <p className="text-muted-foreground">{blurb}</p>}
      </header>

      <ResortAvailability resort={resort} committed={search} onCommit={setSearch} />

      <ResortDiningShelf resortName={resort.name} />

      {coords && (
        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold tracking-tight">Location</h2>
          <LocationMap
            latitude={coords[0]}
            longitude={coords[1]}
            label={resort.name}
            markers={parkMarkers}
            caption={`Approximate location${resort.area ? ` · ${resort.area}` : ""}`}
            className="h-48 w-full overflow-hidden rounded-2xl border sm:h-72"
          />
          {nearby.some((l) => l.kind === "park") && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-medium text-muted-foreground">Distance to parks</span>
              {nearby
                .filter((l) => l.kind === "park")
                .map((l) => (
                  <span
                    key={l.short}
                    className="inline-flex items-center gap-1.5 rounded-full border bg-card px-2.5 py-1 text-xs"
                  >
                    <span className="font-medium">{l.short}</span>
                    <span className="text-muted-foreground tabular-nums">
                      {l.miles.toFixed(1)} mi
                    </span>
                  </span>
                ))}
            </div>
          )}
        </section>
      )}

      {historyParams && (
        <ResortPriceChart params={historyParams} enabled nightsLabel={nightsLabel} />
      )}

      <div className="flex flex-wrap items-center gap-3 text-sm">
        <Link to="/stays" className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
          Compare nearby resorts
        </Link>
        <a
          href={resort.detailUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1.5 text-primary hover:underline"
        >
          View on the official site
          <ExternalLinkIcon className="size-3.5" />
        </a>
      </div>
    </div>
  );
}
