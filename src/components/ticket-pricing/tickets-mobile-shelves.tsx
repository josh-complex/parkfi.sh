"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { CloudRainIcon, DropletIcon, TicketIcon, WindIcon } from "lucide-react";

import {
  Carousel,
  CarouselArrows,
  CarouselContent,
  CarouselItem,
} from "#/components/ui/carousel.tsx";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from "#/components/ui/drawer.tsx";
import { Skeleton } from "#/components/ui/skeleton.tsx";
import {
  crowdConfig,
  dollars,
  formatPrecip,
  PriceCalendarGrid,
  WeatherIcon,
  type AgeGroup,
  type Resort,
} from "#/components/ticket-pricing/shared.tsx";
import { unitsLeftChip } from "#/lib/ticket-scarcity.ts";
import { TicketsResortChips } from "#/components/ticket-pricing/tickets-resort-chips.tsx";
import { ConnectionLost } from "#/components/connection-lost.tsx";
import { queryUnavailable } from "#/hooks/use-online-status.ts";
import { buyTicketsHref, ticketPurchaseDeepLink, ticketStoreLabel } from "#/lib/disney-links.ts";
import { useIsNative } from "#/hooks/use-is-native.ts";
import { useTRPC } from "#/integrations/trpc/react.ts";
import { cn } from "#/lib/utils.ts";

/** One park's summary row, mirroring the `tickets.parkShelf` endpoint payload. */
interface ShelfPark {
  resort: Resort;
  code: string;
  slug: string | null;
  label: string;
  parkHopper: boolean;
  todayCents: number | null;
  todayAvailable: boolean;
  todayUnits: number | null;
  cheapestCents: number | null;
  cheapestDate: string | null;
  crowdIndex: number | null;
  crowdIsEstimate: boolean;
  highF: number | null;
  lowF: number | null;
  precipProb: number | null;
  precipPeak: string | null;
  windMph: number | null;
  humidity: number | null;
  condition: string | null;
}

