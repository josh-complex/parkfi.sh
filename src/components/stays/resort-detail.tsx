"use client";

import * as React from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { differenceInCalendarDays, format } from "date-fns";
import { type DateRange } from "react-day-picker";
import { ArrowLeftIcon, CalendarIcon, ExternalLinkIcon } from "lucide-react";

import { LocationMap } from "#/components/maps/location-map.tsx";
import { StayAlertButton } from "#/components/stays/stay-alert-button.tsx";
import { reasonLabel, TIER_LABEL, TIER_META } from "#/components/stays/stays-filters.ts";
import { Badge } from "#/components/ui/badge.tsx";
import { Button, buttonVariants } from "#/components/ui/button.tsx";
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

/** Resort hotels are a static catalog; resolve by slug for the detail page. */
const RESORT_BY_SLUG = new Map(RESORT_CATALOG.map((r) => [r.slug, r]));

export function resortBySlug(slug: string) {
  return RESORT_BY_SLUG.get(slug) ?? null;
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

interface SearchState {
  range: DateRange;
  adults: number;
  children: number;
  floridaResident: boolean;
  accessible: boolean;
}

type CatalogResort = NonNullable<ReturnType<typeof resortBySlug>>;

/**
 * Inline availability search for a single resort. Mirrors the simple, compact
 * control style of the dining detail page (plain field controls — the fancy
 * "core search" pill is reserved for the `/stays` and `/dining` boards). Reuses
 * the `stays.availability` procedure (which returns every resort), filtering the
 * response to this resort's id, and shows its nightly rate / sold-out status plus
 * an "alert me" bell for the committed search.
 */
function ResortAvailability({ resort }: { resort: CatalogResort }) {
  const trpc = useTRPC();
  const isMobile = useIsMobile();
  const { data: session } = authClient.useSession();

  const [range, setRange] = React.useState<DateRange | undefined>();
  const [adults, setAdults] = React.useState(2);
  const [children, setChildren] = React.useState(0);
  const [floridaResident, setFloridaResident] = React.useState(false);
  const [accessible, setAccessible] = React.useState(false);
  const [search, setSearch] = React.useState<SearchState | null>(null);
  const [datesOpen, setDatesOpen] = React.useState(false);

  const today = React.useMemo(() => new Date(), []);

  const availabilityQ = useQuery({
    ...trpc.stays.availability.queryOptions({
      checkInDate: search ? iso(search.range.from!) : "",
      checkOutDate: search ? iso(search.range.to!) : "",
      adults: search?.adults ?? 2,
      children: search?.children ?? 0,
      // Disney requires an age per child; default to 10 (the common rack bucket).
      childAges: search ? Array.from({ length: search.children }, () => 10) : [],
      accessible: search?.accessible ?? false,
      floridaResident: search?.floridaResident ?? false,
    }),
    enabled: !!search,
  });

  const nights =
    search?.range.from && search.range.to
      ? differenceInCalendarDays(search.range.to, search.range.from)
      : 0;

  const submit = React.useCallback(() => {
    if (!range?.from || !range.to) {
      setDatesOpen(true);
      return;
    }
    setSearch({ range, adults, children, floridaResident, accessible });
  }, [range, adults, children, floridaResident, accessible]);

  const offer = availabilityQ.data?.offers.find((o) => o.id === resort.id);

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
            checkInDate: search?.range.from ? iso(search.range.from) : "",
            checkOutDate: search?.range.to ? iso(search.range.to) : "",
            adults: search?.adults ?? adults,
            children: search?.children ?? children,
            childAges: Array.from({ length: search?.children ?? children }, () => 10),
            accessible: search?.accessible ?? accessible,
            floridaResident: search?.floridaResident ?? floridaResident,
          }}
          loggedIn={!!session?.user}
        />
      </div>

      {/* Simple field controls: dates + adults + kids + search. */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1.5">
          <Label className="text-xs font-medium text-muted-foreground">When</Label>
          <Popover open={datesOpen} onOpenChange={setDatesOpen}>
            <PopoverTrigger
              render={
                <Button
                  type="button"
                  variant="outline"
                  data-empty={!range?.from}
                  className="h-9 w-52 justify-start gap-2 font-normal data-[empty=true]:text-muted-foreground"
                />
              }
            >
              <CalendarIcon className="size-4" />
              {rangeLabel(range)}
            </PopoverTrigger>
            <PopoverContent align="start" className="w-auto p-2">
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
            <SelectTrigger className="w-28" aria-label="Adults">
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
            <SelectTrigger className="w-28" aria-label="Kids">
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

        <Button type="button" onClick={submit} className="h-9">
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
              setSearch((s) => (s ? { ...s, floridaResident: v } : s));
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
              setSearch((s) => (s ? { ...s, accessible: v } : s));
            }}
          />
          <Label htmlFor="resort-access" className="text-sm font-normal whitespace-nowrap">
            Accessible rooms
          </Label>
        </div>
      </div>

      {/* Result for this resort. */}
      {search && (
        <div className="border-t pt-4">
          {availabilityQ.isLoading ? (
            <Skeleton className="h-6 w-56" />
          ) : availabilityQ.isError ? (
            <p className="text-sm text-muted-foreground">
              We couldn&apos;t pull live rates just now — please try again.
            </p>
          ) : offer?.available && offer.pricePerNight != null ? (
            <p className="text-sm">
              <span className="text-muted-foreground">From </span>
              <span className="text-lg font-semibold">
                ${offer.pricePerNight.toLocaleString()}
              </span>{" "}
              <span className="text-muted-foreground">
                / night
                {nights > 0
                  ? ` · $${(offer.pricePerNight * nights).toLocaleString()} for ${nights} night${nights === 1 ? "" : "s"}`
                  : ""}
              </span>
            </p>
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

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 py-6 lg:px-6">
      <nav className="text-sm text-muted-foreground">
        <Link to="/stays" className="inline-flex items-center gap-1.5 hover:underline">
          <ArrowLeftIcon className="size-3.5" />
          All resorts
        </Link>
      </nav>

      {resort.image && (
        <div className="relative h-56 w-full overflow-hidden rounded-2xl bg-muted sm:h-80">
          <img
            src={resort.image}
            alt={resort.name}
            className="size-full object-cover"
            loading="eager"
          />
          <Badge
            variant="secondary"
            className="absolute top-3 left-3 bg-background/85 font-medium shadow-sm backdrop-blur-sm"
          >
            {TIER_LABEL[resort.tier]}
          </Badge>
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

      <ResortAvailability resort={resort} />

      {coords && (
        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold tracking-tight">Location</h2>
          <LocationMap
            latitude={coords[0]}
            longitude={coords[1]}
            label={resort.name}
            zoom={16}
            caption={`Approximate location${resort.area ? ` · ${resort.area}` : ""}`}
            className="h-56 w-full overflow-hidden rounded-2xl border sm:h-72"
          />
        </section>
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