function shortDate(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

function typeLabel(park: ShelfPark): string {
  if (park.resort === "UOR") return "Express Pass";
  return park.parkHopper ? "Park Hopper ticket" : "1-Day ticket";
}

/**
 * A single shelf card — same shape as the Waits/Eats/Stays cards: a 4:3
 * rounded thumbnail carrying the value, then a label + subline beneath. Price
 * cards are buttons that open the calendar; weather/crowd are static.
 */
function StatCard({
  label,
  sub,
  thumbClassName,
  fill = false,
  onClick,
  href,
  children,
}: {
  label: string;
  sub?: string | null;
  thumbClassName?: string;
  /** Fill layout: content lays itself out edge-to-edge instead of centering. */
  fill?: boolean;
  onClick?: () => void;
  /** External link target — renders the card as an `<a>` opening in a new tab. */
  href?: string;
  children: React.ReactNode;
}) {
  const interactive = onClick != null || href != null;
  const inner = (
    <div className="group flex flex-col gap-2 outline-none">
      <div
        className={cn(
          "bg-muted relative flex aspect-[4/3] w-full overflow-hidden rounded-2xl",
          fill ? "flex-col justify-between p-2.5" : "items-center justify-center",
          interactive && "transition-transform group-hover:scale-[1.02]",
          thumbClassName,
        )}
      >
        {children}
      </div>
      <div className="flex flex-col gap-0.5 px-0.5">
        <span
          className={cn("line-clamp-1 text-sm font-medium", interactive && "group-hover:underline")}
        >
          {label}
        </span>
        {sub && <span className="text-muted-foreground line-clamp-1 text-xs">{sub}</span>}
      </div>
    </div>
  );
  if (href) {
    return (
      <a href={href} target="_blank" rel="noreferrer" className="block w-full text-left">
        {inner}
      </a>
    );
  }
  if (onClick) {
    return (
      <button type="button" onClick={onClick} className="block w-full text-left">
        {inner}
      </button>
    );
  }
  return inner;
}

/** One park section: name header + a shelf of today / cheapest / weather / crowd. */
function ParkShelf({
  park,
  onOpenCalendar,
  todayIso,
  native,
  apBlockedToday,
}: {
  park: ShelfPark;
  onOpenCalendar: (focusDate: string | undefined) => void;
  todayIso: string;
  native: boolean;
  /** Today is an Annual Pass blockout for this park (WDW only). */
  apBlockedToday: boolean;
}) {
  const crowd = park.crowdIndex != null ? crowdConfig(park.crowdIndex) : null;
  const precip = formatPrecip(park.precipProb);
  const units = park.todayAvailable ? unitsLeftChip(park.todayUnits) : null;
  const subtitle =
    park.cheapestCents != null
      ? `${typeLabel(park)} · from ${dollars(park.cheapestCents)}`
      : typeLabel(park);

  return (
    <Carousel opts={{ align: "start", dragFree: true }} className="-mx-4 lg:-mx-6">
      <section className="flex flex-col gap-3 pt-4">
        <div className="flex items-end justify-between gap-4 px-4 lg:px-6">
          <div className="flex min-w-0 flex-col gap-0.5">
            <h3 className="truncate text-lg font-semibold tracking-tight">{park.label}</h3>
            <p className="text-muted-foreground truncate text-sm">{subtitle}</p>
          </div>
          <CarouselArrows className="hidden shrink-0 md:flex" />
        </div>

        <CarouselContent
          className="-ml-4"
          viewportClassName="px-4 lg:px-6 [mask-image:linear-gradient(to_right,transparent,#000_1.5rem,#000_calc(100%_-_1.5rem),transparent)]"
        >
          {/* Today's price — opens the calendar on today */}
          <CarouselItem className="basis-[42%] pl-4 md:basis-1/3 lg:basis-1/4 xl:basis-1/5">
            <StatCard label="Today" onClick={() => onOpenCalendar(todayIso)}>
              {park.todayCents != null ? (
                <span
                  className={cn(
                    "text-2xl font-bold tabular-nums",
                    !park.todayAvailable && "text-muted-foreground/50 line-through",
                  )}
                >
                  {dollars(park.todayCents)}
                </span>
              ) : (
                <span className="text-2xl font-bold text-muted-foreground/30">—</span>
              )}
              {units && (
                <span
                  className={cn(
                    "absolute left-2 top-2 rounded-full px-1.5 py-[3px] text-[9px] font-bold uppercase tracking-widest leading-none",
                    units.pill,
                  )}
                >
                  {units.label}
                </span>
              )}
              {apBlockedToday && (
                <span className="absolute left-2 top-2 rounded-full bg-red-100 px-1.5 py-[3px] text-[9px] font-bold uppercase tracking-widest leading-none text-red-600 dark:bg-red-900/50 dark:text-red-300">
                  AP blocked
                </span>
              )}
            </StatCard>
          </CarouselItem>

          {/* Upcoming cheapest — opens the calendar on that date */}
          <CarouselItem className="basis-[42%] pl-4 md:basis-1/3 lg:basis-1/4 xl:basis-1/5">
            <StatCard
              label="Cheapest"
              sub={park.cheapestDate ? shortDate(park.cheapestDate) : null}
              thumbClassName="bg-primary/10"
              onClick={() => onOpenCalendar(park.cheapestDate ?? undefined)}
            >
              {park.cheapestCents != null ? (
                <span className="text-2xl font-bold tabular-nums text-primary">
                  {dollars(park.cheapestCents)}
                </span>
              ) : (
                <span className="text-2xl font-bold text-muted-foreground/30">—</span>
              )}
            </StatCard>
          </CarouselItem>

          {/* Buy tickets — on the native MDE shell (Disney) this deep links to
              the app's `mdx://tickets/buy` purchase flow; on web (and Universal)
              it's the https ticket store, which hands off to the app via App
              Links. */}
          <CarouselItem className="basis-[42%] pl-4 md:basis-1/3 lg:basis-1/4 xl:basis-1/5">
            <StatCard
              label="Buy tickets"
              sub={
                native && ticketPurchaseDeepLink(park.resort) != null
                  ? "in the Disney app"
                  : `on ${ticketStoreLabel(park.resort)}`
              }
              thumbClassName="bg-primary/10 text-primary"
              href={buyTicketsHref(park.resort, native)}
            >
              <TicketIcon className="size-9" strokeWidth={1.75} />
            </StatCard>
          </CarouselItem>

          {/* Today's weather — icon + precip up top, high/low + wind/humidity below */}
          <CarouselItem className="basis-[42%] pl-4 md:basis-1/3 lg:basis-1/4 xl:basis-1/5">
            <StatCard label="Weather" sub={park.condition} fill={park.highF != null}>
              {park.highF != null ? (
                <>
                  <div className="flex w-full items-start justify-between gap-1">
                    <WeatherIcon
                      condition={park.condition}
                      precipProb={park.precipProb}
                      size={44}
                    />
                    {precip && (
                      <span className="flex shrink-0 items-center gap-0.5 rounded-full bg-sky-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-sky-600 dark:text-sky-400">
                        <CloudRainIcon className="size-2.5" />
                        {park.precipPeak ? `${precip} at ${park.precipPeak}` : precip}
                      </span>
                    )}
                  </div>
                  <div className="flex flex-col gap-1">
                    <div className="flex items-baseline gap-1.5 leading-none">
                      <span className="text-2xl font-bold tabular-nums">{park.highF}°</span>
                      {park.lowF != null && (
                        <span className="text-sm font-medium tabular-nums text-muted-foreground">
                          {park.lowF}°
                        </span>
                      )}
                    </div>
                    {(park.windMph != null || park.humidity != null) && (
                      <div className="flex items-center gap-2 text-[10px] font-medium text-muted-foreground">
                        {park.windMph != null && (
                          <span className="flex items-center gap-0.5">
                            <WindIcon className="size-2.5" />
                            {park.windMph} mph
                          </span>
                        )}
                        {park.humidity != null && (
                          <span className="flex items-center gap-0.5">
                            <DropletIcon className="size-2.5" />
                            {park.humidity}%
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                </>
              ) : (
                <span className="text-2xl font-bold text-muted-foreground/30">—</span>
              )}
            </StatCard>
          </CarouselItem>

          {/* Today's crowd level */}
          <CarouselItem className="basis-[42%] pl-4 md:basis-1/3 lg:basis-1/4 xl:basis-1/5">
            <StatCard
              label="Crowd"
              sub={park.crowdIndex != null ? `${park.crowdIndex}/10` : null}
              thumbClassName={cn(crowd?.pill, park.crowdIsEstimate && "opacity-70")}
            >
              {crowd ? (
                <span className="text-lg font-bold uppercase tracking-wide">{crowd.label}</span>
              ) : (
                <span className="text-2xl font-bold text-muted-foreground/30">—</span>
              )}
            </StatCard>
          </CarouselItem>
        </CarouselContent>
      </section>
    </Carousel>
  );
}

function LoadingShelf() {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-4 w-28" />
      </div>
      <div className="flex gap-4 overflow-hidden">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="w-[42%] shrink-0">
            <Skeleton className="aspect-[4/3] rounded-2xl" />
          </div>
        ))}
      </div>
    </section>
  );
}

/**
 * The mobile ticket-pricing experience: one shelf per park (identical shape to
 * the Waits/Eats/Stays shelves) whose cards are today's price, the cheapest
 * upcoming price, today's weather, and the crowd level. Tapping a price card
 * opens that park's calendar on the relevant day. Resort quick-filter chips sit
 * under the header. Rendered only on mobile — the desktop calendar covers up.
 */
export function TicketsMobileShelves({
  parkHopper,
  ageGroup,
  enabled = true,
  className,
}: {
  parkHopper: boolean;
  ageGroup: AgeGroup;
  enabled?: boolean;
  className?: string;
}) {
  const trpc = useTRPC();
  const native = useIsNative();
  const q = useQuery({
    ...trpc.tickets.parkShelf.queryOptions({ parkHopper, ageGroup }),
    enabled,
  });
  const todayIso = q.data?.date ?? "";
  const allParks = (q.data?.parks ?? []) as Array<ShelfPark>;

  // Today's Annual Pass blockouts (WDW only) — a red label on that park's Today
  // card. `days: 1` scopes the fetch to today.
  const blockoutQ = useQuery({
    ...trpc.tickets.passholderBlockouts.queryOptions({ days: 1 }),
    enabled,
  });
  const blockedTodaySlugs = React.useMemo(
    () => new Set((blockoutQ.data?.todayBlocked ?? []).map((p) => p.slug)),
    [blockoutQ.data],
  );

  const [resortFilter, setResortFilter] = React.useState<Resort | null>(null);
  const parks = resortFilter ? allParks.filter((p) => p.resort === resortFilter) : allParks;

  // The tapped park + focus date whose calendar is shown in the drawer.
  const [cal, setCal] = React.useState<{ park: ShelfPark; focusDate: string | undefined } | null>(
    null,
  );

  return (
    <div className={cn("flex flex-col", className)}>
      <TicketsResortChips value={resortFilter} onChange={setResortFilter} />

      <div className="flex flex-col gap-4 p-4 pb-28 pt-0">
        {q.isLoading ? (
          <>
            <LoadingShelf />
            <LoadingShelf />
            <LoadingShelf />
          </>
        ) : queryUnavailable(q) ? (
          <ConnectionLost onRetry={() => void q.refetch()} />
        ) : parks.length === 0 ? (
          <div className="py-16 text-center text-sm text-muted-foreground">
            No ticket pricing captured yet.
          </div>
        ) : (
          parks.map((park) => (
            <ParkShelf
              key={`${park.resort}-${park.code}`}
              park={park}
              todayIso={todayIso}
              native={native}
              apBlockedToday={park.slug != null && blockedTodaySlugs.has(park.slug)}
              onOpenCalendar={(focusDate) => setCal({ park, focusDate })}
            />
          ))
        )}
      </div>

      <Drawer open={cal != null} onOpenChange={(o) => !o && setCal(null)}>
        <DrawerContent>
          <DrawerHeader className="border-b pb-4 text-left">
            <DrawerTitle>{cal?.park.label}</DrawerTitle>
            <DrawerDescription>
              Cheapest ticket by date — tap a day for hours, weather, and crowd.
            </DrawerDescription>
          </DrawerHeader>
          <div className="max-h-[70vh] overflow-y-auto px-2 pb-4">
            {cal && (
              <PriceCalendarGrid
                key={`${cal.park.code}-${cal.focusDate ?? ""}`}
                resort={cal.park.resort}
                park={cal.park.code}
                parkHopper={parkHopper}
                ageGroup={ageGroup}
                focusDate={cal.focusDate}
              />
            )}
          </div>
        </DrawerContent>
      </Drawer>
    </div>
  );
}
